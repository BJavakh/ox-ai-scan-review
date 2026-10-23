import type { Finding, ReportStats, RiskLevel, SeverityCounts } from '@ox-scan/shared';
import type { Action } from '@ox-scan/shared';

export const MAX_TOP_RISKS = 5;

/** First matching rule wins. See docs/ARCHITECTURE.md section 5.4. */
export function deriveRiskLevel(findings: readonly Finding[]): RiskLevel {
  if (findings.length === 0) return 'none';
  const prod = findings.filter((f) => !f.dev);
  const dev = findings.filter((f) => f.dev);
  const has = (list: readonly Finding[], ...severities: string[]) =>
    list.some((f) => severities.includes(f.severity));

  if (has(prod, 'CRITICAL')) return 'critical';
  if (has(prod, 'HIGH') || has(dev, 'CRITICAL')) return 'high';
  if (has(prod, 'MODERATE', 'UNKNOWN') || has(dev, 'HIGH')) return 'medium';
  return 'low';
}

/** Highest-scored finding per package, top N. Input must already be sorted by score. */
export function selectTopRisks(
  sortedFindings: readonly Finding[],
  limit = MAX_TOP_RISKS,
): Finding[] {
  const seen = new Set<string>();
  const top: Finding[] = [];
  for (const finding of sortedFindings) {
    if (seen.has(finding.packageName)) continue;
    seen.add(finding.packageName);
    top.push(finding);
    if (top.length === limit) break;
  }
  return top;
}

export function computeStats(
  findings: readonly Finding[],
  actions: readonly Action[],
): ReportStats {
  const bySeverity: SeverityCounts = { CRITICAL: 0, HIGH: 0, MODERATE: 0, LOW: 0, UNKNOWN: 0 };
  for (const finding of findings) bySeverity[finding.severity] += 1;
  return {
    totalFindings: findings.length,
    bySeverity,
    actionCount: actions.length,
    fixableFindings: findings.filter((f) => f.fixedVersion !== null).length,
  };
}
