import { describe, expect, it } from 'vitest';
import { highestSeverity, scoreAction, scoreFinding } from '../../src/domain/scoring.js';

describe('scoreFinding (worked examples from docs/ARCHITECTURE.md 5.2)', () => {
  it.each([
    ['CRITICAL', false, true, true, 10],
    ['HIGH', false, false, true, 5.25],
    ['CRITICAL', true, true, true, 3],
    ['MODERATE', false, false, false, 2.4],
    ['LOW', true, false, true, 0.34],
    ['UNKNOWN', false, true, true, 3],
  ] as const)(
    '%s dev=%s direct=%s fix=%s -> %d',
    (severity, dev, direct, fixAvailable, expected) => {
      expect(scoreFinding({ severity, dev, direct, fixAvailable })).toBe(expected);
    },
  );

  it('ranks a production high above a dev critical', () => {
    const prodHighTransitive = scoreFinding({
      severity: 'HIGH',
      dev: false,
      direct: false,
      fixAvailable: true,
    });
    const devCriticalDirect = scoreFinding({
      severity: 'CRITICAL',
      dev: true,
      direct: true,
      fixAvailable: true,
    });
    expect(prodHighTransitive).toBeGreaterThan(devCriticalDirect);
  });
});

describe('scoreAction', () => {
  it('is the max plus a quarter of the rest', () => {
    expect(scoreAction([7, 4, 4])).toBe(9);
    expect(scoreAction([10])).toBe(10);
    expect(scoreAction([])).toBe(0);
  });

  it('lets one critical outrank many moderates', () => {
    expect(scoreAction([10])).toBeGreaterThan(scoreAction([4, 4, 4, 4]));
  });
});

describe('highestSeverity', () => {
  it('orders CRITICAL > HIGH > MODERATE > UNKNOWN > LOW', () => {
    expect(highestSeverity(['LOW', 'UNKNOWN'])).toBe('UNKNOWN');
    expect(highestSeverity(['MODERATE', 'CRITICAL', 'HIGH'])).toBe('CRITICAL');
    expect(highestSeverity(['LOW'])).toBe('LOW');
  });
});
