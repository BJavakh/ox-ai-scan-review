import type { SummaryMode } from '@ox-scan/shared';
import type { SummaryContent, SummaryInput } from '../../domain/summary.js';

/** Writes the prose of a report from already-computed, structured results. */
export interface SummaryGenerator {
  generate(input: SummaryInput, signal: AbortSignal): Promise<SummaryContent>;
}

/** Thrown when the AI summary cannot be used; `reason` is safe to show to users. */
export class SummaryUnavailableError extends Error {
  constructor(
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(reason, options);
    this.name = 'SummaryUnavailableError';
  }
}

export interface WrittenSummary {
  content: SummaryContent;
  mode: SummaryMode;
  fallbackReason: string | null;
}
