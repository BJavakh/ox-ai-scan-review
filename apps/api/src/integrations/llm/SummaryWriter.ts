import type { FastifyBaseLogger } from 'fastify';
import type { SummaryInput } from '../../domain/summary.js';
import { generateTemplateSummary } from '../../domain/templateSummary.js';
import {
  type SummaryGenerator,
  SummaryUnavailableError,
  type WrittenSummary,
} from './SummaryGenerator.js';

/**
 * Uses the AI generator when configured and falls back to the deterministic
 * template on any failure. Never throws for LLM reasons; only a scan abort
 * (deadline) propagates.
 */
export class SummaryWriter {
  constructor(
    private readonly ai: SummaryGenerator | null,
    private readonly unavailableReason: string,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  get aiEnabled(): boolean {
    return this.ai !== null;
  }

  async write(input: SummaryInput, signal: AbortSignal): Promise<WrittenSummary> {
    if (this.ai === null) return this.template(input, this.unavailableReason);
    try {
      const content = await this.ai.generate(input, signal);
      return { content, mode: 'ai', fallbackReason: null };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      const reason =
        error instanceof SummaryUnavailableError
          ? error.reason
          : 'The AI summary failed unexpectedly.';
      this.logger?.warn({ err: error, reason }, 'AI summary unavailable, using template');
      return this.template(input, reason);
    }
  }

  private template(input: SummaryInput, reason: string): WrittenSummary {
    return { content: generateTemplateSummary(input), mode: 'template', fallbackReason: reason };
  }
}
