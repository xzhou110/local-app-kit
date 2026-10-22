import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LOCK_FILE, RECOVERY_FILE, acquireServerLock, parseLockOwner, readServerLock } from './server-lock.ts';
import { removeTemp, tempDir } from './test-support.ts';

const deadPid = 2_147_483_647;
let root: string;
let dir: string;
beforeEach(() => { root = tempDir(); dir = path.join(root, 'local'); });
afterEach(() => removeTemp(root));

describe('server lock (ai-usage-tracker lock tests)', () => {
  it('allows exactly one owner across repeated simultaneous stale-lock recoveries', async () => {
    fs.mkdirSync(dir);
    assert.throws(() => process.kill(deadPid, 0));
    for (let round = 0; round < 25; round++) {
      fs.writeFileSync(path.join(dir, LOCK_FILE), JSON.stringify({ pid: deadPid, port: 0, token: `dead-${round}` }));
      const contenders = await Promise.all(Array.from({ length: 12 }, () => acquireServerLock(dir, { port: 0 })));
      const owners = contenders.filter(result => result.ok);
      try {
        assert.equal(owners.length, 1);
        for (const result of contenders) if (!result.ok) assert.ok(['recovering', 'held'].includes(result.reason), result.reason);
        assert.equal(readServerLock(dir)?.pid, process.pid);
        const again = await acquireServerLock(dir, { port: 0, appName: 'Synthetic App' });
        assert.equal(again.ok, false);
        if (!again.ok) { assert.equal(again.reason, 'held'); assert.ok(again.message.includes('Synthetic App')); }
      } finally {
        await Promise.all(owners.map(owner => (owner.ok ? owner.release() : Promise.resolve())));
      }
    }
  });

  it('keeps an interrupted recovery guard intact instead of racing its replacement', async () => {
    fs.mkdirSync(dir);
    const bytes = JSON.stringify({ pid: deadPid, port: 0, token: 'synthetic-interrupted-recovery' }); // secret-scan: allow (synthetic lock-owner fixture, not a credential)
    fs.writeFileSync(path.join(dir, LOCK_FILE), bytes);
    fs.writeFileSync(path.join(dir, RECOVERY_FILE), bytes);
    const contenders = await Promise.all(Array.from({ length: 12 }, () => acquireServerLock(dir, { port: 0 })));
    assert.ok(contenders.every(result => !result.ok && result.reason === 'recovery-interrupted' && result.message.includes(RECOVERY_FILE)));
    assert.equal(fs.readFileSync(path.join(dir, LOCK_FILE), 'utf8'), bytes);
    assert.equal(fs.readFileSync(path.join(dir, RECOVERY_FILE), 'utf8'), bytes);
  });

  it('makes release idempotent so an old release cannot delete a successor', async () => {
    const first = await acquireServerLock(dir, { port: 0 });
    assert.ok(first.ok);
    if (!first.ok) return;
    await Promise.all([first.release(), first.release()]);
    assert.equal(fs.existsSync(first.file), false);
    const successor = await acquireServerLock(dir, { port: 8175 });
    assert.ok(successor.ok);
    if (!successor.ok) return;
    try {
      const current = fs.readFileSync(successor.file, 'utf8');
      await first.release();
      assert.equal(fs.readFileSync(successor.file, 'utf8'), current);
      assert.deepEqual(readServerLock(dir), { pid: process.pid, port: 8175 });
      const third = await acquireServerLock(dir, { port: 0 });
      assert.equal(third.ok, false);
      if (!third.ok) assert.equal(third.reason, 'held');
    } finally { await successor.release(); }
  });

  it('reports an unreadable lock instead of replacing it, and reads owners defensively', async () => {
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, LOCK_FILE), 'not json');
    const result = await acquireServerLock(dir, { port: 0 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'unreadable');
    assert.equal(fs.readFileSync(path.join(dir, LOCK_FILE), 'utf8'), 'not json');
    assert.equal(fs.existsSync(path.join(dir, RECOVERY_FILE)), false);
    assert.equal(readServerLock(dir), null);
    assert.equal(parseLockOwner('{"pid":0}'), null);
    assert.equal(parseLockOwner('{"pid":"7"}')?.pid, 7);
    assert.deepEqual(parseLockOwner('{"pid":7}'), { pid: 7, port: 0 });
  });
});
