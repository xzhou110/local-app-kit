// The request listener of a daily server: static files from the built app plus `/api/*` handed to the app's API
// handler, everything inside a guard. A request-target the URL parser rejects (`//`, `/%zz`) answers 400 instead of
// throwing out of the listener and exiting the process (career-center's production server died ten minutes after
// launch from a single `GET //` before this guard existed). The Host check runs first (DNS rebinding), the realpath
// of every file must stay under dist/ (a symlink cannot lead out), `index.html` is never cached, assets are.
// Lifted from career-center/server/static.ts with creator-advisors' HEAD and 405 handling and ai-usage-tracker's
// realpath containment and route set, 2026-10-22.
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_CSP, hostAllowed, securityHeaders } from './security.ts';
import { parseRequestTarget } from './request-target.ts';

export type Handler = (req: IncomingMessage, res: ServerResponse) => unknown;

export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

export type StaticOptions = {
  /** The built app (Vite's `dist/`). */
  dist: string;
  /** The bound port, for the Host check. */
  port: number;
  /** The app's API handler; receives every request whose path starts with `apiPrefix`. Without one, those answer 404. */
  api?: Handler | undefined;
  /** Default `/api/`. */
  apiPrefix?: string | undefined;
  /**
   * Which paths serve `index.html`: `hash-router` (the default) serves it for every extension-less path, a list of
   * routes serves it for those only (anything else must be a real file), `false` serves it for `/` alone.
   */
  fallback?: 'hash-router' | string[] | false | undefined;
  /** The Content-Security-Policy of every static response (default the kit's strict policy). */
  csp?: string | undefined;
  /** Cache policy of assets other than `index.html`: a max-age in seconds (default 3600) or `no-store`. */
  assetCache?: number | 'no-store' | undefined;
  /** Extra headers on every static response (`x-frame-options`, `permissions-policy`). */
  headers?: Record<string, string> | undefined;
  /** Extra or replacement MIME types by extension. */
  types?: Record<string, string> | undefined;
  /** The 503 text when dist/ is missing (say which command builds it). */
  missingDistMessage?: string | undefined;
  /** Where unexpected errors go (default console.error). */
  onError?: ((error: Error) => void) | undefined;
};

export function createStaticHandler(opts: StaticOptions): Handler {
  const dist = path.resolve(opts.dist);
  const { port } = opts;
  const apiPrefix = opts.apiPrefix ?? '/api/';
  const apiRoot = apiPrefix.replace(/\/$/, '');
  const fallback = opts.fallback ?? 'hash-router';
  const routes = Array.isArray(fallback) ? new Set(fallback) : null;
  const types = { ...MIME_TYPES, ...(opts.types ?? {}) };
  const baseHeaders = securityHeaders(opts.csp ?? DEFAULT_CSP);
  const assetCache = opts.assetCache === 'no-store' ? 'no-store' : `public, max-age=${opts.assetCache ?? 3600}`;
  const onError = opts.onError ?? ((error: Error) => console.error('[static] request failed:', error.message));
  const missing = opts.missingDistMessage ?? `${path.basename(dist)}/ is missing: build the app first`;
  const bad = (res: ServerResponse, status: number, message = '') => {
    if (!res.headersSent) res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(message);
  };
  return (req, res) => {
    try {
      if (!hostAllowed(req, port)) return bad(res, 403, 'forbidden host');
      const target = parseRequestTarget(req.url, port);
      if (!target.ok) return bad(res, 400, 'bad request');
      const { pathname } = target.url;
      if (pathname.startsWith(apiPrefix) || pathname === apiRoot) {
        if (!opts.api) return bad(res, 404, 'not found');
        return opts.api(req, res);
      }
      const method = req.method ?? 'GET';
      if (method !== 'GET' && method !== 'HEAD') { res.setHeader('allow', 'GET, HEAD'); return bad(res, 405, 'method not allowed'); }
      if (!fs.existsSync(dist)) return bad(res, 503, missing);
      let rel = target.pathname;
      const isRoute = routes ? routes.has(rel) : fallback === 'hash-router' && !path.extname(rel);
      if (rel === '/' || isRoute) rel = '/index.html';
      const isIndex = rel.toLowerCase() === '/index.html'; // Windows is case-insensitive: /Index.html must not escape no-store
      const abs = path.resolve(dist, '.' + rel);
      if (!abs.startsWith(dist + path.sep)) return bad(res, 400, 'bad request');
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return bad(res, 404, 'not found');
      const real = fs.realpathSync.native(abs);
      if (!real.startsWith(fs.realpathSync.native(dist) + path.sep)) return bad(res, 404, 'not found');
      res.writeHead(200, {
        'content-type': types[path.extname(abs).toLowerCase()] ?? 'application/octet-stream',
        ...baseHeaders,
        'cache-control': isIndex ? 'no-store' : assetCache,
        ...(opts.headers ?? {}),
      });
      if (method === 'HEAD') return res.end();
      fs.createReadStream(real).on('error', () => { try { res.destroy(); } catch { /* already gone */ } }).pipe(res);
    } catch (error) {
      onError(error as Error);
      try { bad(res, 500, 'server error'); } catch { /* socket gone */ }
    }
  };
}
