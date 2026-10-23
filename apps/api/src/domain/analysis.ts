import type { Action, Finding, ReportStats, RiskLevel } from '@ox-scan/shared';
import { groupIntoActions } from './actions.js';
import { buildFindings } from './findings.js';
import { computeStats, deriveRiskLevel, selectTopRisks } from './risk.js';
import type { Advisory, AdvisoryMatches, Dependency } from './types.js';

export interface Analysis {
  findings: Finding[];
  actions: Action[];
  riskLevel: RiskLevel;
  topRisks: Finding[];
  stats: ReportStats;
}

/** The deterministic core: findings -> actions -> risk. No I/O, no LLM. */
export function analyze(
  dependencies: readonly Dependency[],
  matches: AdvisoryMatches,
  advisories: ReadonlyMap<string, Advisory>,
): Analysis {
  const findings = buildFindings(dependencies, matches, advisories);
  const actions = groupIntoActions(findings);
  return {
    findings,
    actions,
    riskLevel: deriveRiskLevel(findings),
    topRisks: selectTopRisks(findings),
    stats: computeStats(findings, actions),
  };
}
