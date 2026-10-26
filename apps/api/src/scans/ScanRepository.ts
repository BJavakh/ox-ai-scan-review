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
  /**
   * Remember that `client` asked for this scan (a new submit or a deduplicated one). Kept apart
   * from StoredScan so the orchestrator's saves cannot overwrite it. Postgres: a join table.
   */
  addRequester(scanId: string, client: string): Promise<void>;
  /**
   * The scans `client` asked for, newest first, without reports (list views must not copy whole
   * reports). Per client so a shared server never shows one visitor what another scanned.
   */
  listRecent(limit: number, client: string): Promise<{ scan: Scan; riskLevel: RiskLevel | null }[]>;
}

export function dedupeKey(owner: string, repo: string, ref: string | null): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}#${ref ?? 'HEAD'}`;
}
