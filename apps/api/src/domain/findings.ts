import type { Finding } from '@ox-scan/shared';
import { scoreFinding, severityRank } from './scoring.js';
import { deriveSeverity } from './severity.js';
import { type Advisory, type AdvisoryMatches, type Dependency, dependencyKey } from './types.js';
import { findFixedVersion } from './versions.js';

export const MAX_SUMMARY_LENGTH = 300;
const ADVISORY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 3).trimEnd()}...`;
}

export function advisoryUrl(id: string): string {
  return `https://osv.dev/vulnerability/${encodeURIComponent(id)}`;
}

function placeholderAdvisory(id: string): Advisory {
  return {
    id,
    aliases: [],
    summary: '',
    databaseSeverity: null,
    severityVectors: [],
    affected: [],
    hydrated: false,
  };
}

export function compareFindings(a: Finding, b: Finding): number {
  return (
    b.score - a.score ||
    severityRank(a.severity) - severityRank(b.severity) ||
    a.packageName.localeCompare(b.packageName) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Join resolved dependencies with advisory matches into scored findings.
 * One finding per (package@version, advisory). The vulnerability source is the
 * authority on *whether* a version is affected; we only derive severity and fix.
 */
export function buildFindings(
  dependencies: readonly Dependency[],
  matches: AdvisoryMatches,
  advisories: ReadonlyMap<string, Advisory>,
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const dep of dependencies) {
    const ids = matches.get(dependencyKey(dep.name, dep.version)) ?? [];
    for (const id of ids) {
      if (!ADVISORY_ID_PATTERN.test(id)) continue;
      const key = `${dep.name}@${dep.version}#${id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const advisory = advisories.get(id) ?? placeholderAdvisory(id);
      const { severity, source, cvssScore } = deriveSeverity(advisory);
      const fixedVersion = findFixedVersion(advisory, dep.name, dep.version);
      const summary = advisory.hydrated
        ? truncate(advisory.summary || id, MAX_SUMMARY_LENGTH)
        : `${id} (details could not be loaded)`;

      findings.push({
        id,
        aliases: advisory.aliases.slice(0, 5),
        packageName: dep.name,
        installedVersion: dep.version,
        severity,
        severitySource: source,
        cvssScore,
        summary,
        fixedVersion,
        direct: dep.direct,
        dev: dep.dev,
        introducedBy: dep.introducedBy,
        score: scoreFinding({
          severity,
          dev: dep.dev,
          direct: dep.direct,
          fixAvailable: fixedVersion !== null,
        }),
        advisoryUrl: advisoryUrl(id),
      });
    }
  }
  return findings.sort(compareFindings);
}
