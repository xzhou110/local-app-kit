import type { IncomingMessage } from 'node:http';
/** The Host header values a loopback server answers to, on its bound port only. */
export declare const loopbackHosts: (port: number) => string[];
/** The Origin header values a page served by that server carries. */
export declare const loopbackOrigins: (port: number) => string[];
/** True when the Host header names this server on its port (DNS-rebinding defence). */
export declare function hostAllowed(req: IncomingMessage, port: number): boolean;
/** True when there is no Origin header, or it is this server's own (plus any extra origin the app allows, e.g. a dev server). */
export declare function originAllowed(req: IncomingMessage, port: number, extraOrigins?: string[]): boolean;
export declare const MUTATING: Set<string>;
/** `application/json`, with or without the utf-8 charset. */
export declare const JSON_CONTENT_TYPE: RegExp;
export type MutationOptions = {
    port: number;
    /** The custom header mutations must carry with the value `1` (e.g. `x-career-center`); omit to skip that check. */
    header?: string | undefined;
    /** Require `content-type: application/json` on mutations (415 otherwise). */
    requireJson?: boolean | undefined;
    /** Origins allowed besides the server's own (a development server, an extension the app pairs with). */
    extraOrigins?: string[] | undefined;
};
export type MutationCheck = {
    ok: true;
} | {
    ok: false;
    status: 403 | 415;
    reason: 'header' | 'origin' | 'content-type';
    message: string;
};
/** Checks a request that may mutate: non-mutating methods pass; a mutation needs the header, a same-origin Origin when present, and JSON when required. */
export declare function checkMutation(req: IncomingMessage, opts: MutationOptions): MutationCheck;
/** The boolean form of checkMutation. */
export declare const mutationAllowed: (req: IncomingMessage, opts: MutationOptions) => boolean;
/** The strict default policy of the served app: nothing loads from anywhere but this origin; no inline scripts. */
export declare const DEFAULT_CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'";
/** A policy from the default with directives replaced, added (`'frame-src': 'https://www.youtube-nocookie.com'`) or removed (null). */
export declare function buildCsp(overrides?: Record<string, string | null>, base?: string): string;
/** The response headers every served page and asset carries. */
export declare function securityHeaders(csp?: string): Record<string, string>;
