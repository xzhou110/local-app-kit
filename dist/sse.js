export function createEventHub(opts = {}) {
    const clients = new Set();
    const heartbeatMs = opts.heartbeatMs ?? 25_000;
    const write = (text) => {
        let sent = 0;
        for (const res of clients) {
            if (res.write(text))
                sent++;
            else
                res.end(); // the tab stopped reading; let it reconnect instead of buffering forever
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
            if (req.method === 'HEAD') {
                res.end();
                return;
            }
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
            if (timer)
                clearInterval(timer);
            for (const res of clients)
                res.end();
            clients.clear();
        },
    };
}
