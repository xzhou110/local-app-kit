// Request-target validation before anything else looks at a request. Each shape here once killed or fooled a local
// server: `//x` parses as an authority, `/%zz` throws out of decodeURIComponent, `..%5c` and `%2e%2e` become
// traversal after decoding, `C:` and `::$DATA` reach the Windows file system, `NUL.txt` is a device, a trailing dot
// or space is dropped by Win32. The raw path is checked BEFORE WHATWG URL normalisation, which would erase traversal.
// Lifted from ai-usage-tracker/server/http.ts (parseTarget) with creator-advisors' ':' rule and career-center's
// file-safety cases, 2026-10-22.

export type TargetResult =
  | { ok: true; url: URL; pathname: string }
  | { ok: false; status: 400; message: string };

const WIN32_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const bad = (): TargetResult => ({ ok: false, status: 400, message: 'The request target is invalid.' });

/** True when the text holds a control character (code at most `max`, or DEL). */
function hasControl(text: string, max: number): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= max || code === 0x7f) return true;
  }
  return false;
}

/** Validates `req.url`; on success `url` is the parsed target and `pathname` its decoded path. */
export function parseRequestTarget(raw: string | undefined, port = 80): TargetResult {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('#') || hasControl(raw, 0x20)) return bad();
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw.split('?')[0] ?? '');
  } catch { return bad(); }
  if (decoded.includes('\\') || decoded.includes(':') || decoded.includes('%') || decoded.startsWith('//') || hasControl(decoded, 0x1f)) return bad();
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some(segment => segment.startsWith('.') || /[. ]$/.test(segment) || WIN32_RESERVED.test(segment))) return bad();
  let url: URL;
  try {
    url = new URL(raw, `http://127.0.0.1:${port}`);
    // The query must decode too, instead of silently substituting malformed escapes.
    decodeURIComponent(url.search.replaceAll('+', ' '));
  } catch { return bad(); }
  return { ok: true, url, pathname: decoded };
}
