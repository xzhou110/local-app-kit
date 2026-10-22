// Atomic JSON-file writes with optimistic concurrency: a temp file beside the target, then a rename, retried when
// Windows holds the target (EPERM, EACCES, EBUSY: an editor or indexer has it open), with the If-Match conflict check
// re-run immediately before EVERY rename attempt, because an external editor can save the target between retries and
// the write must then answer 412 instead of overwriting it. A per-path mutex serialises writers inside one process,
// and the own-write ledger lets the watcher tell an echo of our own write from an outside edit.
// Lifted from career-center/server/fs.ts (the local-private-app reference), 2026-10-22.
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './etag.ts';
import { toPosix } from './safe-path.ts';

/** The ETag of the last write this process made to each file (own-write key → sha256). One per server. */
export type OwnWrites = Map<string, string>;
export const createOwnWrites = (): OwnWrites => new Map();
/** The ledger key of an absolute path; the watcher uses the same function. */
export const ownWriteKey = (abs: string): string => toPosix(path.resolve(abs));

export type FileRead = { raw: string; etag: string };

/** The file's text and ETag, or null when there is no file there (a directory is "not a file", never an EISDIR crash). */
export function readWithEtag(abs: string): FileRead | null {
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  const buf = fs.readFileSync(abs);
  return { raw: buf.toString('utf8'), etag: sha256(buf) };
}

const locks = new Map<string, Promise<unknown>>();
/** Runs fn after every earlier operation on the same path has settled (one writer per file inside this process). */
export function withPathLock<T>(abs: string, fn: () => Promise<T>): Promise<T> {
  const key = ownWriteKey(abs);
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);
const DELAYS = [10, 20, 40, 80, 160, 320];
const errorCode = (e: unknown): string => (e as NodeJS.ErrnoException)?.code ?? '';

async function renameWithRetry(from: string, to: string, check: () => void): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    // Windows can release the target between attempts while an external editor saves it: recheck before every rename.
    check();
    try {
      fs.renameSync(from, to);
      return;
    } catch (e: unknown) {
      if (!TRANSIENT.has(errorCode(e)) || attempt >= DELAYS.length) throw e;
      await sleep(DELAYS[attempt] ?? 320);
    }
  }
}

export type WriteResult =
  | { ok: true; etag: string }
  /** The file is not what the caller expected: its current ETag and text come back so the app can show the conflict. */
  | { ok: false; reason: 'conflict'; status: 412; etag?: string; current?: string }
  /** The target stayed locked through every retry; the previous file is untouched. */
  | { ok: false; reason: 'busy'; status: 503 }
  /** Another file-system failure (a full disk, a read-only folder); the previous file is untouched. */
  | { ok: false; reason: 'io'; status: 500; code: string; message: string };

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
export function writeAtomic(abs: string, text: string, opts: WriteOptions = {}): Promise<WriteResult> {
  const { ifMatch, ownWrites } = opts;
  return withPathLock(abs, async () => {
    const conflict = (): WriteResult | null => {
      if (ifMatch === '*') return null;
      const cur = readWithEtag(abs);
      if (cur && cur.etag !== ifMatch) return { ok: false, reason: 'conflict', status: 412, etag: cur.etag, current: cur.raw };
      if (!cur && ifMatch) return { ok: false, reason: 'conflict', status: 412 };
      return null;
    };
    let changed = conflict();
    if (changed) return changed;
    const tmp = `${abs}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(tmp, text, { flag: 'wx', flush: true });
      await renameWithRetry(tmp, abs, () => {
        changed = conflict();
        if (changed) throw new Error('atomic write conflict');
      });
    } catch (e: unknown) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to remove */ }
      if (changed) return changed;
      const code = errorCode(e);
      if (TRANSIENT.has(code)) return { ok: false, reason: 'busy', status: 503 };
      if (/^E[A-Z0-9]+$/.test(code)) return { ok: false, reason: 'io', status: 500, code, message: (e as Error).message };
      throw e;
    }
    const etag = sha256(text);
    ownWrites?.set(ownWriteKey(abs), etag);
    return { ok: true, etag };
  });
}

/** Removes a file under the same per-path mutex; false when there was none. */
export function deleteFile(abs: string, opts: { ownWrites?: OwnWrites | undefined } = {}): Promise<boolean> {
  return withPathLock(abs, async () => {
    if (!fs.existsSync(abs)) return false;
    fs.rmSync(abs);
    opts.ownWrites?.delete(ownWriteKey(abs));
    return true;
  });
}

/** Appends one line to a log file (a JSON Lines ledger), creating the folder on the way. */
export function appendLine(abs: string, line: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, line.endsWith('\n') ? line : line + '\n');
}

export type TreeEntry = { path: string; etag: string; size: number; mtime: string };
export type ListOptions = {
  /** Relative (posix) paths to leave out; the default skips `_derived` folders. */
  skip?: RegExp | undefined;
  /** Which files count; the default is JSON, JSON Lines and Markdown. */
  include?: RegExp | undefined;
};

/** Lists the data files under a directory with their ETags; paths are relative to that directory (posix), sorted. */
export function listTree(baseDir: string, opts: ListOptions = {}): TreeEntry[] {
  const skip = opts.skip ?? /(^|\/)(_derived)(\/|$)/;
  const include = opts.include ?? /\.(json|jsonl|md)$/;
  const out: TreeEntry[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = toPosix(path.relative(baseDir, abs));
      if (skip.test(rel)) continue;
      if (entry.isDirectory()) walk(abs);
      else if (include.test(entry.name)) {
        const st = fs.statSync(abs);
        out.push({ path: rel, etag: sha256(fs.readFileSync(abs)), size: st.size, mtime: st.mtime.toISOString() });
      }
    }
  };
  if (fs.existsSync(baseDir)) walk(baseDir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
