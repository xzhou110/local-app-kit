// Request bodies with a byte limit. An oversized body answers 413 while the rest of it is still drained, so the
// client receives the answer; destroying the socket mid-upload only ever produced a connection reset. Malformed
// JSON answers 400 without echoing the body (it may hold private values).
// Lifted from career-center/server/api.ts (readBody, readJsonBody) and ai-usage-tracker/server/http.ts (body), 2026-10-22.
import type { IncomingMessage } from 'node:http';

export type BodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 413 | 400; reason: 'too-large' | 'malformed' | 'interrupted' | 'unreadable'; message: string };

const tooLarge = (): BodyResult<never> => ({ ok: false, status: 413, reason: 'too-large', message: 'The request body is too large.' });

/** Reads the whole body up to `limit` bytes. */
export function readBody(req: IncomingMessage, limit: number): Promise<BodyResult<Buffer>> {
  return new Promise(resolve => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) { req.resume(); resolve(tooLarge()); return; }
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return; // keep draining so the client gets the 413
      total += chunk.length;
      if (total > limit) { done = true; chunks.length = 0; resolve(tooLarge()); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!done) { done = true; resolve({ ok: true, value: Buffer.concat(chunks) }); } });
    req.on('aborted', () => { if (!done) { done = true; resolve({ ok: false, status: 400, reason: 'interrupted', message: 'The request was interrupted.' }); } });
    req.on('error', () => { if (!done) { done = true; resolve({ ok: false, status: 400, reason: 'unreadable', message: 'The request body could not be read.' }); } });
  });
}

export type JsonBodyOptions = {
  /** An empty body reads as `{}` instead of 400. */
  allowEmpty?: boolean | undefined;
  /** Only a JSON object passes; arrays, strings and numbers answer 400. */
  objectOnly?: boolean | undefined;
};

/** Reads and parses a JSON body up to `limit` bytes (default 64 KB). */
export async function readJsonBody(req: IncomingMessage, limit = 64 * 1024, opts: JsonBodyOptions = {}): Promise<BodyResult<unknown>> {
  const raw = await readBody(req, limit);
  if (!raw.ok) return raw;
  const text = raw.value.toString('utf8');
  if (!text.trim()) {
    if (opts.allowEmpty) return { ok: true, value: {} };
    return { ok: false, status: 400, reason: 'malformed', message: 'The JSON request body is invalid.' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, status: 400, reason: 'malformed', message: 'The JSON request body is invalid.' };
  }
  if (opts.objectOnly && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    return { ok: false, status: 400, reason: 'malformed', message: 'The request body must be a JSON object.' };
  }
  return { ok: true, value };
}
