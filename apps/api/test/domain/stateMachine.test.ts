import { describe, expect, it } from 'vitest';
import type { ScanStatus } from '@ox-scan/shared';
import {
  InvalidTransitionError,
  TRANSITIONS,
  assertTransition,
  canTransition,
  computeProgress,
  createInitialSteps,
} from '../../src/domain/stateMachine.js';

const happyPath: ScanStatus[] = [
  'queued',
  'fetching_repo',
  'resolving_dependencies',
  'checking_vulnerabilities',
  'prioritizing',
  'generating_summary',
  'completed',
];

describe('scan state machine', () => {
  it('allows the happy path in order', () => {
    for (let i = 0; i < happyPath.length - 1; i++) {
      const from = happyPath[i] as ScanStatus;
      const to = happyPath[i + 1] as ScanStatus;
      expect(() => {
        assertTransition(from, to);
      }).not.toThrow();
    }
  });

  it('allows failing from every non-terminal state', () => {
    for (const status of happyPath.slice(0, -1)) expect(canTransition(status, 'failed')).toBe(true);
  });

  it('allows the cache-hit shortcut only from fetching_repo', () => {
    expect(canTransition('fetching_repo', 'completed')).toBe(true);
    expect(canTransition('resolving_dependencies', 'completed')).toBe(false);
    expect(canTransition('queued', 'completed')).toBe(false);
  });

  it.each<[ScanStatus, ScanStatus]>([
    ['queued', 'prioritizing'],
    ['checking_vulnerabilities', 'fetching_repo'],
    ['completed', 'failed'],
    ['failed', 'queued'],
    ['completed', 'queued'],
    ['generating_summary', 'generating_summary'],
  ])('rejects %s -> %s', (from, to) => {
    expect(() => {
      assertTransition(from, to);
    }).toThrow(InvalidTransitionError);
  });

  it('has terminal states with no exits', () => {
    expect(TRANSITIONS.completed).toEqual([]);
    expect(TRANSITIONS.failed).toEqual([]);
  });
});

describe('progress', () => {
  it('counts completed and skipped steps out of six', () => {
    const steps = createInitialSteps();
    expect(computeProgress('queued', steps)).toBe(0);
    const [first, second, third] = steps;
    if (!first || !second || !third) throw new Error('missing steps');
    first.status = 'completed';
    expect(computeProgress('resolving_dependencies', steps)).toBe(17);
    second.status = 'completed';
    third.status = 'skipped';
    expect(computeProgress('prioritizing', steps)).toBe(50);
  });

  it('is always 100 when completed', () => {
    expect(computeProgress('completed', createInitialSteps())).toBe(100);
  });
});
