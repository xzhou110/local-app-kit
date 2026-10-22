// A debounced recursive watcher over the data folders: one batch of changed paths per burst of file events, with
// the echo of this process's own writes suppressed through the own-write ledger (the watcher sees our rename land;
// the file's ETag equals the one we just wrote, so the batch leaves it out). A watcher that errors re-arms with
// backoff. Lifted from career-center/server/fs.ts (watchDirs), 2026-10-22.
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './etag.ts';
import { toPosix } from './safe-path.ts';
import { ownWriteKey, type OwnWrites } from './atomic-write.ts';

export type WatchOptions = {
  /** The server's own-write ledger; a change whose ETag matches the last own write is an echo, not an edit. */
  ownWrites?: OwnWrites | undefined;
  /** Quiet time after the last event before a batch is emitted (default 150 ms). */
  debounceMs?: number | undefined;
  /** Which files count (default JSON, JSON Lines and Markdown). */
  include?: RegExp | undefined;
  /** Paths to ignore (default temp files and `_derived` folders). */
  ignore?: RegExp | undefined;
};

/**
 * Watches `dirs` (relative to `root`) recursively and calls onBatch with the changed paths, relative to `root` in
 * posix form; a deleted file is reported too. Returns a function that stops watching.
 */
export function watchDirs(root: string, dirs: string[], onBatch: (paths: string[]) => void, opts: WatchOptions = {}): () => void {
  const debounceMs = opts.debounceMs ?? 150;
  const include = opts.include ?? /\.(json|jsonl|md)$/;
  const ignore = opts.ignore ?? /\.tmp$|(^|\/)_derived\//;
  let timer: NodeJS.Timeout | null = null;
  const pending = new Set<string>();
  const watchers: fs.FSWatcher[] = [];
  let closed = false;
  const flush = () => {
    timer = null;
    const paths: string[] = [];
    for (const rel of pending) {
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) { paths.push(rel); continue; }
      try {
        const etag = sha256(fs.readFileSync(abs));
        if (opts.ownWrites?.get(ownWriteKey(abs)) === etag) continue;
      } catch { continue; }
      paths.push(rel);
    }
    pending.clear();
    if (paths.length) onBatch(paths);
  };
  const start = (dir: string, attempt = 0) => {
    if (closed || !fs.existsSync(dir)) return;
    const retry = () => setTimeout(() => start(dir, attempt + 1), Math.min(5000, 200 * 2 ** attempt)).unref();
    try {
      const watcher = fs.watch(dir, { recursive: true }, (_event, name) => {
        if (name == null) return;
        const rel = toPosix(path.relative(root, path.join(dir, String(name))));
        if (ignore.test(rel) || !include.test(rel)) return;
        pending.add(rel);
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, debounceMs);
      });
      watcher.on('error', () => { try { watcher.close(); } catch { /* already closed */ } retry(); });
      watchers.push(watcher);
    } catch { retry(); }
  };
  for (const dir of dirs) start(path.join(root, dir));
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    for (const watcher of watchers) { try { watcher.close(); } catch { /* already closed */ } }
  };
}
