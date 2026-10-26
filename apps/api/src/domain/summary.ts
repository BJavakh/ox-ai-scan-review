import { z } from 'zod';
import type {
  Coverage,
  RiskLevel,
  Severity,
  SeverityCounts,
  SeveritySource,
} from '@ox-scan/shared';
import type { Analysis } from './analysis.js';
import { truncate } from './findings.js';

/** Everything the summary writer (LLM or template) may see. Structured and length-capped. */
export interface SummaryInput {
  repository: string;
  commit: string;
  riskLevel: RiskLevel;
  manifest: Coverage['manifest'];
  accuracy: Coverage['accuracy'];
  packagesChecked: number;
  totals: {
    findings: number;
    fixable: number;
    actions: number;
    devOnlyFindings: number;
    criticalInProduction: number;
    bySeverity: SeverityCounts;
  };
  actions: SummaryActionInput[];
  topRisks: SummaryRiskInput[];
}

export interface SummaryActionInput {
  package: string;
  currentVersions: string[];
  targetVersion: string | null;
  majorUpgrade: boolean;
  issues: number;
  fixes: number;
  highestSeverity: Severity;
  scope: 'production' | 'development';
  relationship: 'direct' | 'transitive';
  introducedBy: string[];
}

export interface SummaryRiskInput {
  findingId: string;
  aliases: string[];
  package: string;
  version: string;
  severity: Severity;
  severitySource: SeveritySource;
  scope: 'production' | 'development';
  relationship: 'direct' | 'transitive';
  introducedBy: string[];
  fixedVersion: string | null;
  summary: string;
}

export const SUMMARY_LIMITS = {
  actions: 5,
  headline: 160,
  overview: 700,
  explanation: 500,
  riskSummary: 200,
  name: 100,
} as const;

export const summaryContentSchema = z.strictObject({
  headline: z.string().trim().min(1).max(SUMMARY_LIMITS.headline),
  overview: z.string().trim().min(1).max(SUMMARY_LIMITS.overview),
  riskExplanations: z
    .array(
      z.strictObject({
        findingId: z.string().min(1).max(SUMMARY_LIMITS.name),
        explanation: z.string().trim().min(1).max(SUMMARY_LIMITS.explanation),
      }),
    )
    .max(5),
});
export type SummaryContent = z.infer<typeof summaryContentSchema>;

const cap = (value: string) => truncate(value, SUMMARY_LIMITS.name);
const scope = (dev: boolean) => (dev ? 'development' : 'production');
const relationship = (direct: boolean) => (direct ? 'direct' : 'transitive');

export function buildSummaryInput(
  repository: string,
  commitSha: string,
  coverage: Coverage,
  analysis: Analysis,
): SummaryInput {
  return {
    repository: cap(repository),
    commit: commitSha.slice(0, 7),
    riskLevel: analysis.riskLevel,
    manifest: coverage.manifest,
    accuracy: coverage.accuracy,
    packagesChecked: coverage.packagesChecked,
    totals: {
      findings: analysis.stats.totalFindings,
      fixable: analysis.stats.fixableFindings,
      actions: analysis.stats.actionCount,
      devOnlyFindings: analysis.findings.filter((f) => f.dev).length,
      criticalInProduction: analysis.findings.filter((f) => !f.dev && f.severity === 'CRITICAL')
        .length,
      bySeverity: analysis.stats.bySeverity,
    },
    actions: analysis.actions.slice(0, SUMMARY_LIMITS.actions).map((a) => ({
      package: cap(a.packageName),
      currentVersions: a.currentVersions.slice(0, 3).map(cap),
      targetVersion: a.targetVersion,
      majorUpgrade: a.majorUpgrade,
      issues: a.findingIds.length,
      fixes: a.fixableCount,
      highestSeverity: a.highestSeverity,
      scope: scope(a.dev),
      relationship: relationship(a.direct),
      introducedBy: a.introducedBy.map(cap),
    })),
    topRisks: analysis.topRisks.map((f) => ({
      findingId: f.id,
      aliases: f.aliases.slice(0, 3),
      package: cap(f.packageName),
      version: cap(f.installedVersion),
      severity: f.severity,
      severitySource: f.severitySource,
      scope: scope(f.dev),
      relationship: relationship(f.direct),
      introducedBy: f.introducedBy.map(cap),
      fixedVersion: f.fixedVersion,
      summary: truncate(f.summary, SUMMARY_LIMITS.riskSummary),
    })),
  };
}
