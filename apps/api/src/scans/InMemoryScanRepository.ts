import { type RiskLevel, type Scan, isTerminalStatus } from '@ox-scan/shared';
import type { ScanRepository, StoredScan } from './ScanRepository.js';

export const MAX_STORED_SCANS = 200;
/** Bounded so one popular deduplicated scan cannot grow without limit. */
export const MAX_REQUESTERS_PER_SCAN = 1_000;

export class InMemoryScanRepository implements ScanRepository {
  private readonly scans = new Map<string, StoredScan>();
  private readonly requesters = new Map<string, Set<string>>();

  constructor(private readonly capacity = MAX_STORED_SCANS) {}

  createIfNoActive(
    candidate: StoredScan,
    canCreate: () => boolean = () => true,
  ): Promise<{ stored: StoredScan | null; created: boolean }> {
    // Synchronous check-and-insert: no await between them, so no interleaving.
    for (const stored of this.scans.values()) {
      if (stored.dedupeKey === candidate.dedupeKey && !isTerminalStatus(stored.scan.status)) {
        return Promise.resolve({ stored: structuredClone(stored), created: false });
      }
    }
    if (!canCreate()) return Promise.resolve({ stored: null, created: false });
    this.scans.set(candidate.scan.id, structuredClone(candidate));
    this.evict();
    return Promise.resolve({ stored: structuredClone(candidate), created: true });
  }

  get(id: string): Promise<StoredScan | undefined> {
    const stored = this.scans.get(id);
    return Promise.resolve(stored ? structuredClone(stored) : undefined);
  }

  save(stored: StoredScan): Promise<void> {
    if (this.scans.has(stored.scan.id)) this.scans.set(stored.scan.id, structuredClone(stored));
    return Promise.resolve();
  }

  findCompletedByCommit(
    owner: string,
    repo: string,
    sha: string,
    since: Date,
  ): Promise<StoredScan | undefined> {
    const matches = [...this.scans.values()].filter(
      (s) =>
        s.scan.status === 'completed' &&
        s.report !== null &&
        s.report.reusedFromScanId === null &&
        s.scan.commitSha === sha &&
        s.scan.repo.owner.toLowerCase() === owner.toLowerCase() &&
        s.scan.repo.name.toLowerCase() === repo.toLowerCase() &&
        s.scan.finishedAt !== null &&
        new Date(s.scan.finishedAt) >= since,
    );
    const latest = matches.at(-1);
    return Promise.resolve(latest ? structuredClone(latest) : undefined);
  }

  addRequester(scanId: string, client: string): Promise<void> {
    if (!this.scans.has(scanId)) return Promise.resolve();
    const set = this.requesters.get(scanId) ?? new Set<string>();
    if (set.size < MAX_REQUESTERS_PER_SCAN) set.add(client);
    this.requesters.set(scanId, set);
    return Promise.resolve();
  }

  listRecent(
    limit: number,
    client: string,
  ): Promise<{ scan: Scan; riskLevel: RiskLevel | null }[]> {
    return Promise.resolve(
      [...this.scans.values()]
        .filter((s) => this.requesters.get(s.scan.id)?.has(client) === true)
        .slice(-limit)
        .reverse()
        .map((s) => ({ scan: structuredClone(s.scan), riskLevel: s.report?.riskLevel ?? null })),
    );
  }

  /** Drop the oldest terminal scans beyond capacity; never drops running scans. */
  private evict(): void {
    for (const [id, stored] of this.scans) {
      if (this.scans.size <= this.capacity) return;
      if (isTerminalStatus(stored.scan.status)) {
        this.scans.delete(id);
        this.requesters.delete(id);
      }
    }
  }
}
