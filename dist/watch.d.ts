import { type OwnWrites } from './atomic-write.ts';
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
export declare function watchDirs(root: string, dirs: string[], onBatch: (paths: string[]) => void, opts?: WatchOptions): () => void;
