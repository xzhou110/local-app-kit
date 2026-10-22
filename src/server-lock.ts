// One daily server per data folder. The lock file holds the owner's pid, port and a random token; a stale lock (its
// process is gone) is taken over, but only by one contender at a time: a second exclusive file, the recovery guard,
// serialises every stale-lock judgement, so two launches that race cannot both delete the stale file and both win.
// Nothing here ever kills a process; a live owner is reported, never removed. Release is idempotent and only
// removes the file it wrote, so an old release cannot delete a successor's lock.
// Lifted from ai-usage-tracker/server/lock.ts (three tests behind it), 2026-10-22.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

export type LockRelease = () => Promise<void>;
export type LockOwner = { pid: number; port: number };
export type LockResult =
  | { ok: true; release: LockRelease; file: string }
  | { ok: false; reason: 'held'; message: string; owner: LockOwner }
  | { ok: false; reason: 'recovering' | 'recovery-interrupted' | 'unreadable' | 'lost' | 'io'; message: string };

const errorCode = (error: unknown): string => (error as NodeJS.ErrnoException)?.code ?? '';
export const LOCK_FILE = 'server.lock';
export const RECOVERY_FILE = 'server-recovery.lock';

/** Reads a lock file's owner; null when the bytes are not a lock this module wrote. */
export function parseLockOwner(bytes: string): LockOwner | null {
  try {
    const value: unknown = JSON.parse(bytes);
    if (!value || typeof value !== 'object' || !('pid' in value)) return null;
    const pid = Number((value as { pid: unknown }).pid);
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2_147_483_647) return null;
    const port = Number((value as { port?: unknown }).port);
    return { pid, port: Number.isSafeInteger(port) ? port : 0 };
  } catch { return null; }
}

/** True unless the process is known to be gone; a permission error counts as alive (fail closed). */
export function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return errorCode(error) !== 'ESRCH'; }
}

/** The owner recorded in a folder's lock file, for launchers and doctors; null when there is none or it is unreadable. */
export function readServerLock(dir: string): LockOwner | null {
  try { return parseLockOwner(fs.readFileSync(path.join(dir, LOCK_FILE), 'utf8')); }
  catch { return null; }
}

type Exclusive = { outcome: 'created'; release: LockRelease } | { outcome: 'exists' } | { outcome: 'failed'; message: string };

async function createExclusive(file: string, bytes: string, what: string): Promise<Exclusive> {
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) {
    if (errorCode(error) === 'EEXIST') return { outcome: 'exists' };
    return { outcome: 'failed', message: `${what} could not be created (${errorCode(error) || 'error'}).` };
  }
  try { await handle.writeFile(bytes, 'utf8'); await handle.sync(); }
  catch {
    await handle.close();
    // This incomplete file still belongs to us; malformed locks are never reclaimed elsewhere.
    await unlink(file).catch(() => {});
    return { outcome: 'failed', message: `${what} could not be saved.` };
  }
  await handle.close();
  let released: Promise<void> | undefined;
  const release: LockRelease = () => released ??= (async () => {
    try { if (await readFile(file, 'utf8') === bytes) await unlink(file); }
    catch (error) { if (errorCode(error) !== 'ENOENT') throw new Error(`${what} could not be removed.`, { cause: error }); }
  })();
  return { outcome: 'created', release };
}

/** Takes the server lock in `dir` (created if missing) for this process, or says why not. Never kills anything. */
export async function acquireServerLock(dir: string, info: { port: number; appName?: string | undefined }): Promise<LockResult> {
  const app = info.appName ?? 'the app';
  const file = path.join(dir, LOCK_FILE);
  const recoveryFile = path.join(dir, RECOVERY_FILE);
  try { await mkdir(dir, { recursive: true }); }
  catch (error) { return { ok: false, reason: 'io', message: `The lock folder could not be created (${errorCode(error) || 'error'}).` }; }
  const bytes = JSON.stringify({ pid: process.pid, port: info.port, token: randomUUID() });
  const first = await createExclusive(file, bytes, 'The server lock');
  if (first.outcome === 'created') return { ok: true, release: first.release, file };
  if (first.outcome === 'failed') return { ok: false, reason: 'io', message: first.message };

  const guard = await createExclusive(recoveryFile, bytes, 'The lock recovery guard');
  if (guard.outcome === 'failed') return { ok: false, reason: 'io', message: guard.message };
  if (guard.outcome === 'exists') {
    // A crashed recovery is deliberately fail-closed: deleting this guard automatically would recreate the same
    // stale-delete race one level higher.
    let active = true;
    try { const holder = parseLockOwner(await readFile(recoveryFile, 'utf8')); active = holder ? isProcessAlive(holder.pid) : true; }
    catch { /* the current writer may not have finished yet */ }
    return active
      ? { ok: false, reason: 'recovering', message: `Another ${app} launch is checking the server lock. Wait a moment before trying again.` }
      : { ok: false, reason: 'recovery-interrupted', message: `A previous lock recovery was interrupted. After confirming ${app} is stopped, remove ${recoveryFile} and try again.` };
  }
  try {
    let previous: string | undefined;
    try { previous = await readFile(file, 'utf8'); }
    catch (error) { if (errorCode(error) !== 'ENOENT') return { ok: false, reason: 'io', message: 'The server lock could not be checked.' }; }
    if (previous !== undefined) {
      const owner = parseLockOwner(previous);
      if (!owner) return { ok: false, reason: 'unreadable', message: `An unreadable server lock exists at ${file}. Check whether ${app} is running before removing it.` };
      if (isProcessAlive(owner.pid)) return { ok: false, reason: 'held', message: `Another ${app} server (process ${owner.pid}, port ${owner.port}) owns this data folder. Stop it first.`, owner };
      // Every contender that could delete a stale file holds the guard, so nobody acts on a stale read after a
      // successor has claimed the lock.
      try { await unlink(file); }
      catch (error) { if (errorCode(error) !== 'ENOENT') return { ok: false, reason: 'io', message: 'The stale server lock could not be removed.' }; }
    }
    const second = await createExclusive(file, bytes, 'The server lock');
    if (second.outcome === 'created') return { ok: true, release: second.release, file };
    if (second.outcome === 'failed') return { ok: false, reason: 'io', message: second.message };
    return { ok: false, reason: 'lost', message: `Another ${app} server acquired the data folder.` };
  } finally { await guard.release(); }
}
