import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { DEFAULT_CSP, buildCsp, checkMutation, hostAllowed, mutationAllowed, originAllowed, securityHeaders } from './security.ts';

const req = (headers: Record<string, string>, method = 'GET') => ({ headers, method } as unknown as IncomingMessage);

describe('security', () => {
  it('allows only the loopback hosts on the bound port (career-center server.test)', () => {
    assert.equal(hostAllowed(req({ host: '127.0.0.1:8150' }), 8150), true);
    assert.equal(hostAllowed(req({ host: 'localhost:8150' }), 8150), true);
    assert.equal(hostAllowed(req({ host: 'LOCALHOST:8150' }), 8150), true);
    assert.equal(hostAllowed(req({ host: '[::1]:8150' }), 8150), true);
    assert.equal(hostAllowed(req({ host: 'evil.example:8150' }), 8150), false);
    assert.equal(hostAllowed(req({ host: '127.0.0.1:9999' }), 8150), false);
    assert.equal(hostAllowed(req({ host: '127.0.0.1:1' }), 8175), false);
    assert.equal(hostAllowed(req({}), 8150), false);
  });

  it('mutations need the custom header and a same-origin Origin (career-center server.test)', () => {
    const opts = { port: 8150, header: 'x-career-center' };
    assert.equal(mutationAllowed(req({}, 'POST'), opts), false);
    assert.equal(mutationAllowed(req({ 'x-career-center': '1', origin: 'http://127.0.0.1:8150' }, 'PUT'), opts), true);
    assert.equal(mutationAllowed(req({ 'x-career-center': '1', origin: 'https://attacker.example' }, 'PUT'), opts), false);
    assert.equal(mutationAllowed(req({}, 'GET'), opts), true);
    assert.equal(mutationAllowed(req({ 'x-career-center': '1' }, 'DELETE'), opts), true); // no Origin: the header still guards
    assert.deepEqual(checkMutation(req({ origin: 'http://127.0.0.1:8150' }, 'POST'), opts), { ok: false, status: 403, reason: 'header', message: 'mutations need the x-career-center: 1 header' });
    assert.deepEqual(checkMutation(req({ 'x-career-center': '1', origin: 'http://127.0.0.1:5195' }, 'POST'), opts), { ok: false, status: 403, reason: 'origin', message: 'mutations need a same-origin Origin' });
    assert.equal(mutationAllowed(req({ 'x-career-center': '1', origin: 'http://127.0.0.1:5195' }, 'POST'), { ...opts, extraOrigins: ['http://127.0.0.1:5195'] }), true);
  });

  it('requires a JSON body on mutations when asked (ai-usage-tracker guard)', () => {
    const opts = { port: 8175, header: 'x-ai-usage-tracker', requireJson: true };
    assert.deepEqual(checkMutation(req({ 'x-ai-usage-tracker': '1', 'content-type': 'text/plain' }, 'POST'), opts), { ok: false, status: 415, reason: 'content-type', message: 'send a JSON request body' });
    assert.equal(checkMutation(req({ 'x-ai-usage-tracker': '1', 'content-type': 'application/json; charset=utf-8' }, 'POST'), opts).ok, true);
    assert.equal(checkMutation(req({ 'x-ai-usage-tracker': '1', 'content-type': 'application/json' }, 'PUT'), opts).ok, true);
    assert.equal(checkMutation(req({}, 'GET'), opts).ok, true);
    assert.equal(checkMutation(req({ 'content-type': 'application/json' }, 'POST'), { port: 8175, requireJson: true }).ok, true); // no header required
  });

  it('originAllowed: absent passes, the server\'s own passes, a foreign one fails on any method', () => {
    assert.equal(originAllowed(req({}), 8175), true);
    assert.equal(originAllowed(req({ origin: 'http://127.0.0.1:8175' }), 8175), true);
    assert.equal(originAllowed(req({ origin: 'http://localhost:8175' }), 8175), true);
    assert.equal(originAllowed(req({ origin: 'https://example.invalid' }), 8175), false);
    assert.equal(originAllowed(req({ origin: 'http://127.0.0.1:5186' }), 8175), false);
    assert.equal(originAllowed(req({ origin: 'http://127.0.0.1:5186' }), 8175, ['http://127.0.0.1:5186']), true);
  });

  it('buildCsp replaces, adds and removes directives; the default round-trips', () => {
    const csp = buildCsp({ 'frame-src': 'https://www.youtube-nocookie.com', 'img-src': "'self' data: https://i.ytimg.com", 'font-src': null, 'script-src': "'self'" });
    assert.ok(csp.startsWith("default-src 'self'; connect-src 'self'; img-src 'self' data: https://i.ytimg.com"));
    assert.ok(csp.includes('frame-src https://www.youtube-nocookie.com'));
    assert.ok(!csp.includes('font-src'));
    assert.ok(csp.endsWith("script-src 'self'"));
    assert.equal(buildCsp(), DEFAULT_CSP);
    assert.deepEqual(Object.keys(securityHeaders()), ['content-security-policy', 'x-content-type-options', 'referrer-policy']);
    assert.equal(securityHeaders('x')['content-security-policy'], 'x');
  });
});
