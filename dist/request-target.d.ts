export type TargetResult = {
    ok: true;
    url: URL;
    pathname: string;
} | {
    ok: false;
    status: 400;
    message: string;
};
/** Validates `req.url`; on success `url` is the parsed target and `pathname` its decoded path. */
export declare function parseRequestTarget(raw: string | undefined, port?: number): TargetResult;
