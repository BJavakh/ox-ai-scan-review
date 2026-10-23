import Anthropic from '@anthropic-ai/sdk';
import type { SummaryContent, SummaryInput } from '../../domain/summary.js';
import { validateSummary } from '../../domain/summaryValidation.js';
import { safeJsonParse } from '../../lib/http.js';
import { type SummaryGenerator, SummaryUnavailableError } from './SummaryGenerator.js';
import { SYSTEM_PROMPT, outputSchema } from './prompt.js';

export interface AnthropicSummaryOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Injectable for tests. */
  client?: Pick<Anthropic, 'messages'>;
}

/**
 * Asks Claude for the summary using structured outputs, then validates the
 * result against the schema and the input (grounding). Any problem becomes a
 * SummaryUnavailableError so the caller can fall back to the template.
 */
export class AnthropicSummaryGenerator implements SummaryGenerator {
  private readonly client: Pick<Anthropic, 'messages'>;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: AnthropicSummaryOptions) {
    // SDK retries are disabled: an LLM retry costs money and time, and we have a fallback.
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 0 });
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
  }

  async generate(input: SummaryInput, signal: AbortSignal): Promise<SummaryContent> {
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: JSON.stringify(input) }],
          output_config: {
            effort: 'low',
            format: { type: 'json_schema', schema: outputSchema(input) },
          },
        },
        { timeout: this.timeoutMs, signal, maxRetries: 0 },
      );
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        throw new SummaryUnavailableError('The AI summary timed out.', { cause: error });
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new SummaryUnavailableError('The AI service is rate limited.', { cause: error });
      }
      throw new SummaryUnavailableError('The AI service returned an error.', { cause: error });
    }

    if (message.stop_reason === 'refusal')
      throw new SummaryUnavailableError('The AI declined to write a summary.');
    if (message.stop_reason === 'max_tokens')
      throw new SummaryUnavailableError('The AI summary was cut off.');

    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    const parsed = safeJsonParse(text);
    if (!parsed.ok) throw new SummaryUnavailableError('The AI output was not valid JSON.');

    const validated = validateSummary(parsed.value, input);
    if (!validated.ok)
      throw new SummaryUnavailableError(`The AI output failed validation (${validated.reason}).`);
    return validated.value;
  }
}
