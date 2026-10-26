import type { Report, RiskLevel, Scan } from '@ox-scan/shared';

export interface StoredScan {
  scan: Scan;
  report: Report | null;
  /** `owner/repo#ref`, lower-cased owner and repo. */
  dedupeKey: string;
}

/**
 * Persistence boundary. Async so a Postgres implementation is a drop-in
 * (see docs/ARCHITECTURE.md section 10). Returned objects are copies.
 */
export interface ScanRepository {
  /**
   * Atomically return the active scan for `dedupeKey`, or store `candidate` if
   * `canCreate()` allows it. `stored` is null when creation was refused.
   */
  createIfNoActive(
    candidate: StoredScan,
    canCreate?: () => boolean,
  ): Promise<{ stored: StoredScan | null; created: boolean }>;
  get(id: string): Promise<StoredScan | undefined>;
  save(stored: StoredScan): Promise<void>;
  findCompletedByCommit(
    owner: string,
    repo: string,
    sha: string,
    since: Date,
  ): Promise<StoredScan | undefined>;
  /** Newest first, without reports (list views must not copy whole reports). */
  listRecent(limit: number): Promise<{ scan: Scan; riskLevel: RiskLevel | null }[]>;
}

export function dedupeKey(owner: string, repo: string, ref: string | null): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}#${ref ?? 'HEAD'}`;
}
