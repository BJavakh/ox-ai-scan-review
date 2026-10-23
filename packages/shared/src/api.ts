import { z } from 'zod';
import { riskLevelSchema } from './report.js';
import { commitShaSchema, repoRefSchema, scanStatusSchema } from './scan.js';

export const MAX_REPO_URL_LENGTH = 300;

export const createScanRequestSchema = z.strictObject({
  repoUrl: z.string().min(1).max(MAX_REPO_URL_LENGTH),
});
export type CreateScanRequest = z.infer<typeof createScanRequestSchema>;

export const createScanResponseSchema = z.object({
  scanId: z.uuid(),
  status: scanStatusSchema,
  deduplicated: z.boolean(),
});
export type CreateScanResponse = z.infer<typeof createScanResponseSchema>;

export const scanIdParamsSchema = z.object({ id: z.uuid() });

export const scanListItemSchema = z.object({
  id: z.uuid(),
  repo: repoRefSchema,
  ref: z.string().nullable(),
  status: scanStatusSchema,
  riskLevel: riskLevelSchema.nullable(),
  commitSha: commitShaSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ScanListItem = z.infer<typeof scanListItemSchema>;

export const scanListResponseSchema = z.object({ scans: z.array(scanListItemSchema) });
export type ScanListResponse = z.infer<typeof scanListResponseSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  mode: z.enum(['live', 'mock']),
  aiSummaries: z.boolean(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const apiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'INVALID_REPO_URL',
  'NOT_FOUND',
  'SCAN_NOT_COMPLETED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'TOO_MANY_STREAMS',
  'SERVICE_BUSY',
  'INTERNAL_ERROR',
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
