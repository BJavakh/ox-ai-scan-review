/**
 * Domain types that are internal to the API (not part of the public contract).
 * Integrations convert external data (OSV, lockfiles) into these shapes.
 */

export interface Dependency {
  name: string;
  version: string;
  /** Listed in the root package.json (any dependency field). */
  direct: boolean;
  /** Only reachable through devDependencies. */
  dev: boolean;
  /** Direct dependencies that pull this package in (empty for direct deps). Max 3. */
  introducedBy: string[];
}

export type RangeEventKind = 'introduced' | 'fixed' | 'last_affected' | 'limit';

export interface RangeEvent {
  kind: RangeEventKind;
  version: string;
}

export interface AffectedPackage {
  name: string;
  ranges: { type: string; events: RangeEvent[] }[];
  versions: string[];
}

export interface Advisory {
  id: string;
  aliases: string[];
  summary: string;
  /** GHSA `database_specific.severity`, raw. */
  databaseSeverity: string | null;
  /** OSV `severity[]` entries, e.g. { type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/...' }. */
  severityVectors: { type: string; score: string }[];
  affected: AffectedPackage[];
  /** False when details could not be loaded; only the ID is known. */
  hydrated: boolean;
}

/** `name@version` -> advisory IDs reported by the vulnerability source. */
export type AdvisoryMatches = ReadonlyMap<string, readonly string[]>;

export function dependencyKey(name: string, version: string): string {
  return `${name}@${version}`;
}
