import type { Severity, SeveritySource } from '@ox-scan/shared';
import { cvss3BaseScore } from './cvss.js';
import type { Advisory } from './types.js';

export interface SeverityResult {
  severity: Severity;
  source: SeveritySource;
  cvssScore: number | null;
}

const GHSA_SEVERITIES: Readonly<Record<string, Severity>> = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MODERATE: 'MODERATE',
  MEDIUM: 'MODERATE',
  LOW: 'LOW',
};

export function severityFromCvss(score: number): Severity {
  if (score >= 9) return 'CRITICAL';
  if (score >= 7) return 'HIGH';
  if (score >= 4) return 'MODERATE';
  if (score > 0) return 'LOW';
  return 'UNKNOWN';
}

function bestCvssV3(advisory: Advisory): number | null {
  const scores = advisory.severityVectors
    .filter((entry) => entry.type === 'CVSS_V3')
    .map((entry) => cvss3BaseScore(entry.score))
    .filter((score): score is number => score !== null);
  return scores.length > 0 ? Math.max(...scores) : null;
}

/**
 * Source order: malicious-package feed, then GHSA database severity, then a
 * CVSS v3 vector we score ourselves, then UNKNOWN. See docs/ARCHITECTURE.md 5.1.
 */
export function deriveSeverity(advisory: Advisory): SeverityResult {
  const cvssScore = bestCvssV3(advisory);

  if (advisory.id.startsWith('MAL-')) {
    return { severity: 'CRITICAL', source: 'malicious', cvssScore };
  }

  const ghsa = advisory.databaseSeverity?.trim().toUpperCase();
  const fromGhsa = ghsa === undefined ? undefined : GHSA_SEVERITIES[ghsa];
  if (fromGhsa !== undefined) return { severity: fromGhsa, source: 'ghsa', cvssScore };

  if (cvssScore !== null && cvssScore > 0) {
    return { severity: severityFromCvss(cvssScore), source: 'cvss_v3', cvssScore };
  }

  return { severity: 'UNKNOWN', source: 'unknown', cvssScore };
}
