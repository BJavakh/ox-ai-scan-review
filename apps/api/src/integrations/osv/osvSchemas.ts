import { z } from 'zod';

export const OSV_API_ORIGIN = 'https://api.osv.dev';

export const querybatchResponseSchema = z.object({
  results: z.array(
    z.object({
      vulns: z.array(z.object({ id: z.string(), modified: z.string().optional() })).optional(),
      next_page_token: z.string().optional(),
    }),
  ),
});

const eventSchema = z.object({
  introduced: z.string().optional(),
  fixed: z.string().optional(),
  last_affected: z.string().optional(),
  limit: z.string().optional(),
});

export const osvVulnerabilitySchema = z.object({
  id: z.string().max(100),
  summary: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  withdrawn: z.string().optional(),
  database_specific: z.object({ severity: z.unknown().optional() }).loose().optional(),
  severity: z.array(z.object({ type: z.string(), score: z.string() })).optional(),
  affected: z
    .array(
      z.object({
        package: z.object({ name: z.string(), ecosystem: z.string() }).optional(),
        ranges: z.array(z.object({ type: z.string(), events: z.array(eventSchema) })).optional(),
        versions: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});
export type OsvVulnerability = z.infer<typeof osvVulnerabilitySchema>;
