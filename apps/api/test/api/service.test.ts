import { describe, expect, it } from 'vitest';
import type { AppError } from '../../src/http/errors.js';
import { InMemoryScanRepository } from '../../src/scans/InMemoryScanRepository.js';
import { InProcessJobQueue, type JobQueue } from '../../src/scans/JobQueue.js';
import type { ScanOrchestrator } from '../../src/scans/ScanOrchestrator.js';
import { ScanQuota } from '../../src/scans/ScanQuota.js';
import { ScanService } from '../../src/scans/ScanService.js';

const noopOrchestrator = { run: () => Promise.resolve() } as unknown as ScanOrchestrator;

describe('ScanService', () => {
  it('refuses new scans with 503 when the queue is full', async () => {
    const full: JobQueue = {
      enqueue: () => undefined,
      hasCapacity: () => false,
      onIdle: () => Promise.resolve(),
    };
    const service = new ScanService(new InMemoryScanRepository(), full, noopOrchestrator);
    await expect(service.submit('https://github.com/a/b')).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_BUSY',
    } satisfies Partial<AppError>);
  });
});

describe('InProcessJobQueue', () => {
  it('never runs more than the concurrency limit at once', async () => {
    const queue = new InProcessJobQueue(2, 10);
    let running = 0;
    let peak = 0;
    for (let i = 0; i < 6; i++) {
      queue.enqueue(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running -= 1;
      });
    }
    await queue.onIdle();
    expect(peak).toBe(2);
  });

  it('keeps going after a job throws', async () => {
    const queue = new InProcessJobQueue(1, 10);
    let ran = false;
    queue.enqueue(() => Promise.reject(new Error('boom')));
    queue.enqueue(() => {
      ran = true;
      return Promise.resolve();
    });
    await queue.onIdle();
    expect(ran).toBe(true);
  });
});

describe('InMemoryScanRepository', () => {
  it('evicts the oldest finished scans beyond capacity but never running ones', async () => {
    const repo = new InMemoryScanRepository(2);
    const make = (id: string, status: 'queued' | 'completed') => ({
      scan: { id, status } as never,
      report: null,
      dedupeKey: id,
    });
    await repo.createIfNoActive(make('running', 'queued'));
    await repo.createIfNoActive(make('done-1', 'completed'));
    await repo.createIfNoActive(make('done-2', 'completed'));
    expect(await repo.get('running')).toBeDefined();
    expect(await repo.get('done-1')).toBeUndefined();
    expect(await repo.get('done-2')).toBeDefined();
  });
});

describe('ScanService admission', () => {
  it('answers a duplicate submit even when the queue is full', async () => {
    let capacity = true;
    const queue: JobQueue = {
      enqueue: () => undefined,
      hasCapacity: () => capacity,
      onIdle: () => Promise.resolve(),
    };
    const service = new ScanService(new InMemoryScanRepository(), queue, noopOrchestrator);
    const first = await service.submit('https://github.com/a/b');
    capacity = false;
    const again = await service.submit('https://github.com/a/b');
    expect(again).toMatchObject({ deduplicated: true, scan: { id: first.scan.id } });
    await expect(service.submit('https://github.com/a/other')).rejects.toMatchObject({
      code: 'SERVICE_BUSY',
    });
  });
});

describe('ScanService per-client quota', () => {
  it('limits new scans per client per hour, but never duplicates or other clients', async () => {
    let now = Date.parse('2026-10-25T10:00:00Z');
    const queue: JobQueue = {
      enqueue: () => undefined,
      hasCapacity: () => true,
      onIdle: () => Promise.resolve(),
    };
    const service = new ScanService(
      new InMemoryScanRepository(),
      queue,
      noopOrchestrator,
      () => new Date(now),
      new ScanQuota(2, () => now),
    );
    await service.submit('https://github.com/a/one', 'client-1');
    await service.submit('https://github.com/a/two', 'client-1');
    await expect(service.submit('https://github.com/a/three', 'client-1')).rejects.toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
    });
    // a duplicate of a running scan is free
    await expect(service.submit('https://github.com/a/one', 'client-1')).resolves.toMatchObject({
      deduplicated: true,
    });
    // other clients are unaffected
    await expect(service.submit('https://github.com/a/three', 'client-2')).resolves.toMatchObject({
      deduplicated: false,
    });
    // the window slides
    now += 61 * 60 * 1000;
    await expect(service.submit('https://github.com/a/four', 'client-1')).resolves.toMatchObject({
      deduplicated: false,
    });
  });
});
