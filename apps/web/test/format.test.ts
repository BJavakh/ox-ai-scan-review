import { describe, expect, it } from 'vitest';
import type { Scan } from '@ox-scan/shared';
import { parseRoute } from '../src/hooks/useHashRoute';
import {
  applyStep,
  formatDuration,
  normalizeRepoInput,
  relativeTime,
  scanRepoUrl,
} from '../src/lib/format';

describe('normalizeRepoInput', () => {
  it.each([
    ['github.com/o/r', 'https://github.com/o/r'],
    ['www.github.com/o/r', 'https://www.github.com/o/r'],
    ['o/r', 'https://github.com/o/r'],
    ['  https://github.com/o/r  ', 'https://github.com/o/r'],
    ['http://github.com/o/r', 'http://github.com/o/r'],
    ['gitlab.com/o/r', 'gitlab.com/o/r'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeRepoInput(input)).toBe(expected);
  });
});

describe('formatting', () => {
  it('formats durations', () => {
    expect(formatDuration(4_200)).toBe('4s');
    expect(formatDuration(65_000)).toBe('1m 05s');
    expect(formatDuration(-5)).toBe('0s');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-10-23T12:00:00Z');
    expect(relativeTime('2026-10-23T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-10-23T11:45:00Z', now)).toBe('15 min ago');
    expect(relativeTime('2026-10-23T09:00:00Z', now)).toBe('3 h ago');
  });

  it('rebuilds the URL for a retry, including the ref', () => {
    const repo = { owner: 'o', name: 'r', url: 'https://github.com/o/r' };
    expect(scanRepoUrl({ repo, ref: null })).toBe('https://github.com/o/r');
    expect(scanRepoUrl({ repo, ref: 'feature/x' })).toBe('https://github.com/o/r/tree/feature/x');
  });
});

describe('parseRoute', () => {
  it('recognises scan routes and defaults to the start screen', () => {
    expect(parseRoute('#/scans/8a7c3e0e-3a0b-4c55-9a55-1a1f4b9a4b8e')).toEqual({
      name: 'scan',
      id: '8a7c3e0e-3a0b-4c55-9a55-1a1f4b9a4b8e',
    });
    expect(parseRoute('#/scans/not-an-id')).toEqual({ name: 'start' });
    expect(parseRoute('')).toEqual({ name: 'start' });
  });
});

describe('applyStep', () => {
  it('replaces only the matching step', () => {
    const step = (name: 'fetching_repo' | 'completed', status: 'pending' | 'running') => ({
      name,
      label: name,
      status,
      detail: null,
      startedAt: null,
      finishedAt: null,
    });
    const scan = {
      steps: [step('fetching_repo', 'pending'), step('completed', 'pending')],
    } as unknown as Scan;
    const next = applyStep(scan, step('fetching_repo', 'running'));
    expect(next.steps.map((s) => s.status)).toEqual(['running', 'pending']);
    expect(scan.steps[0]?.status).toBe('pending');
  });
});
