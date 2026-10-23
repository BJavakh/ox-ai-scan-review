import { describe, expect, it } from 'vitest';
import {
  STEP_LABELS,
  STEP_ORDER,
  apiErrorBodySchema,
  createScanRequestSchema,
  isTerminalStatus,
  scanEventSchemas,
  scanSchema,
} from '../src/index.js';

const now = '2026-10-23T10:00:00.000Z';

const scan = {
  id: '8a7c3e0e-3a0b-4c55-9a55-1a1f4b9a4b8e',
  repo: { owner: 'o', name: 'r', url: 'https://github.com/o/r' },
  ref: null,
  commitSha: null,
  status: 'queued',
  progress: 0,
  steps: STEP_ORDER.map((name) => ({
    name,
    label: STEP_LABELS[name],
    status: 'pending',
    detail: null,
    startedAt: null,
    finishedAt: null,
  })),
  error: null,
  createdAt: now,
  updatedAt: now,
  finishedAt: null,
};

describe('shared schemas', () => {
  it('accepts a well-formed scan and rejects a short step list', () => {
    expect(scanSchema.safeParse(scan).success).toBe(true);
    expect(scanSchema.safeParse({ ...scan, steps: scan.steps.slice(1) }).success).toBe(false);
  });

  it('rejects unknown keys in the create request', () => {
    expect(createScanRequestSchema.safeParse({ repoUrl: 'x' }).success).toBe(true);
    expect(createScanRequestSchema.safeParse({ repoUrl: 'x', callbackUrl: 'y' }).success).toBe(
      false,
    );
    expect(createScanRequestSchema.safeParse({ repoUrl: 'x'.repeat(301) }).success).toBe(false);
  });

  it('validates SSE payloads', () => {
    expect(scanEventSchemas.snapshot.safeParse(scan).success).toBe(true);
    expect(
      scanEventSchemas.failed.safeParse({
        scanId: scan.id,
        error: { code: 'SCAN_TIMEOUT', message: 'm', retryable: true },
      }).success,
    ).toBe(true);
    expect(scanEventSchemas.progress.safeParse({ status: 'queued', progress: 101 }).success).toBe(
      false,
    );
  });

  it('validates the error envelope', () => {
    expect(
      apiErrorBodySchema.safeParse({ error: { code: 'NOT_FOUND', message: 'Not found' } }).success,
    ).toBe(true);
    expect(apiErrorBodySchema.safeParse({ error: { code: 'TEAPOT', message: 'x' } }).success).toBe(
      false,
    );
  });

  it('knows which statuses are terminal', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('prioritizing')).toBe(false);
  });
});
