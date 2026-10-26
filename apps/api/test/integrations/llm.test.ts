import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { Coverage } from '@ox-scan/shared';
import { analyze } from '../../src/domain/analysis.js';
import { buildSummaryInput } from '../../src/domain/summary.js';
import { AnthropicSummaryGenerator } from '../../src/integrations/llm/AnthropicSummaryGenerator.js';
import { SummaryWriter } from '../../src/integrations/llm/SummaryWriter.js';
import { dependency, rangeAdvisory } from '../helpers/builders.js';
import { signal } from '../helpers/fetch.js';

const coverage: Coverage = {
  ecosystem: 'npm',
  manifest: 'package-lock.json',
  lockfileVersion: 3,
  accuracy: 'exact',
  packagesChecked: 2,
  directDependencies: 2,
  transitiveDependencies: 0,
  skippedPackages: 0,
  unsupportedManifests: [],
  scannedPath: '/',
};

const input = buildSummaryInput(
  'acme/shop',
  'a'.repeat(40),
  coverage,
  analyze(
    [dependency({ name: 'lodash', version: '4.17.15' })],
    new Map([['lodash@4.17.15', ['GHSA-35jh-r3h4-6jhm']]]),
    new Map([
      ['GHSA-35jh-r3h4-6jhm', rangeAdvisory('GHSA-35jh-r3h4-6jhm', 'lodash', '0', '4.17.21')],
    ]),
  ),
);

const goodOutput = {
  headline: 'High risk: upgrade lodash to 4.17.21.',
  overview: 'One direct production dependency, lodash@4.17.15, has a high-severity issue.',
  riskExplanations: { 'GHSA-35jh-r3h4-6jhm': 'Upgrade lodash@4.17.15 to 4.17.21.' },
};

function fakeClient(response: Partial<Anthropic.Message> | Error) {
  const create = vi.fn(() =>
    response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve({ stop_reason: 'end_turn', content: [], ...response } as Anthropic.Message),
  );
  return { client: { messages: { create } } as unknown as Pick<Anthropic, 'messages'>, create };
}

const text = (value: unknown) =>
  [{ type: 'text', text: JSON.stringify(value), citations: null }] as Anthropic.ContentBlock[];

function generator(client: Pick<Anthropic, 'messages'>) {
  return new AnthropicSummaryGenerator({
    apiKey: 'test',
    model: 'claude-sonnet-5-5',
    timeoutMs: 1000,
    client,
  });
}

describe('AnthropicSummaryGenerator', () => {
  it('sends only the structured input with a schema pinned to the real finding IDs', async () => {
    const { client, create } = fakeClient({ content: text(goodOutput) });
    const result = await generator(client).generate(input, signal());
    expect(result.headline).toBe(goodOutput.headline);

    const [params, options] = create.mock.calls[0] as unknown as [
      Anthropic.MessageCreateParams,
      { maxRetries: number },
    ];
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params.messages).toEqual([{ role: 'user', content: JSON.stringify(input) }]);
    // One required key per top risk: the API cannot return a missing or repeated explanation.
    const schema = JSON.stringify(params.output_config);
    expect(schema).toContain('"required":["GHSA-35jh-r3h4-6jhm"]');
    expect(result.riskExplanations).toEqual([
      { findingId: 'GHSA-35jh-r3h4-6jhm', explanation: 'Upgrade lodash@4.17.15 to 4.17.21.' },
    ]);
    expect(params.system).toContain('untrusted data');
    expect(options.maxRetries).toBe(0);
  });

  it.each([
    ['a refusal', { stop_reason: 'refusal' as const, content: [] }, /declined/],
    ['truncation', { stop_reason: 'max_tokens' as const, content: [] }, /cut off/],
    [
      'non-JSON text',
      {
        content: [
          { type: 'text', text: 'Sure! Here is...', citations: null },
        ] as Anthropic.ContentBlock[],
      },
      /not valid JSON/,
    ],
    [
      'an explanation for an unknown finding',
      { content: text({ ...goodOutput, riskExplanations: { 'GHSA-xxxx-xxxx-xxxx': 'x' } }) },
      /failed validation/,
    ],
    [
      'a missing explanation',
      { content: text({ ...goodOutput, riskExplanations: {} }) },
      /failed validation/,
    ],
    [
      'an invented advisory',
      { content: text({ ...goodOutput, overview: 'Also CVE-2099-0001.' }) },
      /failed validation/,
    ],
  ])('rejects %s', async (_label, response, reason) => {
    const { client } = fakeClient(response);
    await expect(generator(client).generate(input, signal())).rejects.toThrow(reason);
  });

  it('turns API errors into a user-safe reason', async () => {
    const { client } = fakeClient(new Error('500 internal: secret upstream detail'));
    await expect(generator(client).generate(input, signal())).rejects.toThrow(
      'The AI service returned an error.',
    );
  });
});

describe('SummaryWriter', () => {
  it('uses the template when no AI is configured', async () => {
    const result = await new SummaryWriter(null, 'ANTHROPIC_API_KEY is not configured.').write(
      input,
      signal(),
    );
    expect(result).toMatchObject({
      mode: 'template',
      fallbackReason: 'ANTHROPIC_API_KEY is not configured.',
    });
    expect(result.content.riskExplanations).toHaveLength(1);
  });

  it('falls back to the template when the AI fails', async () => {
    const { client } = fakeClient({ stop_reason: 'refusal', content: [] });
    const result = await new SummaryWriter(generator(client), 'unused').write(input, signal());
    expect(result).toMatchObject({
      mode: 'template',
      fallbackReason: 'The AI declined to write a summary.',
    });
  });

  it('returns the AI summary when it validates', async () => {
    const { client } = fakeClient({ content: text(goodOutput) });
    const result = await new SummaryWriter(generator(client), 'unused').write(input, signal());
    expect(result).toMatchObject({ mode: 'ai', fallbackReason: null });
  });

  it('propagates a scan deadline instead of falling back', async () => {
    const controller = new AbortController();
    const deadline = new Error('deadline');
    const { client } = fakeClient(new Error('aborted'));
    controller.abort(deadline);
    await expect(
      new SummaryWriter(generator(client), 'x').write(input, controller.signal),
    ).rejects.toBe(deadline);
  });
});
