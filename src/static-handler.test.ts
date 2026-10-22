import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createStaticHandler } from './static-handler.ts';
import { listen, rawRequest, removeTemp, request, tempDir } from './test-support.ts';

let started: Awaited<ReturnType<typeof listen>>;
let dist: string;
let apiCalls = 0;
const api = (_req: unknown, res: import('node:http').ServerResponse) => { apiCalls++; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); };
const raw = (target: string) => rawRequest(started.port, `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${started.port}\r\nConnection: close\r\n\r\n`);
const useHandler = (extra: Partial<Parameters<typeof createStaticHandler>[0]> = {}) => started.setHandler(createStaticHandler({ dist, port: started.port, api, ...extra }));

before(async () => {
  dist = tempDir();
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Synthetic App</title>');
  fs.writeFileSync(path.join(dist, 'assets', 'a.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dist, 'UPPER.JS'), 'globalThis.synthetic = true;');
  started = await listen(() => {});
  useHandler();
});
afterEach(() => useHandler());
after(async () => { await started.close(); removeTemp(dist); });

describe('static handler', () => {
  it('serves the app, assets and the hash-router fallback with the security headers (career-center static.test)', async () => {
    const home = await request(started.port, '/');
    assert.equal(home.status, 200);
    assert.equal(home.headers['cache-control'], 'no-store');
    assert.ok(home.headers['content-security-policy']?.includes("default-src 'self'"));
    assert.equal(home.headers['x-content-type-options'], 'nosniff');
    assert.equal(home.headers['referrer-policy'], 'no-referrer');
    assert.ok(home.body.includes('Synthetic App'));
    const deep = await request(started.port, '/resume/var_x');
    assert.equal(deep.status, 200);
    assert.ok(deep.body.includes('Synthetic App'));
    const js = await request(started.port, '/assets/a.js');
    assert.equal(js.status, 200);
    assert.equal(js.headers['content-type'], 'text/javascript');
    assert.ok(js.headers['cache-control']?.includes('max-age'));
    assert.equal((await request(started.port, '/assets/missing.js')).status, 404);
    assert.equal((await request(started.port, '/Index.html')).headers['cache-control'], 'no-store'); // case alias of the app page
    const before = apiCalls;
    assert.equal((await request(started.port, '/api/status')).status, 200);
    assert.equal((await request(started.port, '/api')).status, 200);
    assert.equal(apiCalls, before + 2);
  });

  it('answers 400 to request-targets that used to throw out of the listener, and stays alive (career-center, ai-usage-tracker)', async () => {
    for (const target of ['//', '///', '/%zz', '/%', '/%C0%80', '//evil.example/api/status', '/%2e%2e/private', '/..%5cprivate', '/C:/private', '/%252e%252e/private', '/NUL.txt']) {
      assert.ok((await raw(target)).startsWith('HTTP/1.1 400'), target);
    }
    assert.equal((await request(started.port, '/')).status, 200);
  });

  it('refuses foreign hosts, dot segments and a link out of dist', async () => {
    assert.equal((await request(started.port, '/', { headers: { host: 'evil.example:8150' } })).status, 403);
    assert.equal((await request(started.port, '/', { headers: { host: `127.0.0.1:${started.port + 1}` } })).status, 403);
    assert.equal((await request(started.port, '/../package.json')).status, 400);
    assert.equal((await request(started.port, '/%2e%2e/package.json')).status, 400);
    const outside = tempDir();
    try {
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'private');
      fs.symlinkSync(outside, path.join(dist, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
      assert.equal((await request(started.port, '/outside/secret.txt')).status, 404);
    } finally {
      fs.rmSync(path.join(dist, 'outside'), { recursive: true, force: true });
      removeTemp(outside);
    }
  });

  it('HEAD mirrors GET without a body; other methods answer 405 with Allow (creator-advisors, ai-usage-tracker)', async () => {
    const head = await request(started.port, '/UPPER.JS', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.ok(head.headers['content-type']?.includes('javascript'));
    assert.equal(head.body, '');
    const post = await request(started.port, '/', { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers['allow'], 'GET, HEAD');
  });

  it('answers 503 with the app\'s own message when dist is missing', async () => {
    useHandler({ dist: path.join(dist, 'nope'), missingDistMessage: 'app/dist missing: run npm run app:build first' });
    const r = await request(started.port, '/');
    assert.equal(r.status, 503);
    assert.equal(r.body, 'app/dist missing: run npm run app:build first');
  });

  it('a route set serves index.html for listed routes only, with no-store assets and extra headers (ai-usage-tracker)', async () => {
    useHandler({ fallback: ['/', '/dashboard', '/history'], assetCache: 'no-store', headers: { 'x-frame-options': 'DENY' }, csp: "default-src 'self'; script-src 'self'" });
    const dashboard = await request(started.port, '/dashboard');
    assert.equal(dashboard.status, 200);
    assert.ok(dashboard.body.includes('Synthetic App'));
    assert.equal(dashboard.headers['x-frame-options'], 'DENY');
    assert.ok(dashboard.headers['content-security-policy']?.includes("script-src 'self'"));
    assert.equal((await request(started.port, '/missing')).status, 404);
    assert.equal((await request(started.port, '/missing.js')).status, 404);
    assert.equal((await request(started.port, '/UPPER.JS')).headers['cache-control'], 'no-store');
  });

  it('without an api handler the api prefix answers 404; a custom prefix is honoured', async () => {
    useHandler({ api: undefined });
    assert.equal((await request(started.port, '/api/status')).status, 404);
    useHandler({ apiPrefix: '/data/' });
    const before = apiCalls;
    assert.equal((await request(started.port, '/data/x')).status, 200);
    assert.equal(apiCalls, before + 1);
    assert.equal((await request(started.port, '/api/status')).status, 200); // now a hash-router page, not the api
    assert.equal(apiCalls, before + 1);
  });
});
