import semver from 'semver';
import type { Advisory, RangeEvent } from './types.js';

/** OSV uses "0" for "all versions"; it is not valid semver. */
function compareEventVersion(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '0') return -1;
  if (b === '0') return 1;
  return semver.compare(a, b);
}

function gte(version: string, bound: string): boolean {
  return bound === '0' || semver.gte(version, bound);
}

function isComparable(event: RangeEvent): boolean {
  return event.version === '0' || semver.valid(event.version) !== null;
}

interface RangeHit {
  affected: boolean;
  fixedVersion: string | null;
}

/** Walk sorted events of one range; return whether `version` is inside an affected interval. */
function evaluateRange(events: readonly RangeEvent[], version: string): RangeHit {
  const sorted = events
    .filter((event) => event.kind !== 'limit' && isComparable(event))
    .sort((x, y) => compareEventVersion(x.version, y.version));

  let start: string | null = null;
  for (const event of sorted) {
    if (event.kind === 'introduced') {
      start ??= event.version;
      continue;
    }
    if (start === null) continue;
    const inside = gte(version, start);
    if (event.kind === 'fixed') {
      if (inside && semver.lt(version, event.version)) {
        return { affected: true, fixedVersion: event.version };
      }
    } else if (inside && semver.lte(version, event.version)) {
      return { affected: true, fixedVersion: null };
    }
    start = null;
  }
  if (start !== null && gte(version, start)) return { affected: true, fixedVersion: null };
  return { affected: false, fixedVersion: null };
}

/**
 * The minimal version that fixes `advisory` for `packageName@installedVersion`:
 * the `fixed` event closing the SEMVER/ECOSYSTEM range that contains the
 * installed version. Null when no fix exists or the ranges cannot be evaluated.
 */
export function findFixedVersion(
  advisory: Advisory,
  packageName: string,
  installedVersion: string,
): string | null {
  if (semver.valid(installedVersion) === null) return null;
  for (const affected of advisory.affected) {
    if (affected.name !== packageName) continue;
    for (const range of affected.ranges) {
      if (range.type !== 'SEMVER' && range.type !== 'ECOSYSTEM') continue;
      const hit = evaluateRange(range.events, installedVersion);
      if (hit.affected) return hit.fixedVersion;
    }
  }
  return null;
}

/** Highest version in the list (semver order). */
export function maxVersion(versions: readonly string[]): string | null {
  const valid = versions.filter((v) => semver.valid(v) !== null);
  if (valid.length === 0) return null;
  return valid.reduce((best, v) => (semver.gt(v, best) ? v : best));
}
