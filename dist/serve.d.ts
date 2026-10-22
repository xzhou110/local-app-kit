import http from 'node:http';
import type { Handler } from './static-handler.ts';
export type ServeOptions = {
    port: number;
    handler: Handler;
    /** Default 127.0.0.1; never 0.0.0.0 for a private app. */
    host?: string | undefined;
    /** Node's `server.requestTimeout`; unset keeps Node's default. */
    requestTimeoutMs?: number | undefined;
    /** Node's `server.headersTimeout`; unset keeps Node's default. */
    headersTimeoutMs?: number | undefined;
    /** Where client and server errors are logged (default console.error). */
    log?: ((message: string) => void) | undefined;
};
export type ServeResult = {
    ok: true;
    server: http.Server;
    port: number;
    url: string;
    close: (opts?: {
        force?: boolean;
    }) => Promise<void>;
} | {
    ok: false;
    reason: 'port-in-use' | 'listen-failed';
    code: string;
    message: string;
};
/** A port from an argument or environment value: an integer 0 to 65535, the fallback when empty, null when invalid. */
export declare function parsePort(value: string | number | undefined, fallback: number): number | null;
/** Logs instead of exiting on an uncaught exception or unhandled rejection; returns a function that removes the guards. */
export declare function installCrashGuards(log?: (message: string) => void): () => void;
/** Starts an HTTP server on the loopback interface; port 0 picks a free port (tests). */
export declare function listenLoopback(opts: ServeOptions): Promise<ServeResult>;
