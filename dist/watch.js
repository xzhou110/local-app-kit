// A debounced recursive watcher over the data folders: one batch of changed paths per burst of file events, with
// the echo of this process's own writes suppressed through the own-write ledger (the watcher sees our rename land;
// the file's ETag equals the one we just wrote, so the batch leaves it out). A watcher that errors re-arms with
// backoff. Lifted from career-center/server/fs.ts (watchDirs), 2026-10-22.
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from "./etag.js";
import { toPosix } from "./safe-path.js";
import { ownWriteKey } from "./atomic-write.js";
/**
 * Watches `dirs` (relative to `root`) recursively and calls onBatch with the changed paths, relative to `root` in
 * posix form; a deleted file is reported too. Returns a function that stops watching.
 */
export function watchDirs(root, dirs, onBatch, opts = {}) {
    const debounceMs = opts.debounceMs ?? 150;
    const include = opts.include ?? /\.(json|jsonl|md)$/;
    const ignore = opts.ignore ?? /\.tmp$|(^|\/)_derived\//;
    let timer = null;
    const pending = new Set();
    const watchers = [];
    let closed = false;
    const flush = () => {
        timer = null;
        const paths = [];
        for (const rel of pending) {
            const abs = path.join(root, rel);
            if (!fs.existsSync(abs)) {
                paths.push(rel);
                continue;
            }
            try {
                const etag = sha256(fs.readFileSync(abs));
                if (opts.ownWrites?.get(ownWriteKey(abs)) === etag)
                    continue;
            }
            catch {
                continue;
            }
            paths.push(rel);
        }
        pending.clear();
        if (paths.length)
            onBatch(paths);
    };
    const start = (dir, attempt = 0) => {
        if (closed || !fs.existsSync(dir))
            return;
        const retry = () => setTimeout(() => start(dir, attempt + 1), Math.min(5000, 200 * 2 ** attempt)).unref();
        try {
            const watcher = fs.watch(dir, { recursive: true }, (_event, name) => {
                if (name == null)
                    return;
                const rel = toPosix(path.relative(root, path.join(dir, String(name))));
                if (ignore.test(rel) || !include.test(rel))
                    return;
                pending.add(rel);
                if (timer)
                    clearTimeout(timer);
                timer = setTimeout(flush, debounceMs);
            });
            watcher.on('error', () => { try {
                watcher.close();
            }
            catch { /* already closed */ } retry(); });
            watchers.push(watcher);
        }
        catch {
            retry();
        }
    };
    for (const dir of dirs)
        start(path.join(root, dir));
    return () => {
        closed = true;
        if (timer)
            clearTimeout(timer);
        for (const watcher of watchers) {
            try {
                watcher.close();
            }
            catch { /* already closed */ }
        }
    };
}
