import { SEVERITY_ORDER, type Severity } from '@ox-scan/shared';

/** Prioritization constants. See docs/ARCHITECTURE.md section 5.2 for rationale and examples. */
export const SEVERITY_WEIGHTS: Readonly<Record<Severity, number>> = {
  CRITICAL: 10,
  HIGH: 7,
  MODERATE: 4,
  UNKNOWN: 3,
  LOW: 1.5,
};
export const SCOPE_FACTOR = { production: 1, development: 0.3 } as const;
export const RELATIONSHIP_FACTOR = { direct: 1, transitive: 0.75 } as const;
export const FIX_FACTOR = { available: 1, none: 0.8 } as const;

export interface ScoreInput {
  severity: Severity;
  dev: boolean;
  direct: boolean;
  fixAvailable: boolean;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function scoreFinding(input: ScoreInput): number {
  return round2(
    SEVERITY_WEIGHTS[input.severity] *
      (input.dev ? SCOPE_FACTOR.development : SCOPE_FACTOR.production) *
      (input.direct ? RELATIONSHIP_FACTOR.direct : RELATIONSHIP_FACTOR.transitive) *
      (input.fixAvailable ? FIX_FACTOR.available : FIX_FACTOR.none),
  );
}

/**
 * An action is as urgent as its most dangerous finding. Volume never outranks
 * severity: the number of issues fixed only breaks ties (see compareActions).
 */
export function scoreAction(findingScores: readonly number[]): number {
  return findingScores.length === 0 ? 0 : Math.max(...findingScores);
}

export function severityRank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

export function highestSeverity(severities: readonly Severity[]): Severity {
  return severities.reduce<Severity>(
    (best, s) => (severityRank(s) < severityRank(best) ? s : best),
    'LOW',
  );
}
