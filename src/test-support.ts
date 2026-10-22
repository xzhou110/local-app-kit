// Helpers shared by the module tests and the parity suite: temp folders that are removed only when they are ours,
// a real server on an ephemeral port, plain and raw HTTP requests, and an SSE reader. Not part of the package.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Handler } from './static-handler.ts';

const PREFIX = 'local-app-kit-test-';

/** A fresh folder under the OS temp directory. */
export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
}

/** Removes a folder made by tempDir(); refuses anything else, so a wrong path can never delete real data. */
export function removeTemp(dir: string): void {
  const resolved = path.resolve(dir);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith(PREFIX)) throw new Error(`refusing to remove ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
}

export type Started = { server: http.Server; port: number; url: string; close: () => Promise<void> };

/** A real listener on 127.0.0.1 and a free port; the handler can be swapped after start through `setHandler`. */
export async function listen(handler: Handler): Promise<Started & { setHandler: (next: Handler) => void }> {
  let current = handler;
  const server = http.createServer((req, res) => current(req, res));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    server, port, url: `http://127.0.0.1:${port}`,
    setHandler: next => { current = next; },
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

export type Response = { status: number; headers: http.IncomingHttpHeaders; body: string };

/** One HTTP request; the Host header defaults to the server's own address. */
export function request(port: number, target: string, opts: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, method: opts.method ?? 'GET', headers: { host: `127.0.0.1:${port}`, ...(opts.headers ?? {}) } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

/** Sends raw bytes over a socket (for request lines http.request would refuse to send) and returns the response text. */
export function rawRequest(port: number, bytes: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let text = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(bytes));
    socket.on('data', chunk => { text += chunk; if (/\r\n\r\n/.test(text)) socket.end(); });
    socket.on('close', () => resolve(text));
    socket.on('error', reject);
    socket.setTimeout(3000, () => { socket.destroy(); resolve(text); });
  });
}

/** Opens an SSE stream and resolves with the first `count` named events (`event: name` lines) as `{ event, data }`. */
export function readEvents(port: number, target: string, count: number, timeoutMs = 5000): Promise<{ events: Array<{ event: string; data: string }>; stop: () => void }> {
  return new Promise((resolve, reject) => {
    const events: Array<{ event: string; data: string }> = [];
    const req = http.request({ host: '127.0.0.1', port, path: target, headers: { host: `127.0.0.1:${port}` } }, res => {
      let buffer = '';
      const stop = () => { req.destroy(); };
      const timer = setTimeout(() => { stop(); resolve({ events, stop }); }, timeoutMs);
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        let index: number;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event !== undefined) events.push({ event, data: data ?? '' });
          if (events.length >= count) { clearTimeout(timer); resolve({ events, stop }); return; }
        }
      });
      res.on('error', () => { clearTimeout(timer); resolve({ events, stop }); });
    });
    req.on('error', reject);
    req.end();
  });
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Polls until the condition holds; fails the test with `label` when it does not within the timeout. */
export async function waitFor(condition: () => boolean, label: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(25);
  }
}

/** Reads a streamed response body until the predicate holds (or the timeout), then returns the text so far. */
export function readUntil(port: number, target: string, predicate: (text: string) => boolean, timeoutMs = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, headers: { host: `127.0.0.1:${port}` } }, res => {
      let text = '';
      const finish = () => { clearTimeout(timer); req.destroy(); resolve(text); };
      const timer = setTimeout(finish, timeoutMs);
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; if (predicate(text)) finish(); });
      res.on('end', finish);
    });
    req.on('error', reject);
    req.end();
  });
}
