// Localhost-only defences, all cheap: a Host allow-list (a DNS-rebinding page cannot name 127.0.0.1 in Host), an
// Origin check (a foreign page cannot call the API from a browser), a custom header on mutations (a cross-site form
// cannot set one, so no cookies-free CSRF), an optional JSON content-type requirement, and a strict Content-Security-
// Policy for the served app. Lifted from career-center and creator-advisors server/security.ts, ai-usage-tracker
// server/http.ts (guard) and x-command-center http-policy.mjs (ownRequest), 2026-10-22.
import type { IncomingMessage } from 'node:http';

/** The Host header values a loopback server answers to, on its bound port only. */
export const loopbackHosts = (port: number): string[] => [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
/** The Origin header values a page served by that server carries. */
export const loopbackOrigins = (port: number): string[] => [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];

const header = (req: IncomingMessage, name: string): string => {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? '';
};

/** True when the Host header names this server on its port (DNS-rebinding defence). */
export function hostAllowed(req: IncomingMessage, port: number): boolean {
  return loopbackHosts(port).includes(header(req, 'host').toLowerCase());
}

/** True when there is no Origin header, or it is this server's own (plus any extra origin the app allows, e.g. a dev server). */
export function originAllowed(req: IncomingMessage, port: number, extraOrigins: string[] = []): boolean {
  const origin = header(req, 'origin').toLowerCase();
  if (!origin) return true;
  return loopbackOrigins(port).includes(origin) || extraOrigins.some(o => o.toLowerCase() === origin);
}

export const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** `application/json`, with or without the utf-8 charset. */
export const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i;

export type MutationOptions = {
  port: number;
  /** The custom header mutations must carry with the value `1` (e.g. `x-career-center`); omit to skip that check. */
  header?: string | undefined;
  /** Require `content-type: application/json` on mutations (415 otherwise). */
  requireJson?: boolean | undefined;
  /** Origins allowed besides the server's own (a development server, an extension the app pairs with). */
  extraOrigins?: string[] | undefined;
};

export type MutationCheck =
  | { ok: true }
  | { ok: false; status: 403 | 415; reason: 'header' | 'origin' | 'content-type'; message: string };

/** Checks a request that may mutate: non-mutating methods pass; a mutation needs the header, a same-origin Origin when present, and JSON when required. */
export function checkMutation(req: IncomingMessage, opts: MutationOptions): MutationCheck {
  if (!MUTATING.has(req.method ?? 'GET')) return { ok: true };
  if (opts.header && header(req, opts.header.toLowerCase()) !== '1') {
    return { ok: false, status: 403, reason: 'header', message: `mutations need the ${opts.header}: 1 header` };
  }
  if (!originAllowed(req, opts.port, opts.extraOrigins ?? [])) {
    return { ok: false, status: 403, reason: 'origin', message: 'mutations need a same-origin Origin' };
  }
  if (opts.requireJson && !JSON_CONTENT_TYPE.test(header(req, 'content-type'))) {
    return { ok: false, status: 415, reason: 'content-type', message: 'send a JSON request body' };
  }
  return { ok: true };
}

/** The boolean form of checkMutation. */
export const mutationAllowed = (req: IncomingMessage, opts: MutationOptions): boolean => checkMutation(req, opts).ok;

/** The strict default policy of the served app: nothing loads from anywhere but this origin; no inline scripts. */
export const DEFAULT_CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'";

/** A policy from the default with directives replaced, added (`'frame-src': 'https://www.youtube-nocookie.com'`) or removed (null). */
export function buildCsp(overrides: Record<string, string | null> = {}, base: string = DEFAULT_CSP): string {
  const directives = new Map<string, string>();
  for (const part of base.split(';')) {
    const [name, ...rest] = part.trim().split(/\s+/);
    if (name) directives.set(name, rest.join(' '));
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) directives.delete(name);
    else directives.set(name, value);
  }
  return [...directives].map(([name, value]) => (value ? `${name} ${value}` : name)).join('; ');
}

/** The response headers every served page and asset carries. */
export function securityHeaders(csp: string = DEFAULT_CSP): Record<string, string> {
  return { 'content-security-policy': csp, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
}
