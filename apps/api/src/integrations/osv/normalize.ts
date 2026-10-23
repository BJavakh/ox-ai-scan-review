import type { Advisory, RangeEvent } from '../../domain/types.js';
import type { OsvVulnerability } from './osvSchemas.js';

function toEvents(events: NonNullable<OsvVulnerability['affected']>[number]['ranges']): {
  type: string;
  events: RangeEvent[];
}[] {
  return (events ?? []).map((range) => ({
    type: range.type,
    events: range.events.flatMap((event): RangeEvent[] => {
      if (event.introduced !== undefined)
        return [{ kind: 'introduced', version: event.introduced }];
      if (event.fixed !== undefined) return [{ kind: 'fixed', version: event.fixed }];
      if (event.last_affected !== undefined)
        return [{ kind: 'last_affected', version: event.last_affected }];
      if (event.limit !== undefined) return [{ kind: 'limit', version: event.limit }];
      return [];
    }),
  }));
}

/** Convert an OSV record to our ecosystem-agnostic Advisory (npm entries only). */
export function normalizeOsvVulnerability(vuln: OsvVulnerability): Advisory {
  const severity = vuln.database_specific?.severity;
  return {
    id: vuln.id,
    aliases: (vuln.aliases ?? []).filter((alias) => alias.length <= 100).slice(0, 10),
    summary: vuln.summary ?? '',
    databaseSeverity: typeof severity === 'string' ? severity : null,
    severityVectors: vuln.severity ?? [],
    affected: (vuln.affected ?? [])
      .filter((a) => a.package?.ecosystem === 'npm')
      .map((a) => ({
        name: a.package?.name ?? '',
        ranges: toEvents(a.ranges),
        versions: a.versions ?? [],
      })),
    hydrated: true,
  };
}
