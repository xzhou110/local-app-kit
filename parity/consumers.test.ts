// The parity suite: two small apps assembled from the kit the way the consumers assemble theirs, exercised over a
// real socket on an ephemeral port with synthetic files in temp folders. Each test is named after the consumer test
// it is lifted from, so a behaviour an app relies on has one row here before that app migrates.
//   career-like: a file API with ETags and If-Match, one SSE hub fed by the API and the watcher, profile-style paths.
//   tracker-like: one state file with a revision ETag, Origin checked on every request, JSON-only mutations,
//                 a fixed route set, no-store everywhere, the single-instance lock.
import { after, afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import {
  acquireServerLock, buildCsp, canonicalFile, checkMutation, createEventHub, createOwnWrites, createStaticHandler, deleteFile,
  listenLoopback, originAllowed, parseIfMatch, parseRequestTarget, quoteEtag, readJsonBody, readWithEtag, watchDirs, writeAtomic,
  type Handler,
} from '../src/index.ts';
import { sha256 } from '../src/etag.ts';
import { rawRequest, readEvents, removeTemp, request, sleep, tempDir } from '../src/test-support.ts';

const win32 = process.platform === 'win32';
type Json = Record<string, unknown>;
const text = (res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(body); };
const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body)); };

/** Starts a loopback server whose handler is built once the port is known (the Host check needs the port). */
async function start(build: (port: number) => Promise<{ handler: Handler; close: () => Promise<void> | void }>) {
  let inner: Handler = (_req, res) => { res.writeHead(503); res.end(); };
  const listening = await listenLoopback({ port: 0, handler: (req, res) => inner(req, res), log: () => {} });
  if (!listening.ok) throw new Error(listening.message);
  const app = await build(listening.port);
  inner = app.handler;
  return { port: listening.port, url: listening.url, close: async () => { await app.close(); await listening.close({ force: true }); } };
}

// ---- the career-like app ----
function careerLike(root: string, port: number) {
  const ownWrites = createOwnWrites();
  const hub = createEventHub({ heartbeatMs: 0 });
  const dataDir = path.join(root, 'data');
  const stopWatch = watchDirs(root, ['data'], paths => hub.broadcast('changed', { paths }), { ownWrites, debounceMs: 50 });
  const api: Handler = async (req, res) => {
    const gate = checkMutation(req, { port, header: 'x-synthetic-app' });
    if (!gate.ok) return text(res, gate.status, gate.message);
    const target = parseRequestTarget(req.url, port);
    if (!target.ok) return text(res, 400, 'bad request');
    const { pathname } = target.url;
    const method = req.method ?? 'GET';
    if (pathname === '/api/events' && method === 'GET') return hub.open(req, res);
    if (pathname === '/api/file') {
      const file = canonicalFile(dataDir, target.url.searchParams.get('path') ?? '');
      if (!file) return text(res, 400, 'bad path');
      if (method === 'GET') {
        const current = readWithEtag(file.abs);
        if (!current) return text(res, 404, 'not found');
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', etag: quoteEtag(current.etag), 'cache-control': 'no-store' });
        return res.end(current.raw);
      }
      if (method === 'PUT') {
        const body = await readJsonBody(req, 64 * 1024, { objectOnly: true });
        if (!body.ok) return text(res, body.status, body.message);
        const result = await writeAtomic(file.abs, JSON.stringify(body.value, null, 2) + '\n', { ifMatch: parseIfMatch(req.headers['if-match']), ownWrites });
        if (!result.ok) return json(res, result.status, { error: result.reason, ...(result.reason === 'conflict' ? { etag: result.etag } : {}) });
        hub.broadcast('changed', { paths: ['data/' + file.rel] });
        return json(res, 200, { etag: result.etag }, { etag: quoteEtag(result.etag) });
      }
      if (method === 'DELETE') {
        const deleted = await deleteFile(file.abs, { ownWrites });
        if (deleted) hub.broadcast('changed', { paths: ['data/' + file.rel] });
        return json(res, deleted ? 200 : 404, { deleted });
      }
    }
    return text(res, 404, 'not found');
  };
  return { handler: createStaticHandler({ dist: path.join(root, 'dist'), port, api }), close: () => { stopWatch(); hub.close(); } };
}

describe('career-like app', () => {
  let root: string;
  let app: Awaited<ReturnType<typeof start>>;
  const seed: Json = { schemaVersion: 1, desiredChange: 'Synthetic plan', steps: [] };
  const endpoint = (rel = 'direction/plan.json') => `/api/file?path=${encodeURIComponent(rel)}`;
  const planFile = () => path.join(root, 'data', 'direction', 'plan.json');
  const call = (target: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    request(app.port, target, { method, headers: { 'x-synthetic-app': '1', 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const etagOf = (r: { headers: { etag?: string | string[] | undefined } }) => parseIfMatch(r.headers.etag) ?? '';

  before(async () => {
    root = tempDir();
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<!doctype html><title>Synthetic Career</title>');
    fs.mkdirSync(path.dirname(planFile()), { recursive: true });
    fs.writeFileSync(planFile(), JSON.stringify(seed));
    app = await start(async port => careerLike(root, port));
    await sleep(150); // the watcher arms
  });
  after(async () => { await app.close(); removeTemp(root); });
  afterEach(() => mock.restoreAll());

  it('412 on a changed file: a stale If-Match is refused, the right one writes, no If-Match only creates (career-center fs-retry, file-safety)', async () => {
    const current = await call(endpoint());
    assert.equal(current.status, 200);
    assert.equal(etagOf(current), sha256(JSON.stringify(seed)));
    const stale = await call(endpoint(), 'PUT', { ...seed, desiredChange: 'stale' }, { 'if-match': '"stale"' });
    assert.equal(stale.status, 412);
    assert.equal(JSON.parse(stale.body).etag, etagOf(current));
    assert.equal(fs.readFileSync(planFile(), 'utf8'), JSON.stringify(seed));
    const saved = await call(endpoint(), 'PUT', { ...seed, desiredChange: 'saved' }, { 'if-match': current.headers.etag as string });
    assert.equal(saved.status, 200);
    assert.equal(etagOf(saved), JSON.parse(saved.body).etag);
    assert.equal((await call(endpoint(), 'PUT', seed)).status, 412); // no If-Match on an existing file: never overwrites
    const created = await call(endpoint('direction/new.json'), 'PUT', seed);
    assert.equal(created.status, 200);
    assert.deepEqual(JSON.parse((await call(endpoint('direction/new.json'))).body), seed);
    assert.equal((await call(endpoint('direction/new.json'), 'DELETE')).status, 200);
    assert.equal((await call(endpoint('direction/new.json'))).status, 404);
  });

  it('one SSE stream: a write through the API is announced once and never echoed by the watcher; an outside edit is announced once', async () => {
    await sleep(300); // the previous test's delete is also announced by the watcher (a deletion has no ETag to match); let it flush while nobody listens
    const reader = readEvents(app.port, '/api/events', 2);
    await sleep(100);
    const current = await call(endpoint());
    assert.equal((await call(endpoint(), 'PUT', { ...seed, desiredChange: 'through the api' }, { 'if-match': current.headers.etag as string })).status, 200);
    await sleep(600); // long enough for a watcher echo to arrive if it were going to
    fs.writeFileSync(planFile(), JSON.stringify({ ...seed, desiredChange: 'outside edit' }));
    const { events, stop } = await reader;
    stop();
    assert.deepEqual(events, [
      { event: 'changed', data: '{"paths":["data/direction/plan.json"]}' },
      { event: 'changed', data: '{"paths":["data/direction/plan.json"]}' },
    ]);
  });

  it('keeps first-save working when the data directory is a filesystem alias (career-center file-safety)', async () => {
    const original = path.join(root, 'data');
    const target = path.join(root, 'synthetic-data');
    fs.renameSync(original, target);
    fs.symlinkSync(target, original, win32 ? 'junction' : 'dir');
    try {
      fs.unlinkSync(planFile());
      assert.equal((await call(endpoint(), 'PUT', seed)).status, 200);
      assert.deepEqual(JSON.parse((await call(endpoint())).body), seed);
    } finally {
      fs.rmSync(original, { recursive: true, force: true });
      fs.renameSync(target, original);
    }
  });

  it('serializes first saves through aliases even while the first rename must retry (career-center file-safety)', async () => {
    fs.unlinkSync(planFile());
    const rename = fs.renameSync.bind(fs);
    let releaseRetry!: () => void;
    const retryStarted = new Promise<void>(resolve => { releaseRetry = resolve; });
    let failOnce = true;
    mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
      if (failOnce && String(to).toLowerCase() === planFile().toLowerCase()) {
        failOnce = false; releaseRetry();
        throw Object.assign(new Error('fixture busy'), { code: 'EPERM' });
      }
      return rename(from, to);
    });
    const first = call(endpoint(), 'PUT', seed);
    await retryStarted;
    const alias = win32 ? 'DIRECTION/PLAN.JSON' : 'direction/./plan.json';
    const second = call(endpoint(alias), 'PUT', { ...seed, desiredChange: 'Losing draft' });
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 412);
    assert.deepEqual(JSON.parse((await call(endpoint())).body), seed);
  });

  it('rejects Win32 trailing-dot, trailing-space and stream aliases without touching files (career-center file-safety)', { skip: !win32 }, async () => {
    const before = fs.readFileSync(planFile(), 'utf8');
    for (const alias of ['direction/plan.json.', 'direction/plan.json ', 'direction/plan.json::$DATA', 'direction./plan.json']) {
      assert.equal((await call(endpoint(alias), 'PUT', {}, { 'if-match': '*' })).status, 400, alias);
    }
    assert.equal(fs.readFileSync(planFile(), 'utf8'), before);
  });

  it('refuses a foreign host, a mutation without the header or with a foreign Origin, and crashing targets, over the socket', async () => {
    assert.equal((await request(app.port, '/', { headers: { host: 'evil.example:8150' } })).status, 403);
    assert.equal((await request(app.port, endpoint(), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await call(endpoint(), 'PUT', {}, { origin: 'https://attacker.example' })).status, 403);
    for (const target of ['//', '/%zz', '/api/file?path=%zz']) assert.ok((await rawRequest(app.port, `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${app.port}\r\n\r\n`)).startsWith('HTTP/1.1 400'), target);
    assert.equal((await call(endpoint('../secret.json'), 'PUT', seed)).status, 400);
    const home = await request(app.port, '/');
    assert.equal(home.status, 200);
    assert.ok(home.body.includes('Synthetic Career'));
  });

  it('answers 413 while draining an oversized body and 400 for a non-object body, and keeps serving', async () => {
    const current = await call(endpoint());
    assert.equal((await call(endpoint(), 'PUT', { ...seed, big: 'x'.repeat(70 * 1024) }, { 'if-match': current.headers.etag as string })).status, 413);
    assert.equal((await call(endpoint(), 'PUT', [1, 2], { 'if-match': current.headers.etag as string })).status, 400);
    assert.equal((await call(endpoint())).status, 200);
  });
});

// ---- the tracker-like app ----
async function trackerLike(root: string, port: number) {
  const lock = await acquireServerLock(path.join(root, 'local'), { port, appName: 'Synthetic Tracker' });
  if (!lock.ok) throw new Error(lock.message);
  const stateFile = path.join(root, 'local', 'state.json');
  await writeAtomic(stateFile, JSON.stringify({ version: 1, settings: { warningPercent: 80 } }), { ifMatch: '*' });
  const hub = createEventHub({ heartbeatMs: 0 });
  const fail = (res: ServerResponse, status: number, code: string, message: string) => json(res, status, { error: { code, message } });
  const api: Handler = async (req, res) => {
    if (!originAllowed(req, port)) return fail(res, 403, 'FORBIDDEN', 'The request origin is not allowed.');
    const gate = checkMutation(req, { port, header: 'x-synthetic-tracker', requireJson: true });
    if (!gate.ok) return fail(res, gate.status, gate.status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'FORBIDDEN', gate.message);
    const target = parseRequestTarget(req.url, port);
    if (!target.ok) return fail(res, 400, 'BAD_REQUEST', target.message);
    const { pathname } = target.url;
    const method = req.method ?? 'GET';
    if (pathname === '/api/health' && method === 'GET') return json(res, 200, { ok: true, app: 'synthetic-tracker' });
    if (pathname === '/api/status' && method === 'GET') {
      const current = readWithEtag(stateFile);
      if (!current) return fail(res, 500, 'STORAGE_ERROR', 'Local data could not be read.');
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', etag: quoteEtag(current.etag) });
      return res.end(current.raw);
    }
    if (pathname === '/api/events' && method === 'GET') return hub.open(req, res);
    if (pathname === '/api/settings' && method === 'PUT') {
      const expected = parseIfMatch(req.headers['if-match']);
      if (!expected) return fail(res, 428, 'PRECONDITION_REQUIRED', 'Reload the current data before applying changes.');
      const body = await readJsonBody(req, 1024 * 1024, { objectOnly: true });
      if (!body.ok) return fail(res, body.status, body.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', body.message);
      const current = readWithEtag(stateFile);
      if (!current) return fail(res, 500, 'STORAGE_ERROR', 'Local data could not be read.');
      const state = JSON.parse(current.raw) as Json;
      state.settings = body.value;
      const result = await writeAtomic(stateFile, JSON.stringify(state), { ifMatch: expected });
      if (!result.ok) return fail(res, result.status, result.reason === 'conflict' ? 'PRECONDITION_FAILED' : 'STORAGE_ERROR', 'Data changed since you opened it. Reload before applying your changes.');
      hub.broadcast('change', { revision: result.etag });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', etag: quoteEtag(result.etag) });
      return res.end(JSON.stringify(state));
    }
    return fail(res, 404, 'NOT_FOUND', 'This API route does not exist.');
  };
  const handler = createStaticHandler({
    dist: path.join(root, 'test-dist'), port, api, fallback: ['/', '/dashboard', '/history'], assetCache: 'no-store',
    csp: buildCsp({ 'script-src': "'self'", 'form-action': "'self'" }), headers: { 'x-frame-options': 'DENY' },
  });
  return { handler, close: async () => { hub.close(); await lock.release(); } };
}

describe('tracker-like app', () => {
  let root: string;
  let app: Awaited<ReturnType<typeof start>>;
  const headers = { 'content-type': 'application/json', 'x-synthetic-tracker': '1' };
  const mutate = (target: string, body: unknown, method = 'POST', ifMatch?: string) =>
    request(app.port, target, { method, headers: { ...headers, ...(ifMatch ? { 'if-match': ifMatch } : {}) }, body: JSON.stringify(body) });
  const raw = (target: string, extra = '', host?: string) => rawRequest(app.port, `GET ${target} HTTP/1.1\r\nHost: ${host ?? `127.0.0.1:${app.port}`}\r\n${extra}Connection: close\r\n\r\n`);

  before(async () => {
    root = tempDir();
    fs.mkdirSync(path.join(root, 'test-dist'));
    fs.writeFileSync(path.join(root, 'test-dist', 'index.html'), '<!doctype html><title>Synthetic Tracker</title>');
    fs.writeFileSync(path.join(root, 'test-dist', 'UPPER.JS'), 'globalThis.synthetic = true;');
    app = await start(port => trackerLike(root, port));
  });
  after(async () => { await app.close(); removeTemp(root); });

  it('starts and serves the production surface (ai-usage-tracker backend.test)', async () => {
    const page = await request(app.port, '/');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('Synthetic Tracker'));
    assert.ok(page.headers['content-security-policy']?.includes("script-src 'self'"));
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.equal(page.headers['x-frame-options'], 'DENY');
    const head = await request(app.port, '/UPPER.JS', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.ok(head.headers['content-type']?.includes('javascript'));
    assert.equal(head.body, '');
    assert.equal((await request(app.port, '/api/missing')).status, 404);
    assert.equal((await request(app.port, '/missing.js')).status, 404);
    assert.equal((await request(app.port, '/missing')).status, 404);
    assert.equal((await request(app.port, '/dashboard')).status, 200);
  });

  it('rejects foreign origins, exact-port Host mismatches, and missing mutation headers (ai-usage-tracker backend.test)', async () => {
    assert.ok((await raw('/api/health', '', '127.0.0.1:1')).includes('403'));
    assert.equal((await request(app.port, '/api/health', { headers: { origin: 'https://example.invalid' } })).status, 403);
    assert.equal((await request(app.port, '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await request(app.port, '/api/settings', { method: 'PUT', headers: { 'x-synthetic-tracker': '1', 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await request(app.port, '/api/health', { headers: { origin: app.url } })).status, 200);
  });

  it('rejects malformed raw targets and keeps serving after parser errors (ai-usage-tracker backend.test)', async () => {
    for (const target of ['//', '/%zz', '/%2e%2e/private', '/..%5cprivate', '/C:/private', '/%252e%252e/private', '/NUL.txt', '/api/history?cursor=%zz']) {
      assert.ok((await raw(target)).includes('400 Bad Request'), target);
    }
    assert.ok((await raw('/api/health', 'Bad Header: value\r\n')).includes('400 Bad Request'));
    assert.equal((await request(app.port, '/api/health')).status, 200);
  });

  it('returns safe malformed-JSON and body-size errors without killing the listener (ai-usage-tracker backend.test)', async () => {
    const status = await request(app.port, '/api/status');
    const malformed = await request(app.port, '/api/settings', { method: 'PUT', headers: { ...headers, 'if-match': status.headers.etag as string }, body: '{synthetic-private-value' });
    assert.equal(malformed.status, 400);
    assert.ok(!malformed.body.includes('synthetic-private-value'));
    const large = await mutate('/api/settings', { value: 'x'.repeat(1024 * 1024) }, 'PUT', status.headers.etag as string);
    assert.equal(large.status, 413);
    assert.equal((await request(app.port, '/api/health')).status, 200);
  });

  it('validates settings and protects simultaneous writes with the exact state ETag; one SSE revision per write (ai-usage-tracker backend.test)', async () => {
    const reader = readEvents(app.port, '/api/events', 1);
    await sleep(100);
    const before = await request(app.port, '/api/status');
    const settings = { warningPercent: 75 };
    assert.equal((await mutate('/api/settings', settings, 'PUT')).status, 428);
    const saved = await mutate('/api/settings', settings, 'PUT', before.headers.etag as string);
    assert.equal(saved.status, 200);
    assert.notEqual(saved.headers.etag, before.headers.etag);
    assert.equal((await mutate('/api/settings', { warningPercent: 20 }, 'PUT', before.headers.etag as string)).status, 412);
    assert.equal((await request(app.port, '/api/status')).status, 200);
    const { events, stop } = await reader;
    stop();
    assert.deepEqual(events, [{ event: 'change', data: JSON.stringify({ revision: parseIfMatch(saved.headers.etag) }) }]);
    assert.deepEqual(JSON.parse((await request(app.port, '/api/status')).body).settings, settings);
  });

  it('prevents a second instance on the same data folder (ai-usage-tracker backend.test)', async () => {
    const second = await acquireServerLock(path.join(root, 'local'), { port: 0, appName: 'Synthetic Tracker' });
    assert.equal(second.ok, false);
    if (!second.ok) { assert.equal(second.reason, 'held'); assert.ok(second.message.includes(String(process.pid))); }
  });
});
