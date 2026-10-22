export type LockRelease = () => Promise<void>;
export type LockOwner = {
    pid: number;
    port: number;
};
export type LockResult = {
    ok: true;
    release: LockRelease;
    file: string;
} | {
    ok: false;
    reason: 'held';
    message: string;
    owner: LockOwner;
} | {
    ok: false;
    reason: 'recovering' | 'recovery-interrupted' | 'unreadable' | 'lost' | 'io';
    message: string;
};
export declare const LOCK_FILE = "server.lock";
export declare const RECOVERY_FILE = "server-recovery.lock";
/** Reads a lock file's owner; null when the bytes are not a lock this module wrote. */
export declare function parseLockOwner(bytes: string): LockOwner | null;
/** True unless the process is known to be gone; a permission error counts as alive (fail closed). */
export declare function isProcessAlive(pid: number): boolean;
/** The owner recorded in a folder's lock file, for launchers and doctors; null when there is none or it is unreadable. */
export declare function readServerLock(dir: string): LockOwner | null;
/** Takes the server lock in `dir` (created if missing) for this process, or says why not. Never kills anything. */
export declare function acquireServerLock(dir: string, info: {
    port: number;
    appName?: string | undefined;
}): Promise<LockResult>;
