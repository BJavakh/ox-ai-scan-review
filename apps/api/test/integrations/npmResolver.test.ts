import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScanFailure } from '../../src/domain/errors.js';
import { FIXTURES_DIR } from '../../src/integrations/fixtures/fixtureFetch.js';
import { NpmDependencyResolver } from '../../src/integrations/npm/NpmDependencyResolver.js';

const resolver = new NpmDependencyResolver();
const fixture = (repo: string, file: string) =>
  readFile(join(FIXTURES_DIR, 'github', repo, file), 'utf8');

function lockfile(packages: Record<string, unknown>, version = 3): Map<string, string> {
  return new Map([['package-lock.json', JSON.stringify({ lockfileVersion: version, packages })]]);
}

describe('NpmDependencyResolver', () => {
  it('chooses which manifests to download', () => {
    expect(resolver.manifestsToFetch(['README.md', 'package.json', 'package-lock.json'])).toEqual([
      'package-lock.json',
      'package.json',
    ]);
    expect(resolver.manifestsToFetch(['requirements.txt'])).toEqual([]);
  });

  it('resolves a v3 lockfile with direct, transitive, dev and introducedBy', async () => {
    const files = new Map([
      ['package-lock.json', await fixture('demo__vulnerable-app', 'package-lock.json')],
    ]);
    const { dependencies, coverage, notes } = resolver.resolve(files);
    const by = (name: string) => dependencies.find((d) => d.name === name);

    expect(coverage).toEqual({
      manifest: 'package-lock.json',
      lockfileVersion: 3,
      accuracy: 'exact',
      packagesChecked: 13,
      directDependencies: 5,
      transitiveDependencies: 8,
      skippedPackages: 0,
    });
    expect(notes).toEqual([]);
    expect(by('lodash')).toEqual({
      name: 'lodash',
      version: '4.17.15',
      direct: true,
      dev: false,
      introducedBy: [],
    });
    expect(by('qs')).toMatchObject({ direct: false, dev: false, introducedBy: ['express'] });
    expect(by('handlebars')).toMatchObject({ direct: true, dev: true });
    expect(by('source-map')).toMatchObject({
      direct: false,
      dev: true,
      introducedBy: ['handlebars'],
    });
    // reachable from a prod dep (mkdirp) and a dev dep (handlebars): not dev-only
    expect(by('minimist')).toMatchObject({ dev: false, introducedBy: ['handlebars', 'mkdirp'] });
  });

  it('uses the real name of aliased packages and skips links and non-registry entries', () => {
    const { dependencies, coverage } = resolver.resolve(
      lockfile({
        '': { dependencies: { 'my-lodash': 'npm:lodash@4.17.21', local: 'file:../x' } },
        'node_modules/my-lodash': { name: 'lodash', version: '4.17.21' },
        'node_modules/local': { link: true, resolved: '../x' },
        'node_modules/gitdep': { resolved: 'git+ssh://example' },
        'packages/workspace-a': { name: 'workspace-a', version: '1.0.0' },
      }),
    );
    expect(dependencies).toEqual([
      { name: 'lodash', version: '4.17.21', direct: true, dev: false, introducedBy: [] },
    ]);
    expect(coverage.skippedPackages).toBe(1);
  });

  it('resolves nested node_modules before hoisted ones', () => {
    const { dependencies } = resolver.resolve(
      lockfile({
        '': { dependencies: { a: '1.0.0', b: '1.0.0' } },
        'node_modules/a': { version: '1.0.0', dependencies: { c: '^2.0.0' } },
        'node_modules/a/node_modules/c': { version: '2.0.0' },
        'node_modules/b': { version: '1.0.0', dependencies: { c: '^1.0.0' } },
        'node_modules/c': { version: '1.0.0' },
      }),
    );
    expect(dependencies.find((d) => d.name === 'c' && d.version === '2.0.0')?.introducedBy).toEqual(
      ['a'],
    );
    expect(dependencies.find((d) => d.name === 'c' && d.version === '1.0.0')?.introducedBy).toEqual(
      ['b'],
    );
  });

  it('is not vulnerable to prototype pollution through package keys', () => {
    const text =
      '{"lockfileVersion":3,"packages":{"":{},"node_modules/__proto__":{"version":"1.0.0","polluted":true}}}';
    const { dependencies } = resolver.resolve(new Map([['package-lock.json', text]]));
    expect(dependencies).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('falls back to package.json (approximate) with notes', async () => {
    const files = new Map([
      ['package.json', await fixture('demo__approximate-app', 'package.json')],
    ]);
    const { dependencies, coverage, notes } = resolver.resolve(files);
    expect(coverage).toMatchObject({
      manifest: 'package.json',
      accuracy: 'approximate',
      lockfileVersion: null,
      skippedPackages: 1,
    });
    expect(dependencies).toContainEqual({
      name: 'express',
      version: '4.17.0',
      direct: true,
      dev: false,
      introducedBy: [],
    });
    expect(dependencies).toContainEqual({
      name: 'minimist',
      version: '1.2.0',
      direct: true,
      dev: true,
      introducedBy: [],
    });
    expect(notes.join(' ')).toContain('Lower accuracy');
  });

  it('falls back from an unsupported lockfile v1 when package.json exists', () => {
    const files = new Map([
      ['package-lock.json', JSON.stringify({ lockfileVersion: 1, dependencies: {} })],
      ['package.json', JSON.stringify({ dependencies: { ms: '2.1.3' } })],
    ]);
    const result = resolver.resolve(files);
    expect(result.coverage.manifest).toBe('package.json');
    expect(result.notes[0]).toContain('lockfileVersion 1');
  });

  it.each([
    ['invalid JSON lockfile', new Map([['package-lock.json', '{not json']]), 'MANIFEST_INVALID'],
    ['array package.json', new Map([['package.json', '[]']]), 'MANIFEST_INVALID'],
    [
      'v1 lockfile alone',
      new Map([['package-lock.json', '{"lockfileVersion":1}']]),
      'MANIFEST_INVALID',
    ],
    ['nothing', new Map<string, string>(), 'NO_SUPPORTED_MANIFEST'],
  ])('fails on %s', (_label, files, code) => {
    expect(() => resolver.resolve(files)).toThrow(ScanFailure);
    try {
      resolver.resolve(files);
    } catch (error) {
      expect((error as ScanFailure).code).toBe(code);
    }
  });

  it('enforces the package cap', () => {
    const packages: Record<string, unknown> = { '': {} };
    for (let i = 0; i < 10_001; i++) packages[`node_modules/p${String(i)}`] = { version: '1.0.0' };
    expect(() => resolver.resolve(lockfile(packages))).toThrow(/TOO_MANY_PACKAGES/);
  });
});
