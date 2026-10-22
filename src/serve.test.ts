import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installCrashGuards, listenLoopback, parsePort } from './serve.ts';
import { rawRequest, request } from './test-support.ts';

describe('serve', () => {
  it('listens on the loopback, answers a malformed request with 400, keeps serving, and reports a taken port', async () => {
    const handler = (_req: unknown, res: import('node:http').ServerResponse) => { res.writeHead(200); res.end('ok'); };
    const first = await listenLoopback({ port: 0, handler, log: () => {} });
    assert.ok(first.ok);
    if (!first.ok) return;
    try {
      assert.ok(first.url.startsWith('http://127.0.0.1:'));
      assert.equal((await request(first.port, '/')).body, 'ok');
      const malformed = await rawRequest(first.port, `GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:${first.port}\r\nBad Header: value\r\n\r\n`);
      assert.ok(malformed.includes('400 Bad Request'), malformed);
      assert.equal((await request(first.port, '/')).status, 200);
      const second = await listenLoopback({ port: first.port, handler, log: () => {} });
      assert.equal(second.ok, false);
      if (!second.ok) { assert.equal(second.reason, 'port-in-use'); assert.equal(second.code, 'EADDRINUSE'); assert.ok(second.message.includes(String(first.port))); }
    } finally {
      await first.close({ force: true });
      await first.close(); // idempotent
    }
  });

  it('parses ports from arguments and installs removable crash guards', () => {
    assert.equal(parsePort(undefined, 8150), 8150);
    assert.equal(parsePort('', 8150), 8150);
    assert.equal(parsePort('8160', 8150), 8160);
    assert.equal(parsePort('0', 8150), 0);
    assert.equal(parsePort('70000', 8150), null);
    assert.equal(parsePort('abc', 8150), null);
    assert.equal(parsePort('8.5', 8150), null);
    const exceptions = process.listenerCount('uncaughtException');
    const rejections = process.listenerCount('unhandledRejection');
    const remove = installCrashGuards(() => {});
    assert.equal(process.listenerCount('uncaughtException'), exceptions + 1);
    assert.equal(process.listenerCount('unhandledRejection'), rejections + 1);
    remove();
    assert.equal(process.listenerCount('uncaughtException'), exceptions);
    assert.equal(process.listenerCount('unhandledRejection'), rejections);
  });
});
