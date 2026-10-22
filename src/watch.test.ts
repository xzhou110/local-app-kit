import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createOwnWrites, writeAtomic } from './atomic-write.ts';
import { watchDirs } from './watch.ts';
import { removeTemp, sleep, tempDir, waitFor } from './test-support.ts';

describe('watch', () => {
  it('reports outside edits and deletions in batches, suppresses the echo of own writes, ignores temp and other files', async () => {
    const root = tempDir();
    const data = path.join(root, 'data');
    fs.mkdirSync(data);
    const ownWrites = createOwnWrites();
    const batches: string[][] = [];
    const stop = watchDirs(root, ['data', 'absent'], paths => batches.push(paths), { ownWrites, debounceMs: 50 });
    try {
      await sleep(150); // let the watcher arm
      await writeAtomic(path.join(data, 'own.json'), '{"own":1}', { ifMatch: '*', ownWrites });
      await sleep(500);
      assert.deepEqual(batches, [], 'an own write must not echo');
      fs.writeFileSync(path.join(data, 'outside.json'), '{"edit":1}');
      fs.writeFileSync(path.join(data, 'scratch.tmp'), 'x');
      fs.writeFileSync(path.join(data, 'photo.png'), 'x');
      await waitFor(() => batches.length >= 1, 'the outside edit');
      assert.deepEqual(batches[0], ['data/outside.json']);
      fs.unlinkSync(path.join(data, 'outside.json'));
      await waitFor(() => batches.length >= 2, 'the deletion');
      assert.deepEqual(batches[1], ['data/outside.json']);
    } finally {
      stop();
      removeTemp(root);
    }
  });
});
