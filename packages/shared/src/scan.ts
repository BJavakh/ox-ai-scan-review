import { z } from 'zod';

export const scanStatusSchema = z.enum([
  'queued',
  'fetching_repo',
  'resolving_dependencies',
  'checking_vulnerabilities',
  'prioritizing',
  'generating_summary',
  'completed',
  'failed',
]);
export type ScanStatus = z.infer<typeof scanStatusSchema>;

export const TERMINAL_STATUSES: readonly ScanStatus[] = ['completed', 'failed'];

export function isTerminalStatus(status: ScanStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** The six user-visible steps, in order. Each working status has a step of the same name. */
export const stepNameSchema = z.enum([
  'fetching_repo',
  'resolving_dependencies',
  'checking_vulnerabilities',
  'prioritizing',
  'generating_summary',
  'completed',
]);
export type StepName = z.infer<typeof stepNameSchema>;

export const STEP_ORDER: readonly StepName[] = stepNameSchema.options;

export const STEP_LABELS: Readonly<Record<StepName, string>> = {
  fetching_repo: 'Fetch repository',
  resolving_dependencies: 'Resolve dependencies',
  checking_vulnerabilities: 'Check known vulnerabilities',
  prioritizing: 'Prioritize risks',
  generating_summary: 'Write summary',
  completed: 'Report ready',
};

export const stepStatusSchema = z.enum(['pending', 'running', 'completed', 'skipped', 'failed']);
export type StepStatus = z.infer<typeof stepStatusSchema>;

const isoDateTime = z.iso.datetime({ offset: true });

export const scanStepSchema = z.object({
  name: stepNameSchema,
  label: z.string(),
  status: stepStatusSchema,
  detail: z.string().nullable(),
  startedAt: isoDateTime.nullable(),
  finishedAt: isoDateTime.nullable(),
});
export type ScanStep = z.infer<typeof scanStepSchema>;

export const scanErrorCodeSchema = z.enum([
  'REPO_NOT_FOUND',
  'REPO_EMPTY',
  'GITHUB_RATE_LIMITED',
  'GITHUB_UNAVAILABLE',
  'NO_SUPPORTED_MANIFEST',
  'MANIFEST_TOO_LARGE',
  'MANIFEST_INVALID',
  'TOO_MANY_PACKAGES',
  'VULN_SOURCE_UNAVAILABLE',
  'SCAN_TIMEOUT',
  'INTERNAL_ERROR',
]);
export type ScanErrorCode = z.infer<typeof scanErrorCodeSchema>;

export const scanErrorSchema = z.object({
  code: scanErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
});
export type ScanError = z.infer<typeof scanErrorSchema>;

export const repoRefSchema = z.object({
  owner: z.string(),
  name: z.string(),
  url: z.url(),
});
export type RepoRef = z.infer<typeof repoRefSchema>;

export const commitShaSchema = z.string().regex(/^[0-9a-f]{40}$/, 'Expected a 40-char commit SHA');

export const scanSchema = z.object({
  id: z.uuid(),
  repo: repoRefSchema,
  ref: z.string().nullable(),
  commitSha: commitShaSchema.nullable(),
  status: scanStatusSchema,
  progress: z.number().int().min(0).max(100),
  steps: z.array(scanStepSchema).length(STEP_ORDER.length),
  error: scanErrorSchema.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
});
export type Scan = z.infer<typeof scanSchema>;
