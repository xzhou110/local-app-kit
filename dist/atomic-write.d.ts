/** The ETag of the last write this process made to each file (own-write key → sha256). One per server. */
export type OwnWrites = Map<string, string>;
export declare const createOwnWrites: () => OwnWrites;
/** The ledger key of an absolute path; the watcher uses the same function. */
export declare const ownWriteKey: (abs: string) => string;
export type FileRead = {
    raw: string;
    etag: string;
};
/** The file's text and ETag, or null when there is no file there (a directory is "not a file", never an EISDIR crash). */
export declare function readWithEtag(abs: string): FileRead | null;
/** Runs fn after every earlier operation on the same path has settled (one writer per file inside this process). */
export declare function withPathLock<T>(abs: string, fn: () => Promise<T>): Promise<T>;
export type WriteResult = {
    ok: true;
    etag: string;
}
/** The file is not what the caller expected: its current ETag and text come back so the app can show the conflict. */
 | {
    ok: false;
    reason: 'conflict';
    status: 412;
    etag?: string;
    current?: string;
}
/** The target stayed locked through every retry; the previous file is untouched. */
 | {
    ok: false;
    reason: 'busy';
    status: 503;
}
/** Another file-system failure (a full disk, a read-only folder); the previous file is untouched. */
 | {
    ok: false;
    reason: 'io';
    status: 500;
    code: string;
    message: string;
};
export type WriteOptions = {
    /**
     * The precondition: `*` writes whatever is there; a hash means the file must still carry that ETag; undefined
     * (the default) means the file must not exist yet, so a caller that forgot its ETag can never overwrite a file.
     */
    ifMatch?: string | undefined;
    /** The server's own-write ledger, so the watcher skips the echo of this write. */
    ownWrites?: OwnWrites | undefined;
};
/** Atomic write with optimistic concurrency. Never throws for a file-system failure; the result says what happened. */
export declare function writeAtomic(abs: string, text: string, opts?: WriteOptions): Promise<WriteResult>;
/** Removes a file under the same per-path mutex; false when there was none. */
export declare function deleteFile(abs: string, opts?: {
    ownWrites?: OwnWrites | undefined;
}): Promise<boolean>;
/** Appends one line to a log file (a JSON Lines ledger), creating the folder on the way. */
export declare function appendLine(abs: string, line: string): void;
export type TreeEntry = {
    path: string;
    etag: string;
    size: number;
    mtime: string;
};
export type ListOptions = {
    /** Relative (posix) paths to leave out; the default skips `_derived` folders. */
    skip?: RegExp | undefined;
    /** Which files count; the default is JSON, JSON Lines and Markdown. */
    include?: RegExp | undefined;
};
/** Lists the data files under a directory with their ETags; paths are relative to that directory (posix), sorted. */
export declare function listTree(baseDir: string, opts?: ListOptions): TreeEntry[];
