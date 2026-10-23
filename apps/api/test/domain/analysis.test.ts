import { describe, expect, it } from 'vitest';
import { groupIntoActions } from '../../src/domain/actions.js';
import { analyze } from '../../src/domain/analysis.js';
import { buildFindings } from '../../src/domain/findings.js';
import { computeStats, deriveRiskLevel, selectTopRisks } from '../../src/domain/risk.js';
import type { Advisory } from '../../src/domain/types.js';
import { advisory, dependency, finding, rangeAdvisory } from '../helpers/builders.js';

function advisoryMap(...items: Advisory[]): Map<string, Advisory> {
  return new Map(items.map((a) => [a.id, a]));
}

describe('buildFindings', () => {
  it('creates one scored finding per package version and advisory', () => {
    const deps = [
      dependency({ name: 'lodash', version: '4.17.15', direct: false, introducedBy: ['express'] }),
      dependency({ name: 'jest', version: '29.0.0', dev: true }),
    ];
    const matches = new Map([
      ['lodash@4.17.15', ['GHSA-p6mc-m468-83gw', 'GHSA-p6mc-m468-83gw']],
      ['jest@29.0.0', []],
    ]);
    const advisories = advisoryMap(
      rangeAdvisory('GHSA-p6mc-m468-83gw', 'lodash', '3.7.0', '4.17.19', 'HIGH'),
    );

    const findings = buildFindings(deps, matches, advisories);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: 'GHSA-p6mc-m468-83gw',
      packageName: 'lodash',
      severity: 'HIGH',
      fixedVersion: '4.17.19',
      direct: false,
      introducedBy: ['express'],
      score: 5.25,
      advisoryUrl: 'https://osv.dev/vulnerability/GHSA-p6mc-m468-83gw',
    });
  });

  it('keeps advisories that could not be hydrated as UNKNOWN with a visible summary', () => {
    const findings = buildFindings(
      [dependency({ name: 'pkg' })],
      new Map([['pkg@1.0.0', ['GHSA-xxxx-yyyy-zzzz']]]),
      new Map(),
    );
    expect(findings[0]).toMatchObject({
      severity: 'UNKNOWN',
      severitySource: 'unknown',
      fixedVersion: null,
      summary: 'GHSA-xxxx-yyyy-zzzz (details could not be loaded)',
    });
  });

  it('drops advisory IDs with unexpected characters', () => {
    const findings = buildFindings(
      [dependency({ name: 'pkg' })],
      new Map([['pkg@1.0.0', ['<script>', 'GHSA-ok00-ok00-ok00']]]),
      new Map(),
    );
    expect(findings.map((f) => f.id)).toEqual(['GHSA-ok00-ok00-ok00']);
  });

  it('truncates long advisory summaries', () => {
    const long = advisory({ id: 'X-1', summary: 'a'.repeat(1000), databaseSeverity: 'LOW' });
    const [f] = buildFindings(
      [dependency({ name: 'pkg' })],
      new Map([['pkg@1.0.0', ['X-1']]]),
      advisoryMap(long),
    );
    expect(f?.summary.length).toBeLessThanOrEqual(300);
    expect(f?.summary.endsWith('...')).toBe(true);
  });
});

describe('groupIntoActions', () => {
  it('groups by package and targets the highest minimal fix', () => {
    const actions = groupIntoActions([
      finding({
        id: 'A',
        packageName: 'lodash',
        installedVersion: '4.17.15',
        fixedVersion: '4.17.19',
        severity: 'HIGH',
        score: 7,
      }),
      finding({
        id: 'B',
        packageName: 'lodash',
        installedVersion: '4.17.15',
        fixedVersion: '4.17.21',
        severity: 'MODERATE',
        score: 4,
      }),
      finding({
        id: 'C',
        packageName: 'lodash',
        installedVersion: '4.17.15',
        fixedVersion: '4.17.12',
        severity: 'LOW',
        score: 1.5,
      }),
      finding({
        id: 'D',
        packageName: 'minimist',
        fixedVersion: '1.2.6',
        severity: 'CRITICAL',
        score: 10,
      }),
    ]);
    expect(actions.map((a) => a.packageName)).toEqual(['minimist', 'lodash']);
    const lodash = actions[1];
    expect(lodash).toMatchObject({
      targetVersion: '4.17.21',
      currentVersions: ['4.17.15'],
      findingIds: ['A', 'B', 'C'],
      fixableCount: 3,
      highestSeverity: 'HIGH',
      score: 8.38,
      command: 'npm install lodash@4.17.21',
    });
    expect(lodash?.rationale).toContain('Upgrade lodash 4.17.15 to 4.17.21: fixes 3 issues');
  });

  it('uses --save-dev for direct dev deps and npm update for transitive deps', () => {
    const [dev] = groupIntoActions([finding({ id: 'A', packageName: 'jest', dev: true })]);
    expect(dev?.command).toBe('npm install --save-dev jest@1.0.1');

    const [transitive] = groupIntoActions([
      finding({
        id: 'A',
        packageName: 'qs',
        direct: false,
        introducedBy: ['express', 'body-parser'],
      }),
    ]);
    expect(transitive?.command).toBe('npm update qs');
    expect(transitive?.introducedBy).toEqual(['body-parser', 'express']);
    expect(transitive?.rationale).toContain('pulled in by body-parser, express');
    expect(transitive?.rationale).toContain('"overrides"');
  });

  it('marks unfixable packages with no command and explains why', () => {
    const [action] = groupIntoActions([finding({ id: 'A', fixedVersion: null })]);
    expect(action).toMatchObject({ targetVersion: null, command: null, fixableCount: 0 });
    expect(action?.rationale).toContain('no patched version yet');
  });

  it('counts a package as production if any instance is production, direct if any is direct', () => {
    const [action] = groupIntoActions([
      finding({ id: 'A', installedVersion: '1.0.0', dev: true, direct: false }),
      finding({ id: 'B', installedVersion: '2.0.0', dev: false, direct: true }),
    ]);
    expect(action).toMatchObject({ dev: false, direct: true, currentVersions: ['1.0.0', '2.0.0'] });
  });

  it('notes partially fixable groups', () => {
    const [action] = groupIntoActions([
      finding({ id: 'A', fixedVersion: '1.0.1' }),
      finding({ id: 'B', fixedVersion: null }),
    ]);
    expect(action?.fixableCount).toBe(1);
    expect(action?.rationale).toContain('1 issue remain without a fix');
  });
});

describe('deriveRiskLevel', () => {
  it.each([
    [[], 'none'],
    [[finding({ id: 'A', severity: 'CRITICAL' })], 'critical'],
    [[finding({ id: 'A', severity: 'CRITICAL', dev: true })], 'high'],
    [[finding({ id: 'A', severity: 'HIGH' })], 'high'],
    [[finding({ id: 'A', severity: 'HIGH', dev: true })], 'medium'],
    [[finding({ id: 'A', severity: 'MODERATE' })], 'medium'],
    [[finding({ id: 'A', severity: 'UNKNOWN' })], 'medium'],
    [[finding({ id: 'A', severity: 'UNKNOWN', dev: true })], 'low'],
    [[finding({ id: 'A', severity: 'MODERATE', dev: true })], 'low'],
    [[finding({ id: 'A', severity: 'LOW' })], 'low'],
  ] as const)('%#: -> %s', (findings, expected) => {
    expect(deriveRiskLevel(findings)).toBe(expected);
  });
});

describe('selectTopRisks', () => {
  it('takes at most one finding per package, up to five', () => {
    const sorted = [
      finding({ id: 'A1', packageName: 'a', score: 10 }),
      finding({ id: 'A2', packageName: 'a', score: 9 }),
      ...['b', 'c', 'd', 'e', 'f'].map((p, i) => finding({ id: p, packageName: p, score: 8 - i })),
    ];
    expect(selectTopRisks(sorted).map((f) => f.id)).toEqual(['A1', 'b', 'c', 'd', 'e']);
  });
});

describe('analyze', () => {
  it('produces findings, actions, risk, top risks and stats together', () => {
    const result = analyze(
      [
        dependency({ name: 'lodash', version: '4.17.15' }),
        dependency({ name: 'mocha', version: '1.0.0', dev: true }),
      ],
      new Map([
        ['lodash@4.17.15', ['G1', 'G2']],
        ['mocha@1.0.0', ['G3']],
      ]),
      advisoryMap(
        rangeAdvisory('G1', 'lodash', '0', '4.17.19', 'HIGH'),
        rangeAdvisory('G2', 'lodash', '0', '4.17.21', 'MODERATE'),
        rangeAdvisory('G3', 'mocha', '0', null, 'CRITICAL'),
      ),
    );
    expect(result.riskLevel).toBe('high');
    expect(result.actions.map((a) => a.packageName)).toEqual(['lodash', 'mocha']);
    expect(result.topRisks.map((f) => f.id)).toEqual(['G1', 'G3']);
    expect(result.stats).toEqual(computeStats(result.findings, result.actions));
    expect(result.stats).toMatchObject({ totalFindings: 3, actionCount: 2, fixableFindings: 2 });
  });
});
