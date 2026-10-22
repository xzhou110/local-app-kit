import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalFile, hasWin32Alias, safeRealUnder, safeUnder, toPosix } from './safe-path.ts';
import { removeTemp, tempDir } from './test-support.ts';

const win32 = process.platform === 'win32';
let root: string;
beforeEach(() => { root = tempDir(); });
afterEach(() => removeTemp(root));

describe('safe-path', () => {
  it('contains writes to the base dir and rejects traversal, absolute paths and backslashes (career-center server.test)', () => {
    const base = path.join(root, 'data', 'profiles', 'x');
    assert.equal(safeUnder(base, 'record/roles.json'), path.resolve(base, 'record/roles.json'));
    assert.equal(safeUnder(base, '../../../local/identity/x.json'), null);
    assert.equal(safeUnder(base, 'record/../../y/roles.json'), null);
    assert.equal(safeUnder(base, '/etc/passwd'), null);
    assert.equal(safeUnder(base, 'record\\roles.json'), null);
    assert.equal(safeUnder(base, ''), null);
    assert.equal(safeUnder(base, '.'), null);
    assert.equal(safeUnder(base, 'a\0b'), null);
    assert.equal(toPosix('a\\b\\c'), 'a/b/c');
  });

  it('resolves a directory alias (junction) to one identity, for a file that does not exist yet (career-center file-safety)', () => {
    const real = path.join(root, 'real');
    fs.mkdirSync(path.join(real, 'direction'), { recursive: true });
    const link = path.join(root, 'alias');
    fs.symlinkSync(real, link, win32 ? 'junction' : 'dir');
    const viaLink = safeRealUnder(link, 'direction/new.json');
    assert.ok(viaLink);
    assert.equal(fs.realpathSync.native(path.dirname(viaLink)), fs.realpathSync.native(path.join(real, 'direction')));
    const file = canonicalFile(link, 'direction/new.json');
    assert.ok(file);
    assert.equal(file.rel, 'direction/new.json');
    assert.ok(file.abs.toLowerCase().startsWith(fs.realpathSync.native(real).toLowerCase()));
    assert.equal(canonicalFile(link, '../outside.json'), null);
  });

  it('gives case and dot-segment aliases of one file the same canonical identity', () => {
    const base = path.join(root, 'data');
    fs.mkdirSync(path.join(base, 'direction'), { recursive: true });
    fs.writeFileSync(path.join(base, 'direction', 'plan.json'), '{}');
    const canonical = canonicalFile(base, 'direction/plan.json');
    assert.ok(canonical);
    for (const alias of ['direction/./plan.json', 'direction//plan.json', 'direction/sub/../plan.json', './direction/plan.json', ...(win32 ? ['DIRECTION/PLAN.JSON'] : [])]) {
      assert.deepEqual(canonicalFile(base, alias), canonical, alias);
    }
  });

  it('rejects Win32 trailing-dot, trailing-space and stream aliases', { skip: !win32 }, () => {
    const base = path.join(root, 'data');
    fs.mkdirSync(base);
    for (const alias of ['direction/plan.json.', 'direction/plan.json ', 'direction/plan.json::$DATA', 'direction./plan.json']) {
      assert.equal(hasWin32Alias(alias), true, alias);
      assert.equal(canonicalFile(base, alias), null, alias);
    }
    assert.equal(hasWin32Alias('direction/plan.json'), false);
  });
});
