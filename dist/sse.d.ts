import type { IncomingMessage, ServerResponse } from 'node:http';
export type EventHub = {
    /** Answers a GET of the events route: writes the stream headers and keeps the response open. HEAD ends at once. */
    open(req: IncomingMessage, res: ServerResponse, opts?: {
        headers?: Record<string, string>;
    }): void;
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
export declare function createEventHub(opts?: EventHubOptions): EventHub;
