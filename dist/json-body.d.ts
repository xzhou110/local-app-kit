import type { IncomingMessage } from 'node:http';
export type BodyResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    status: 413 | 400;
    reason: 'too-large' | 'malformed' | 'interrupted' | 'unreadable';
    message: string;
};
/** Reads the whole body up to `limit` bytes. */
export declare function readBody(req: IncomingMessage, limit: number): Promise<BodyResult<Buffer>>;
export type JsonBodyOptions = {
    /** An empty body reads as `{}` instead of 400. */
    allowEmpty?: boolean | undefined;
    /** Only a JSON object passes; arrays, strings and numbers answer 400. */
    objectOnly?: boolean | undefined;
};
/** Reads and parses a JSON body up to `limit` bytes (default 64 KB). */
export declare function readJsonBody(req: IncomingMessage, limit?: number, opts?: JsonBodyOptions): Promise<BodyResult<unknown>>;
