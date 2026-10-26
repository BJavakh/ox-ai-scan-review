import type { FastifyReply, FastifyRequest } from 'fastify';
import { type ScanEvent, type ScanEventName, isTerminalStatus } from '@ox-scan/shared';
import type { Services } from '../container.js';
import { clientKey } from './clientKey.js';
import { AppError, notFound } from './errors.js';

export const HEARTBEAT_MS = 15_000;
export const MAX_STREAMS_PER_IP = 10;
export const MAX_STREAMS_TOTAL = 100;

/** Counts open SSE connections per IP and globally, and can end them all on shutdown. */
export class StreamLimiter {
  private total = 0;
  private readonly perIp = new Map<string, number>();
  private readonly open = new Set<() => void>();

  constructor(
    private readonly maxPerIp = MAX_STREAMS_PER_IP,
    private readonly maxTotal = MAX_STREAMS_TOTAL,
  ) {}

  acquire(ip: string): boolean {
    const current = this.perIp.get(ip) ?? 0;
    if (this.total >= this.maxTotal || current >= this.maxPerIp) return false;
    this.total += 1;
    this.perIp.set(ip, current + 1);
    return true;
  }

  /** Registers an open stream's close function; returns the matching unregister. */
  track(close: () => void): () => void {
    this.open.add(close);
    return () => this.open.delete(close);
  }

  /** Ends every open stream. Clients fall back to polling and see the final state. */
  closeAll(): number {
    const closers = [...this.open];
    for (const close of closers) close();
    return closers.length;
  }

  release(ip: string): void {
    const current = this.perIp.get(ip) ?? 0;
    if (current <= 1) this.perIp.delete(ip);
    else this.perIp.set(ip, current - 1);
    this.total = Math.max(0, this.total - 1);
  }
}

function frame(event: ScanEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * GET /api/scans/:id/events. Sends a snapshot first, then live events, a
 * heartbeat comment every 15 s, and closes after the terminal event.
 */
export async function streamScanEvents(
  services: Services,
  limiter: StreamLimiter,
  request: FastifyRequest,
  reply: FastifyReply,
  scanId: string,
  heartbeatMs = HEARTBEAT_MS,
): Promise<void> {
  if (!(await services.repository.get(scanId))) throw notFound();
  if (!limiter.acquire(clientKey(request.ip))) {
    throw new AppError(
      429,
      'TOO_MANY_STREAMS',
      'Too many open progress streams. Close other tabs and retry.',
    );
  }

  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    ...(reply.getHeaders() as Record<string, string>),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  // An object, not a `let`: `close` runs from event callbacks while this function awaits.
  const stream = { closed: false };
  let snapshotSent = false;
  const buffered: ScanEvent[] = [];

  const close = () => {
    if (stream.closed) return;
    stream.closed = true;
    clearInterval(heartbeat);
    untrack();
    unsubscribe();
    limiter.release(clientKey(request.ip));
    raw.end();
  };
  const send = (event: ScanEvent) => {
    if (stream.closed) return;
    raw.write(frame(event.event, event.data));
    if (event.event === 'completed' || event.event === 'failed') close();
  };

  // Subscribe before reading the snapshot so no event is lost in between.
  const unsubscribe = services.events.subscribe(scanId, (event) => {
    if (snapshotSent) send(event);
    else buffered.push(event);
  });
  const heartbeat = setInterval(() => {
    if (!stream.closed) raw.write(': heartbeat\n\n');
  }, heartbeatMs);
  const untrack = limiter.track(close);
  request.raw.on('close', close);
  // The client may already be gone (disconnect before the listener existed).
  if (request.raw.destroyed) {
    close();
    return;
  }

  const latest = await services.repository.get(scanId);
  if (stream.closed) return;
  if (!latest) {
    close();
    return;
  }
  raw.write(frame('snapshot', latest.scan));
  snapshotSent = true;

  if (isTerminalStatus(latest.scan.status)) {
    send(
      latest.scan.status === 'completed'
        ? { event: 'completed', data: { scanId } }
        : {
            event: 'failed',
            data: {
              scanId,
              error: latest.scan.error ?? {
                code: 'INTERNAL_ERROR',
                message: 'Scan failed.',
                retryable: true,
              },
            },
          },
    );
    return;
  }
  for (const event of buffered.splice(0)) send(event);
}
