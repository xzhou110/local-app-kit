// One Server-Sent Events hub per server: every browser tab holds one stream, the server broadcasts a change event
// with the paths or revision that changed, a comment line every so often keeps proxies and sockets awake, and a
// client whose socket is full is closed so it reconnects fresh (EventSource reconnects by itself).
// Lifted from career-center/server/api.ts and ai-usage-tracker/server/http.ts, 2026-10-22.
import type { IncomingMessage, ServerResponse } from 'node:http';

export type EventHub = {
  /** Answers a GET of the events route: writes the stream headers and keeps the response open. HEAD ends at once. */
  open(req: IncomingMessage, res: ServerResponse, opts?: { headers?: Record<string, string> }): void;
  /** Sends one named event with a JSON payload to every open stream; returns how many streams received it. */
  broadcast(event: string, data: unknown): number;
  /** Sends a comment line (`: text`), which browsers ignore; used for the heartbeat. */
  comment(text: string): number;
  /** How many streams are open. */
  readonly size: number;
  /** Ends every stream and stops the heartbeat. */
  close(): void;
};

export type EventHubOptions = {
  /** Interval of the heartbeat comment (default 25 s); 0 turns it off. */
  heartbeatMs?: number | undefined;
};

export function createEventHub(opts: EventHubOptions = {}): EventHub {
  const clients = new Set<ServerResponse>();
  const heartbeatMs = opts.heartbeatMs ?? 25_000;
  const write = (text: string): number => {
    let sent = 0;
    for (const res of clients) {
      if (res.write(text)) sent++;
      else res.end(); // the tab stopped reading; let it reconnect instead of buffering forever
    }
    return sent;
  };
  const timer = heartbeatMs > 0 ? setInterval(() => write(': ping\n\n'), heartbeatMs) : null;
  timer?.unref();
  return {
    open(req, res, o = {}) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        ...(o.headers ?? {}),
      });
      if (req.method === 'HEAD') { res.end(); return; }
      res.write(': connected\n\n');
      clients.add(res);
      res.on('close', () => clients.delete(res));
    },
    broadcast(event, data) {
      return write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    comment(text) {
      return write(`: ${text}\n\n`);
    },
    get size() { return clients.size; },
    close() {
      if (timer) clearInterval(timer);
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}
