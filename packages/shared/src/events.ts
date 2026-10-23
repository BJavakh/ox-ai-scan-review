import { z } from 'zod';
import { scanErrorSchema, scanSchema, scanStatusSchema, scanStepSchema } from './scan.js';

/** SSE event names and the schema of each event's JSON `data`. */
export const scanEventSchemas = {
  snapshot: scanSchema,
  step: scanStepSchema,
  progress: z.object({ status: scanStatusSchema, progress: z.number().int().min(0).max(100) }),
  completed: z.object({ scanId: z.uuid() }),
  failed: z.object({ scanId: z.uuid(), error: scanErrorSchema }),
} as const;

export type ScanEventName = keyof typeof scanEventSchemas;

export const SCAN_EVENT_NAMES = Object.keys(scanEventSchemas) as ScanEventName[];

export type ScanEvent = {
  [K in ScanEventName]: { event: K; data: z.infer<(typeof scanEventSchemas)[K]> };
}[ScanEventName];
