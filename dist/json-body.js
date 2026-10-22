const tooLarge = () => ({ ok: false, status: 413, reason: 'too-large', message: 'The request body is too large.' });
/** Reads the whole body up to `limit` bytes. */
export function readBody(req, limit) {
    return new Promise(resolve => {
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > limit) {
            req.resume();
            resolve(tooLarge());
            return;
        }
        const chunks = [];
        let total = 0;
        let done = false;
        req.on('data', (chunk) => {
            if (done)
                return; // keep draining so the client gets the 413
            total += chunk.length;
            if (total > limit) {
                done = true;
                chunks.length = 0;
                resolve(tooLarge());
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => { if (!done) {
            done = true;
            resolve({ ok: true, value: Buffer.concat(chunks) });
        } });
        req.on('aborted', () => { if (!done) {
            done = true;
            resolve({ ok: false, status: 400, reason: 'interrupted', message: 'The request was interrupted.' });
        } });
        req.on('error', () => { if (!done) {
            done = true;
            resolve({ ok: false, status: 400, reason: 'unreadable', message: 'The request body could not be read.' });
        } });
    });
}
/** Reads and parses a JSON body up to `limit` bytes (default 64 KB). */
export async function readJsonBody(req, limit = 64 * 1024, opts = {}) {
    const raw = await readBody(req, limit);
    if (!raw.ok)
        return raw;
    const text = raw.value.toString('utf8');
    if (!text.trim()) {
        if (opts.allowEmpty)
            return { ok: true, value: {} };
        return { ok: false, status: 400, reason: 'malformed', message: 'The JSON request body is invalid.' };
    }
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        return { ok: false, status: 400, reason: 'malformed', message: 'The JSON request body is invalid.' };
    }
    if (opts.objectOnly && (value === null || typeof value !== 'object' || Array.isArray(value))) {
        return { ok: false, status: 400, reason: 'malformed', message: 'The request body must be a JSON object.' };
    }
    return { ok: true, value };
}
