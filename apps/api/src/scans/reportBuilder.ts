import type { Coverage, OtherRisk, Report, Scan } from '@ox-scan/shared';
import type { Analysis } from '../domain/analysis.js';
import type { SummaryInput } from '../domain/summary.js';
import { explainRisk } from '../domain/templateSummary.js';
import type { WrittenSummary } from '../integrations/llm/SummaryGenerator.js';

export function buildReport(
  scan: Scan,
  commitSha: string,
  coverage: Coverage,
  analysis: Analysis,
  summaryInput: SummaryInput,
  summary: WrittenSummary,
  otherRisks: OtherRisk[],
  notes: string[],
  generatedAt: string,
): Report {
  const explanations = new Map(
    summary.content.riskExplanations.map((r) => [r.findingId, r.explanation]),
  );
  return {
    scanId: scan.id,
    repo: scan.repo,
    ref: scan.ref,
    commitSha,
    generatedAt,
    riskLevel: analysis.riskLevel,
    summary: {
      mode: summary.mode,
      headline: summary.content.headline,
      overview: summary.content.overview,
      fallbackReason: summary.fallbackReason,
    },
    actions: analysis.actions,
    topRisks: analysis.topRisks.map((finding, index) => {
      const fallback = summaryInput.topRisks[index];
      return {
        findingId: finding.id,
        packageName: finding.packageName,
        severity: finding.severity,
        title: finding.summary,
        explanation:
          explanations.get(finding.id) ?? (fallback ? explainRisk(fallback) : finding.summary),
      };
    }),
    findings: analysis.findings,
    otherRisks,
    stats: analysis.stats,
    coverage,
    notes,
    reusedFromScanId: null,
  };
}
