import { describe, expect, it } from 'vitest';
import {
  type InstalledPackage,
  type ManifestFacts,
  findOtherRisks,
} from '../../src/domain/otherRisks.js';

const facts = (overrides: Partial<ManifestFacts> = {}): ManifestFacts => ({
  lockfile: true,
  declared: [],
  nodeEngine: null,
  installed: [],
  ...overrides,
});

const pkg = (overrides: Partial<InstalledPackage> & { name: string }): InstalledPackage => ({
  version: '1.0.0',
  dev: false,
  hasInstallScript: false,
  resolved: `https://registry.npmjs.org/${overrides.name}/-/${overrides.name}-1.0.0.tgz`,
  license: 'MIT',
  ...overrides,
});

const kinds = (f: ManifestFacts) => findOtherRisks(f).map((r) => r.kind);
const only = (f: ManifestFacts) => {
  const risks = findOtherRisks(f);
  expect(risks).toHaveLength(1);
  return risks[0];
};

describe('findOtherRisks', () => {
  it('finds nothing in a clean, pinned, registry-only project', () => {
    expect(
      findOtherRisks(
        facts({
          declared: [{ name: 'express', spec: '^4.21.2', dev: false }],
          nodeEngine: '>=22',
          installed: [pkg({ name: 'express' })],
        }),
      ),
    ).toEqual([]);
  });

  it('flags packages fetched over plain HTTP as high', () => {
    expect(
      only(facts({ installed: [pkg({ name: 'a', resolved: 'http://registry.example/a.tgz' })] })),
    ).toMatchObject({ kind: 'insecure-download', level: 'high', packages: ['a@1.0.0'] });
  });

  it.each([
    ['git+ssh://git@github.com/a/b.git'],
    ['github:a/b'],
    ['a/b#v1'],
    ['https://example.com/b.tgz'],
  ])('flags the declared source %s, high in production', (spec) => {
    const risk = only(facts({ declared: [{ name: 'b', spec, dev: false }] }));
    expect(risk).toMatchObject({ kind: 'non-registry-source', level: 'high' });
    expect(risk?.packages).toEqual([`b (${spec})`]);
  });

  it('flags transitive git installs from the lockfile, medium when dev-only', () => {
    expect(
      only(
        facts({
          installed: [
            pkg({ name: 'c', dev: true, resolved: 'git+https://github.com/x/c.git#abc123' }),
          ],
        }),
      ),
    ).toMatchObject({ kind: 'non-registry-source', level: 'medium' });
  });

  it('does not treat local file: packages or workspace specs as remote sources', () => {
    expect(
      findOtherRisks(
        facts({
          declared: [
            { name: 'local', spec: 'file:../local', dev: false },
            { name: 'ws', spec: 'workspace:*', dev: false },
          ],
          installed: [pkg({ name: 'local', resolved: 'file:../local' })],
        }),
      ),
    ).toEqual([]);
  });

  it('lists install scripts with the ignore-scripts command, production packages first', () => {
    const risk = only(
      facts({
        installed: [
          pkg({ name: 'z-dev', dev: true, hasInstallScript: true }),
          pkg({ name: 'esbuild', hasInstallScript: true }),
        ],
      }),
    );
    expect(risk).toMatchObject({
      kind: 'install-scripts',
      command: 'npm ci --ignore-scripts',
      packages: ['esbuild@1.0.0', 'z-dev@1.0.0'],
      totalPackages: 2,
    });
  });

  it('reports a missing lockfile', () => {
    expect(only(facts({ lockfile: false }))).toMatchObject({
      kind: 'no-lockfile',
      level: 'medium',
      totalPackages: 0,
    });
  });

  it.each([['*'], ['latest'], ['>=1.0.0'], ['x'], ['']])(
    'flags the unbounded range "%s"',
    (spec) => {
      expect(kinds(facts({ declared: [{ name: 'a', spec, dev: false }] }))).toEqual([
        'unpinned-range',
      ]);
    },
  );

  it.each([['^1.2.3'], ['~1.2.3'], ['1.2.3'], ['>=1.0.0 <2.0.0'], ['1.x']])(
    'accepts the bounded range "%s"',
    (spec) => {
      expect(kinds(facts({ declared: [{ name: 'a', spec, dev: false }] }))).toEqual([]);
    },
  );

  it('rates unbounded ranges low when they only affect dev dependencies', () => {
    expect(only(facts({ declared: [{ name: 'a', spec: '*', dev: true }] }))?.level).toBe('low');
  });

  it.each([
    ['>=10 <15', true],
    ['^18.0.0', true],
    ['20.x', true],
    ['>=18', false],
    ['^22.0.0', false],
    ['not a range', false],
  ])('engines.node "%s" flagged: %s', (engine, flagged) => {
    expect(kinds(facts({ nodeEngine: engine })).includes('unsupported-node')).toBe(flagged);
  });

  it.each([
    ['GPL-3.0-only', true],
    ['AGPL-3.0', true],
    ['SSPL-1.0', true],
    ['LGPL-2.1', false],
    ['(MIT OR GPL-3.0)', false],
    ['MIT', false],
  ])('licence %s in production flagged: %s', (license, flagged) => {
    expect(kinds(facts({ installed: [pkg({ name: 'a', license })] }))).toEqual(
      flagged ? ['copyleft-license'] : [],
    );
  });

  it('ignores copyleft licences of dev-only packages', () => {
    expect(
      kinds(facts({ installed: [pkg({ name: 'a', dev: true, license: 'GPL-3.0' })] })),
    ).toEqual([]);
  });

  it('reports packages installed in three or more versions', () => {
    const versions = ['1.0.0', '2.0.0', '3.0.0'].map((version) => pkg({ name: 'debug', version }));
    expect(only(facts({ installed: [...versions, pkg({ name: 'ms' })] }))).toMatchObject({
      kind: 'duplicate-versions',
      level: 'low',
      command: 'npm dedupe',
      packages: ['debug (3 versions)'],
    });
  });

  it('orders risks high, then medium, then low, and caps the example list', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      pkg({ name: `p${String(i)}`, hasInstallScript: true }),
    );
    const risks = findOtherRisks(
      facts({
        lockfile: false,
        declared: [
          { name: 'a', spec: '*', dev: true },
          { name: 'g', spec: 'github:x/g', dev: false },
        ],
        installed: many,
      }),
    );
    expect(risks.map((r) => r.level)).toEqual(['high', 'medium', 'medium', 'low']);
    const scripts = risks.find((r) => r.kind === 'install-scripts');
    expect(scripts?.packages).toHaveLength(10);
    expect(scripts?.totalPackages).toBe(15);
  });
});
