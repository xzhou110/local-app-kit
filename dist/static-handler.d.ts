import type { IncomingMessage, ServerResponse } from 'node:http';
export type Handler = (req: IncomingMessage, res: ServerResponse) => unknown;
export declare const MIME_TYPES: Record<string, string>;
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
export declare function createStaticHandler(opts: StaticOptions): Handler;
