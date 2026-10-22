import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readJsonBody } from './json-body.ts';
import { listen, request } from './test-support.ts';

let started: Awaited<ReturnType<typeof listen>>;
before(async () => {
  started = await listen(async (req, res) => {
    const result = await readJsonBody(req, 64, { allowEmpty: req.url === '/empty-ok', objectOnly: req.url === '/object-only' });
    res.writeHead(result.ok ? 200 : result.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
  });
});
after(() => started.close());

const post = (target: string, body: string) => request(started.port, target, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

describe('json body', () => {
  it('parses a small body', async () => {
    const r = await post('/', '{"a":1}');
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { ok: true, value: { a: 1 } });
  });

  it('answers 413 from the declared length, and from the stream when nothing is declared, and keeps serving (ai-usage-tracker)', async () => {
    const declared = await post('/', JSON.stringify({ value: 'x'.repeat(200) }));
    assert.equal(declared.status, 413);
    const chunked = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: started.port, path: '/', method: 'POST', headers: { host: `127.0.0.1:${started.port}`, 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); });
      req.on('error', reject);
      req.write('{"value":"' + 'x'.repeat(40));
      req.write('x'.repeat(40) + '"}');
      req.end();
    });
    assert.equal(chunked, 413);
    assert.equal((await post('/', '{"ok":true}')).status, 200);
  });

  it('answers 400 for malformed JSON without echoing the body', async () => {
    const r = await post('/', '{synthetic-private-value');
    assert.equal(r.status, 400);
    assert.ok(!r.body.includes('synthetic-private-value'));
    assert.equal(JSON.parse(r.body).reason, 'malformed');
  });

  it('treats an empty body as 400 by default and as {} when allowed', async () => {
    assert.equal((await post('/', '')).status, 400);
    const r = await post('/empty-ok', '');
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body).value, {});
  });

  it('objectOnly rejects arrays and scalars', async () => {
    assert.equal((await post('/object-only', '[1]')).status, 400);
    assert.equal((await post('/object-only', '"s"')).status, 400);
    assert.equal((await post('/object-only', '{"a":1}')).status, 200);
    assert.equal((await post('/', '[1]')).status, 200);
  });
});
