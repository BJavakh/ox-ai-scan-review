import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { apiErrorBodySchema } from '@ox-scan/shared';
import { loadEnv } from '../../src/config/env.js';
import { buildApp } from '../../src/http/app.js';
import { createFixtureFetch } from '../../src/integrations/fixtures/fixtureFetch.js';
import { InProcessJobQueue } from '../../src/scans/JobQueue.js';
import { getScan, startScan, testApp } from '../helpers/app.js';
import { fakeFetch } from '../helpers/fetch.js';

let current: FastifyInstance | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

/** A fetch that never answers until the request is aborted. */
const hanging = fakeFetch(
  (_url, init) =>
    new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
    }),
);

async function waitFor(check: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('graceful shutdown', () => {
  it('fails running and queued scans with a retryable code and ends open streams', async () => {
    const { app, services } = await testApp({
      fetchFn: hanging,
      env: { SCAN_CONCURRENCY: '1' },
    });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const running = (await startScan(app, 'https://github.com/demo/vulnerable-app')).body.scanId;
    const queued = (await startScan(app, 'https://github.com/demo/clean-app')).body.scanId;
    await waitFor(async () => (await getScan(app, running)).status === 'fetching_repo');

    const stream = fetch(`${address}/api/scans/${running}/events`).then((res) => res.text());
    await waitFor(async () => Promise.resolve(services.events.listenerCount(running) > 0));

    await app.close();

    for (const id of [running, queued]) {
      const stored = await services.repository.get(id);
      expect(stored?.scan.status).toBe('failed');
      expect(stored?.scan.error).toMatchObject({ code: 'SERVER_SHUTTING_DOWN', retryable: true });
    }
    // The stream received the terminal event before it was closed.
    const text = await stream;
    expect(text).toContain('event: failed');
    expect(text).toContain('SERVER_SHUTTING_DOWN');
  });

  it('answers requests that arrive during shutdown with the standard 503 envelope', async () => {
    // A fetch that ignores aborts, so the drain phase lasts long enough to send a request.
    const slow = fakeFetch(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve(new Response('{}', { status: 500 }));
          }, 200),
        ),
    );
    const { app } = await testApp({ fetchFn: slow });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    await startScan(app, 'https://github.com/demo/vulnerable-app');

    const closing = app.close();
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the preClose hook start
    // The listener stays open while scans drain; inject() is refused once close() starts.
    const res = await fetch(`${address}/api/scans`);
    const body: unknown = await res.json();
    await closing;

    expect(res.status).toBe(503);
    expect(apiErrorBodySchema.parse(body).error.code).toBe('SERVICE_BUSY');
  });
});

describe('global error handler', () => {
  async function appWithFaultyRoutes() {
    const env = loadEnv({ NODE_ENV: 'test', SCANNER_MODE: 'live' });
    const { app } = await buildApp(env, { fetchFn: createFixtureFetch(), summaryGenerator: null });
    app.get('/test/client-fault', () => {
      throw Object.assign(new Error('framework detail'), { statusCode: 405 });
    });
    app.get('/test/server-fault', () => {
      throw new Error('secret internal detail at /srv/app.ts:42');
    });
    await app.ready();
    current = app;
    return app;
  }

  it('keeps unmapped 4xx statuses with a generic client error code', async () => {
    const app = await appWithFaultyRoutes();
    const res = await app.inject({ method: 'GET', url: '/test/client-fault' });
    expect(res.statusCode).toBe(405);
    expect(apiErrorBodySchema.parse(res.json()).error).toEqual({
      code: 'BAD_REQUEST',
      message: 'The request could not be processed.',
    });
  });

  it('turns unexpected errors into a 500 that leaks nothing', async () => {
    const app = await appWithFaultyRoutes();
    const res = await app.inject({ method: 'GET', url: '/test/server-fault' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret');
    expect(apiErrorBodySchema.parse(res.json()).error.code).toBe('INTERNAL_ERROR');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('job queue', () => {
  it('reports a job that escapes its own error handling instead of swallowing it', async () => {
    const onJobError = vi.fn();
    const queue = new InProcessJobQueue(1, 5, onJobError);
    const boom = new Error('bug');
    queue.enqueue(() => Promise.reject(boom));
    queue.enqueue(() => Promise.resolve());
    await queue.onIdle();
    expect(onJobError).toHaveBeenCalledExactlyOnceWith(boom);
  });
});
