const HOUR_MS = 60 * 60 * 1000;

/**
 * Sliding one-hour window of new scans per client. Every new scan costs 3 to 5
 * GitHub API calls from one shared token (or the 60/hour unauthenticated
 * budget), so without this one client could exhaust it for everyone.
 * Production: the same check in Redis.
 */
export class ScanQuota {
  private readonly starts = new Map<string, number[]>();

  constructor(
    readonly perHour: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  allows(client: string): boolean {
    return this.recent(client).length < this.perHour;
  }

  record(client: string): void {
    this.starts.set(client, [...this.recent(client), this.now()]);
  }

  private recent(client: string): number[] {
    const cutoff = this.now() - HOUR_MS;
    const kept = (this.starts.get(client) ?? []).filter((t) => t > cutoff);
    if (kept.length === 0) this.starts.delete(client);
    else this.starts.set(client, kept);
    return kept;
  }
}
