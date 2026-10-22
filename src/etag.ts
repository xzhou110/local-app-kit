// Content-hash ETags: the ETag of a file is the sha256 of its bytes, so two processes that never talk agree on it.
// Lifted from career-center/server/fs.ts and server/api.ts (2026-10-22).
import crypto from 'node:crypto';

/** sha256 hex of a string or buffer. */
export const sha256 = (data: Buffer | string): string => crypto.createHash('sha256').update(data).digest('hex');

/** The quoted form an ETag response header carries. */
export const quoteEtag = (etag: string): string => `"${etag}"`;

/**
 * Reads an If-Match request header the way the apps send it: `*` stays `*`, a quoted or weak (`W/"..."`) hash
 * becomes the bare hash, an absent or empty header is undefined (which writeAtomic reads as "the file must not exist").
 */
export function parseIfMatch(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined) return undefined;
  const value = raw.trim().replace(/^W\//i, '').replace(/"/g, '').trim();
  return value === '' ? undefined : value;
}
