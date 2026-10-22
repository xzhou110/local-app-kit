// Path containment for file APIs: a browser-supplied relative path must land under the data folder, on Windows too
// (backslashes, junctions, short names, trailing dots and spaces, alternate data streams).
// Lifted from career-center/server/fs.ts (safeUnder, safeRealUnder) and server/api.ts (profileFile), 2026-10-22.
import fs from 'node:fs';
import path from 'node:path';
export const toPosix = (p) => p.replace(/\\/g, '/');
/** Resolve a relative path safely under a base directory (containment, no backslashes, no '..'). Null when unsafe. */
export function safeUnder(baseDir, rel) {
    if (!rel || rel.includes('\\') || rel.includes('\0') || rel.startsWith('/'))
        return null;
    const norm = path.posix.normalize(rel);
    if (norm.startsWith('..') || norm.includes('/../') || norm === '.')
        return null;
    const abs = path.resolve(baseDir, norm);
    const base = path.resolve(baseDir) + path.sep;
    return abs.startsWith(base) ? abs : null;
}
/** Resolve the nearest existing ancestor too: a new file can sit below a junction that points outside the base. */
export function safeRealUnder(baseDir, rel) {
    const candidate = safeUnder(baseDir, rel);
    if (!candidate)
        return null;
    const base = fs.existsSync(baseDir) ? fs.realpathSync.native(baseDir) : path.resolve(baseDir);
    let ancestor = candidate;
    while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor)
        ancestor = path.dirname(ancestor);
    const target = path.resolve(fs.realpathSync.native(ancestor), path.relative(ancestor, candidate));
    return safeUnder(base, toPosix(path.relative(base, target)));
}
/** Win32 aliases of one file: the file system drops a trailing dot or space, and ':' opens an alternate data stream. */
export const hasWin32Alias = (rel) => rel.split('/').some(part => /[. ]$|:/.test(part));
/**
 * One filesystem identity for a browser-supplied path: containment, no Win32 aliases, existing aliases resolved
 * (junctions, short names), and on Windows a lowercased relative path, so schema lookup, permissions and the
 * per-path write mutex all see the same file. Null when the path is unsafe.
 */
export function canonicalFile(baseDir, input) {
    const candidate = safeUnder(baseDir, input);
    if (!candidate)
        return null;
    const normalized = toPosix(path.relative(baseDir, candidate));
    if (process.platform === 'win32' && hasWin32Alias(normalized))
        return null;
    const base = fs.existsSync(baseDir) ? fs.realpathSync.native(baseDir) : path.resolve(baseDir);
    const target = safeRealUnder(baseDir, normalized);
    if (!target)
        return null;
    const relative = toPosix(path.relative(base, target));
    const rel = process.platform === 'win32' ? relative.toLowerCase() : relative;
    const abs = safeUnder(base, rel);
    return abs ? { abs, rel } : null;
}
