import type { Finding } from '@ox-scan/shared';
import type { Advisory, Dependency } from '../../src/domain/types.js';

export function advisory(overrides: Partial<Advisory> & { id: string }): Advisory {
  return {
    aliases: [],
    summary: `Summary of ${overrides.id}`,
    databaseSeverity: null,
    severityVectors: [],
    affected: [],
    hydrated: true,
    ...overrides,
  };
}

/** Advisory affecting `name` from `introduced` up to (not including) `fixed`. */
export function rangeAdvisory(
  id: string,
  name: string,
  introduced: string,
  fixed: string | null,
  severity: string | null = 'HIGH',
): Advisory {
  return advisory({
    id,
    databaseSeverity: severity,
    affected: [
      {
        name,
        versions: [],
        ranges: [
          {
            type: 'SEMVER',
            events: [
              { kind: 'introduced', version: introduced },
              ...(fixed === null ? [] : [{ kind: 'fixed' as const, version: fixed }]),
            ],
          },
        ],
      },
    ],
  });
}

export function dependency(overrides: Partial<Dependency> & { name: string }): Dependency {
  return { version: '1.0.0', direct: true, dev: false, introducedBy: [], ...overrides };
}

export function finding(overrides: Partial<Finding> & { id: string }): Finding {
  return {
    aliases: [],
    packageName: 'pkg',
    installedVersion: '1.0.0',
    severity: 'HIGH',
    severitySource: 'ghsa',
    cvssScore: null,
    summary: `Summary of ${overrides.id}`,
    fixedVersion: '1.0.1',
    direct: true,
    dev: false,
    introducedBy: [],
    score: 7,
    advisoryUrl: `https://osv.dev/vulnerability/${overrides.id}`,
    ...overrides,
  };
}
