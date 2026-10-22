/** sha256 hex of a string or buffer. */
export declare const sha256: (data: Buffer | string) => string;
/** The quoted form an ETag response header carries. */
export declare const quoteEtag: (etag: string) => string;
/**
 * Reads an If-Match request header the way the apps send it: `*` stays `*`, a quoted or weak (`W/"..."`) hash
 * becomes the bare hash, an absent or empty header is undefined (which writeAtomic reads as "the file must not exist").
 */
export declare function parseIfMatch(header: string | string[] | undefined): string | undefined;
