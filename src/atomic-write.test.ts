import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { appendLine, createOwnWrites, deleteFile, listTree, ownWriteKey, readWithEtag, writeAtomic } from './atomic-write.ts';
import { sha256 } from './etag.ts';
import { removeTemp, tempDir } from './test-support.ts';

let root: string;
let file: string;
beforeEach(() => { root = tempDir(); file = path.join(root, 'synthetic.json'); });
afterEach(() => { mock.restoreAll(); removeTemp(root); });

const busy = (code: string) => Object.assign(new Error('Synthetic busy file.'), { code });
type Rename = (from: fs.PathLike, to: fs.PathLike) => void;

describe('atomic write', () => {
  it('writes, reads back with the content ETag, and treats a folder or a missing file as "no file"', async () => {
    assert.deepEqual(await writeAtomic(file, 'hello', { ifMatch: '*' }), { ok: true, etag: sha256('hello') });
    assert.deepEqual(readWithEtag(file), { raw: 'hello', etag: sha256('hello') });
    assert.equal(readWithEtag(root), null);
    assert.equal(readWithEtag(path.join(root, 'missing.json')), null);
    assert.deepEqual(fs.readdirSync(root), ['synthetic.json']);
  });

  it('without a precondition it only creates: an existing file answers 412 with its current text', async () => {
    assert.equal((await writeAtomic(file, 'first')).ok, true);
    const second = await writeAtomic(file, 'second');
    assert.equal(second.ok, false);
    if (!second.ok && second.reason === 'conflict') {
      assert.equal(second.status, 412);
      assert.equal(second.current, 'first');
      assert.equal(second.etag, sha256('first'));
    } else assert.fail('expected a conflict');
    assert.equal(fs.readFileSync(file, 'utf8'), 'first');
  });

  it('If-Match: a matching ETag writes, a stale one answers 412, a hash for a missing file answers 412', async () => {
    fs.writeFileSync(file, 'original');
    assert.equal((await writeAtomic(file, 'stale', { ifMatch: sha256('other') })).ok, false);
    assert.equal(fs.readFileSync(file, 'utf8'), 'original');
    assert.deepEqual(await writeAtomic(file, 'fresh', { ifMatch: sha256('original') }), { ok: true, etag: sha256('fresh') });
    const missing = await writeAtomic(path.join(root, 'gone.json'), 'x', { ifMatch: sha256('anything') });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 412);
    assert.equal(fs.existsSync(path.join(root, 'gone.json')), false);
  });

  it('records its own writes in the ledger and deleteFile clears them', async () => {
    const ownWrites = createOwnWrites();
    await writeAtomic(file, 'a', { ifMatch: '*', ownWrites });
    assert.equal(ownWrites.get(ownWriteKey(file)), sha256('a'));
    assert.equal(await deleteFile(file, { ownWrites }), true);
    assert.equal(ownWrites.has(ownWriteKey(file)), false);
    assert.equal(await deleteFile(file, { ownWrites }), false);
  });

  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    it(`preserves an external save after ${code}, cleans temp files and leaves the ledger unchanged (career-center fs-retry)`, async () => {
      fs.writeFileSync(file, 'original');
      const ownWrites = createOwnWrites();
      ownWrites.set(ownWriteKey(file), sha256('original'));
      const rename: Rename = fs.renameSync.bind(fs);
      let attempts = 0;
      mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
        if (String(to) === file && attempts++ === 0) { fs.writeFileSync(file, 'external'); throw busy(code); }
        return rename(from, to);
      });
      const result = await writeAtomic(file, 'stale browser update', { ifMatch: sha256('original'), ownWrites });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.status, 412);
      assert.equal(fs.readFileSync(file, 'utf8'), 'external');
      assert.equal(attempts, 1);
      assert.deepEqual(fs.readdirSync(root), ['synthetic.json']);
      assert.equal(ownWrites.get(ownWriteKey(file)), sha256('original'));
      // The conflict must release the mutex so a refreshed editor can save normally.
      assert.equal((await writeAtomic(file, 'refreshed update', { ifMatch: sha256('external'), ownWrites })).ok, true);
    });
  }

  it('rechecks later attempts too, not just the first retry (career-center fs-retry)', async () => {
    fs.writeFileSync(file, 'original');
    let attempts = 0;
    mock.method(fs, 'renameSync', () => {
      attempts++;
      if (attempts === 2) fs.writeFileSync(file, 'external during second retry');
      throw busy('EPERM');
    });
    const result = await writeAtomic(file, 'stale', { ifMatch: sha256('original') });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 412);
    assert.equal(attempts, 2);
    assert.equal(fs.readFileSync(file, 'utf8'), 'external during second retry');
    assert.deepEqual(fs.readdirSync(root), ['synthetic.json']);
  });

  for (const operation of ['create', 'delete'] as const) {
    it(`rejects an external ${operation} during retry (career-center fs-retry)`, async () => {
      if (operation === 'delete') fs.writeFileSync(file, 'original');
      const rename: Rename = fs.renameSync.bind(fs);
      let injected = false;
      mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
        if (!injected) {
          injected = true;
          if (operation === 'create') fs.writeFileSync(file, 'external creation'); else fs.unlinkSync(file);
          throw busy('EPERM');
        }
        return rename(from, to);
      });
      const result = await writeAtomic(file, 'stale', { ifMatch: operation === 'create' ? undefined : sha256('original') });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.status, 412);
      assert.equal(fs.existsSync(file), operation === 'create');
      assert.equal(fs.readdirSync(root).some(name => name.endsWith('.tmp')), false);
    });
  }

  for (const match of [undefined, '*', sha256('original')]) {
    it(`preserves valid writes after a transient lock (${match ?? 'create'}) (career-center fs-retry)`, async () => {
      if (match) fs.writeFileSync(file, 'original');
      const rename: Rename = fs.renameSync.bind(fs);
      let failOnce = true;
      mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
        if (failOnce) { failOnce = false; throw busy('EPERM'); }
        return rename(from, to);
      });
      assert.equal((await writeAtomic(file, 'saved', { ifMatch: match })).ok, true);
      assert.equal(fs.readFileSync(file, 'utf8'), 'saved');
    });
  }

  it('reports a target that stays locked as busy (503) and leaves the previous file untouched', async () => {
    fs.writeFileSync(file, 'original');
    mock.method(fs, 'renameSync', () => { throw busy('EPERM'); });
    const result = await writeAtomic(file, 'new', { ifMatch: '*' });
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.status, 503); assert.equal(result.reason, 'busy'); }
    assert.equal(fs.readFileSync(file, 'utf8'), 'original');
    assert.deepEqual(fs.readdirSync(root), ['synthetic.json']);
  });

  it('reports another file-system failure as a 500 result with its code, never a throw', async () => {
    mock.method(fs, 'writeFileSync', () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); });
    const result = await writeAtomic(file, 'x', { ifMatch: '*' });
    assert.equal(result.ok, false);
    if (!result.ok && result.reason === 'io') { assert.equal(result.status, 500); assert.equal(result.code, 'ENOSPC'); } else assert.fail('expected an io result');
  });

  it('serialises two writers of one file: the second sees the first one\'s ETag', async () => {
    const first = writeAtomic(file, 'one', { ifMatch: '*' });
    const second = writeAtomic(file, 'two');
    assert.equal((await first).ok, true);
    const late = await second;
    assert.equal(late.ok, false);
    if (!late.ok && late.reason === 'conflict') assert.equal(late.current, 'one');
  });

  it('appendLine creates the folder; listTree lists data files with ETags, sorted, skipping _derived and other kinds', () => {
    appendLine(path.join(root, 'logs', 'events.jsonl'), '{"a":1}');
    appendLine(path.join(root, 'logs', 'events.jsonl'), '{"b":2}\n');
    fs.mkdirSync(path.join(root, '_derived'));
    fs.writeFileSync(path.join(root, '_derived', 'status.json'), '{}');
    fs.writeFileSync(path.join(root, 'notes.md'), '# hi');
    fs.writeFileSync(path.join(root, 'image.png'), 'x');
    assert.equal(fs.readFileSync(path.join(root, 'logs', 'events.jsonl'), 'utf8'), '{"a":1}\n{"b":2}\n');
    const tree = listTree(root);
    assert.deepEqual(tree.map(entry => entry.path), ['logs/events.jsonl', 'notes.md']);
    assert.equal(tree[0]?.etag, sha256('{"a":1}\n{"b":2}\n'));
    assert.deepEqual(listTree(path.join(root, 'nope')), []);
    assert.deepEqual(listTree(root, { include: /\.png$/ }).map(entry => entry.path), ['image.png']);
  });
});
