// The loopback listener of a daily server: bound to 127.0.0.1 only, a malformed request answers 400 instead of a
// reset, a taken port is a clear message and a failed start (so a launcher never reports it as running), and the
// crash guards keep one stray exception or rejection from taking the server down.
// Lifted from the main files of career-center, ai-usage-tracker, creator-advisors and x-command-center, 2026-10-22.
import http from 'node:http';
import type { Socket } from 'node:net';
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

export type ServeResult =
  | { ok: true; server: http.Server; port: number; url: string; close: (opts?: { force?: boolean }) => Promise<void> }
  | { ok: false; reason: 'port-in-use' | 'listen-failed'; code: string; message: string };

/** A port from an argument or environment value: an integer 0 to 65535, the fallback when empty, null when invalid. */
export function parsePort(value: string | number | undefined, fallback: number): number | null {
  const n = value === undefined || value === '' ? fallback : Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : null;
}

/** Logs instead of exiting on an uncaught exception or unhandled rejection; returns a function that removes the guards. */
export function installCrashGuards(log: (message: string) => void = message => console.error(message)): () => void {
  const onException = (error: Error) => log(`[uncaught] ${error.message}`);
  const onRejection = (reason: unknown) => log(`[unhandled rejection] ${reason instanceof Error ? reason.message : String(reason)}`);
  process.on('uncaughtException', onException);
  process.on('unhandledRejection', onRejection);
  return () => { process.off('uncaughtException', onException); process.off('unhandledRejection', onRejection); };
}

/** Starts an HTTP server on the loopback interface; port 0 picks a free port (tests). */
export async function listenLoopback(opts: ServeOptions): Promise<ServeResult> {
  const host = opts.host ?? '127.0.0.1';
  const log = opts.log ?? (message => console.error(message));
  const server = http.createServer(opts.handler);
  if (opts.requestTimeoutMs !== undefined) server.requestTimeout = opts.requestTimeoutMs;
  if (opts.headersTimeoutMs !== undefined) server.headersTimeout = opts.headersTimeoutMs;
  server.on('clientError', (error: Error & { code?: string }, socket: Socket) => {
    if (error.code !== 'ECONNRESET' && socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    else socket.destroy();
    log(`[client error] ${error.message}`);
  });
  const failure = await new Promise<{ code: string; message: string } | null>(resolve => {
    const onError = (error: NodeJS.ErrnoException) => resolve({ code: error.code ?? 'ERROR', message: error.message });
    server.once('error', onError);
    server.listen(opts.port, host, () => { server.off('error', onError); resolve(null); });
  });
  if (failure) {
    return failure.code === 'EADDRINUSE'
      ? { ok: false, reason: 'port-in-use', code: failure.code, message: `Port ${opts.port} is already in use. Is the app already running?` }
      : { ok: false, reason: 'listen-failed', code: failure.code, message: failure.message };
  }
  server.on('error', error => log(`[server error] ${error.message}`));
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : opts.port;
  let closing: Promise<void> | undefined;
  const close = ({ force = false }: { force?: boolean } = {}) => closing ??= new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
    if (force) server.closeAllConnections();
    else server.closeIdleConnections();
  });
  return { ok: true, server, port, url: `http://127.0.0.1:${port}`, close };
}
