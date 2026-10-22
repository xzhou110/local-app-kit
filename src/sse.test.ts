import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEventHub } from './sse.ts';
import { listen, readEvents, readUntil, request, waitFor } from './test-support.ts';

describe('sse hub', () => {
  it('keeps one stream per client, broadcasts named events, answers HEAD at once and forgets closed clients', async () => {
    const hub = createEventHub({ heartbeatMs: 0 });
    const started = await listen((req, res) => { if (req.url === '/api/events') return hub.open(req, res); res.writeHead(404); res.end(); });
    try {
      const reader = readEvents(started.port, '/api/events', 1);
      await waitFor(() => hub.size === 1, 'the stream to open');
      assert.equal(hub.broadcast('changed', { paths: ['data/a.json'] }), 1);
      const { events, stop } = await reader;
      assert.deepEqual(events, [{ event: 'changed', data: '{"paths":["data/a.json"]}' }]);
      stop();
      await waitFor(() => hub.size === 0, 'the stream to close');
      const head = await request(started.port, '/api/events', { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.headers['content-type'], 'text/event-stream');
      assert.equal(head.headers['cache-control'], 'no-store');
      assert.equal(head.body, '');
      assert.equal(hub.size, 0);
      assert.equal(hub.broadcast('changed', {}), 0);
    } finally {
      hub.close();
      await started.close();
    }
  });

  it('opens with a connected comment and sends a heartbeat comment at the configured interval', async () => {
    const hub = createEventHub({ heartbeatMs: 20 });
    const started = await listen((req, res) => hub.open(req, res));
    try {
      const text = await readUntil(started.port, '/api/events', t => t.includes(': ping'));
      assert.ok(text.startsWith(': connected\n\n'), text);
      assert.ok(text.includes(': ping\n\n'));
    } finally {
      hub.close();
      await started.close();
    }
  });
});
