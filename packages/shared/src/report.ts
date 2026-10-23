import { z } from 'zod';
import { commitShaSchema, repoRefSchema } from './scan.js';

export const severitySchema = z.enum(['CRITICAL', 'HIGH', 'MODERATE', 'LOW', 'UNKNOWN']);
export type Severity = z.infer<typeof severitySchema>;

/** Highest first. Used for sorting and "highest severity" comparisons. */
export const SEVERITY_ORDER: readonly Severity[] = [
  'CRITICAL',
  'HIGH',
  'MODERATE',
  'UNKNOWN',
  'LOW',
];

export const severitySourceSchema = z.enum(['malicious', 'ghsa', 'cvss_v3', 'unknown']);
export type SeveritySource = z.infer<typeof severitySourceSchema>;

export const riskLevelSchema = z.enum(['critical', 'high', 'medium', 'low', 'none']);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const findingSchema = z.object({
  id: z.string(),
  aliases: z.array(z.string()),
  packageName: z.string(),
  installedVersion: z.string(),
  severity: severitySchema,
  severitySource: severitySourceSchema,
  cvssScore: z.number().min(0).max(10).nullable(),
  summary: z.string(),
  fixedVersion: z.string().nullable(),
  direct: z.boolean(),
  dev: z.boolean(),
  introducedBy: z.array(z.string()),
  score: z.number().nonnegative(),
  advisoryUrl: z.url().startsWith('https://osv.dev/vulnerability/'),
});
export type Finding = z.infer<typeof findingSchema>;

export const actionSchema = z.object({
  id: z.string(),
  packageName: z.string(),
  currentVersions: z.array(z.string()).min(1),
  targetVersion: z.string().nullable(),
  findingIds: z.array(z.string()).min(1),
  fixableCount: z.number().int().nonnegative(),
  highestSeverity: severitySchema,
  direct: z.boolean(),
  dev: z.boolean(),
  introducedBy: z.array(z.string()),
  score: z.number().nonnegative(),
  command: z.string().nullable(),
  rationale: z.string(),
});
export type Action = z.infer<typeof actionSchema>;

export const topRiskSchema = z.object({
  findingId: z.string(),
  packageName: z.string(),
  severity: severitySchema,
  title: z.string(),
  explanation: z.string(),
});
export type TopRisk = z.infer<typeof topRiskSchema>;

export const summaryModeSchema = z.enum(['ai', 'template']);
export type SummaryMode = z.infer<typeof summaryModeSchema>;

export const reportSummarySchema = z.object({
  mode: summaryModeSchema,
  headline: z.string(),
  overview: z.string(),
  fallbackReason: z.string().nullable(),
});
export type ReportSummary = z.infer<typeof reportSummarySchema>;

export const coverageSchema = z.object({
  ecosystem: z.literal('npm'),
  manifest: z.enum(['package-lock.json', 'package.json']),
  lockfileVersion: z.number().int().nullable(),
  accuracy: z.enum(['exact', 'approximate']),
  packagesChecked: z.number().int().nonnegative(),
  directDependencies: z.number().int().nonnegative(),
  transitiveDependencies: z.number().int().nonnegative(),
  skippedPackages: z.number().int().nonnegative(),
  unsupportedManifests: z.array(z.string()),
  scannedPath: z.string(),
});
export type Coverage = z.infer<typeof coverageSchema>;

export const severityCountsSchema = z.object({
  CRITICAL: z.number().int().nonnegative(),
  HIGH: z.number().int().nonnegative(),
  MODERATE: z.number().int().nonnegative(),
  LOW: z.number().int().nonnegative(),
  UNKNOWN: z.number().int().nonnegative(),
});
export type SeverityCounts = z.infer<typeof severityCountsSchema>;

export const reportStatsSchema = z.object({
  totalFindings: z.number().int().nonnegative(),
  bySeverity: severityCountsSchema,
  actionCount: z.number().int().nonnegative(),
  fixableFindings: z.number().int().nonnegative(),
});
export type ReportStats = z.infer<typeof reportStatsSchema>;

export const reportSchema = z.object({
  scanId: z.uuid(),
  repo: repoRefSchema,
  ref: z.string().nullable(),
  commitSha: commitShaSchema,
  generatedAt: z.iso.datetime({ offset: true }),
  riskLevel: riskLevelSchema,
  summary: reportSummarySchema,
  actions: z.array(actionSchema),
  topRisks: z.array(topRiskSchema).max(5),
  findings: z.array(findingSchema),
  stats: reportStatsSchema,
  coverage: coverageSchema,
  notes: z.array(z.string()),
  reusedFromScanId: z.uuid().nullable(),
});
export type Report = z.infer<typeof reportSchema>;
