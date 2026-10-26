import semver from 'semver';
import { ScanFailure } from '../../domain/errors.js';
import { type Dependency, dependencyKey } from '../../domain/types.js';
import type { ResolvedDependencies } from '../DependencyResolver.js';
import { MAX_PACKAGES, declaredDependencies, nodeEngine } from './lockfile.js';
import { isValidPackageName, objectEntries } from './npmNames.js';

const PROD_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

/**
 * Fallback when no supported lockfile exists: check direct dependencies only,
 * at the lowest version that satisfies each declared range. Approximate.
 */
export function parsePackageJson(raw: unknown, notes: string[]): ResolvedDependencies {
  const pkg = raw as Record<string, unknown>;
  const byKey = new Map<string, Dependency>();
  let skipped = 0;

  const add = (field: string, dev: boolean) => {
    for (const [name, range] of objectEntries(pkg[field])) {
      if (
        typeof range !== 'string' ||
        !isValidPackageName(name) ||
        semver.validRange(range) === null
      ) {
        skipped += 1;
        continue;
      }
      const version = semver.minVersion(range)?.version;
      if (version === undefined) {
        skipped += 1;
        continue;
      }
      const key = dependencyKey(name, version);
      const existing = byKey.get(key);
      if (existing) existing.dev &&= dev;
      else byKey.set(key, { name, version, direct: true, dev, introducedBy: [] });
      if (byKey.size > MAX_PACKAGES) throw new ScanFailure('TOO_MANY_PACKAGES');
    }
  };
  for (const field of PROD_FIELDS) add(field, false);
  add('devDependencies', true);

  const dependencies = [...byKey.values()];
  return {
    dependencies,
    coverage: {
      manifest: 'package.json',
      lockfileVersion: null,
      accuracy: 'approximate',
      packagesChecked: dependencies.length,
      directDependencies: dependencies.length,
      transitiveDependencies: 0,
      skippedPackages: skipped,
    },
    notes: [
      ...notes,
      'Lower accuracy: no supported lockfile was found, so each direct dependency was checked at the lowest version its range allows, and transitive dependencies were not checked.',
      ...(skipped > 0
        ? [
            `${String(skipped)} dependencies with non-registry specifiers (git, file, workspace, aliases) were not checked.`,
          ]
        : []),
    ],
    facts: {
      lockfile: false,
      declared: declaredDependencies(pkg),
      nodeEngine: nodeEngine(pkg.engines),
      installed: [],
    },
  };
}
