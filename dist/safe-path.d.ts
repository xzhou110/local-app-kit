export declare const toPosix: (p: string) => string;
/** Resolve a relative path safely under a base directory (containment, no backslashes, no '..'). Null when unsafe. */
export declare function safeUnder(baseDir: string, rel: string): string | null;
/** Resolve the nearest existing ancestor too: a new file can sit below a junction that points outside the base. */
export declare function safeRealUnder(baseDir: string, rel: string): string | null;
/** Win32 aliases of one file: the file system drops a trailing dot or space, and ':' opens an alternate data stream. */
export declare const hasWin32Alias: (rel: string) => boolean;
/**
 * One filesystem identity for a browser-supplied path: containment, no Win32 aliases, existing aliases resolved
 * (junctions, short names), and on Windows a lowercased relative path, so schema lookup, permissions and the
 * per-path write mutex all see the same file. Null when the path is unsafe.
 */
export declare function canonicalFile(baseDir: string, input: string): {
    abs: string;
    rel: string;
} | null;
