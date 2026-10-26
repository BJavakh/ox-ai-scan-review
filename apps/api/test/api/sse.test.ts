import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { type ScanEventName, scanEventSchemas } from '@ox-scan/shared';
import { createFixtureFetch } from '../../src/integrations/fixtures/fixtureFetch.js';
import { runScan, startScan, testApp } from '../helpers/app.js';

let current: FastifyInstance | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

function parseFrames(text: string): { event: ScanEventName; data: unknown }[] {
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('event: '))
    .map((block) => {
      const [eventLine = '', dataLine = ''] = block.split('\n');
      const event = eventLine.slice('event: '.length) as ScanEventName;
      const data: unknown = JSON.parse(dataLine.slice('data: '.length));
      scanEventSchemas[event].parse(data);
      return { event, data };
    });
}

describe('GET /api/scans/:id/events', () => {
  it('sends snapshot then completed and closes for a finished scan', async () => {
    const { app, services } = await testApp();
    current = app;
    const scan = await runScan(app, services, 'https://github.com/demo/clean-app');
    const res = await app.inject({ method: 'GET', url: `/api/scans/${scan.id}/events` });
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(parseFrames(res.body).map((f) => f.event)).toEqual(['snapshot', 'completed']);
  });

  it('streams live step and progress events until completion', async () => {
    const { app } = await testApp({
      fetchFn: createFixtureFetch({ latencyMs: 30 }),
      heartbeatMs: 20,
    });
    current = app;
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const { body } = await startScan(app, 'https://github.com/demo/vulnerable-app');

    const res = await fetch(`${address}/api/scans/${body.scanId}/events`);
    const text = await res.text(); // the server closes the stream after the terminal event
    const frames = parseFrames(text);
    const events = frames.map((f) => f.event);

    expect(events[0]).toBe('snapshot');
    expect(events.at(-1)).toBe('completed');
    expect(events).toContain('step');
    expect(events).toContain('progress');
    const progress = frames
      .filter((f) => f.event === 'progress')
      .map((f) => (f.data as { progress: number }).progress);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(100);
    expect(text).toContain(': heartbeat');
  });

  it('returns 404 for unknown scans before opening a stream', async () => {
    const { app } = await testApp();
    current = app;
    const res = await app.inject({
      method: 'GET',
      url: '/api/scans/8a7c3e0e-3a0b-4c55-9a55-1a1f4b9a4b8e/events',
    });
    expect(res.statusCode).toBe(404);
  });
});
