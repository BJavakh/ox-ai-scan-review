import type { Advisory } from '../../domain/types.js';

/** What a hydration produced that is worth remembering. Failures are never cached. */
export type CachedHydration = { ok: true; advisory: Advisory } | { ok: false; withdrawn: true };

interface Entry {
  modified: string | null;
  value: CachedHydration;
  storedAt: number;
}

export const ADVISORY_CACHE_MAX_ENTRIES = 5_000;
/** Only used when OSV does not report `modified`; otherwise the version check decides. */
export const ADVISORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Process-wide cache of hydrated OSV advisories, shared by every scan. The same advisories
 * (lodash, minimist, qs, ...) appear across most npm projects, and hydration is the slowest
 * step of a scan. Entries are validated against the `modified` timestamp that querybatch
 * returns for every match, so an advisory OSV has changed is always fetched again.
 *
 * In-memory and bounded (least recently used is evicted first). With several API instances
 * this moves to Redis behind the same get/set shape.
 */
export class AdvisoryCache {
  private readonly entries = new Map<string, Entry>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly maxEntries = ADVISORY_CACHE_MAX_ENTRIES,
    private readonly ttlMs = ADVISORY_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  get(id: string, modified: string | null): CachedHydration | undefined {
    const entry = this.entries.get(id);
    const valid =
      entry !== undefined &&
      (modified !== null ? entry.modified === modified : this.now() - entry.storedAt < this.ttlMs);
    if (!valid) {
      this.misses += 1;
      return undefined;
    }
    // Map iteration order is insertion order: re-inserting marks it most recently used.
    this.entries.delete(id);
    this.entries.set(id, entry);
    this.hits += 1;
    // A copy, so no scan can change what another scan reads.
    return structuredClone(entry.value);
  }

  set(id: string, modified: string | null, value: CachedHydration): void {
    this.entries.delete(id);
    this.entries.set(id, { modified, value: structuredClone(value), storedAt: this.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  stats(): { size: number; hits: number; misses: number } {
    return { size: this.entries.size, hits: this.hits, misses: this.misses };
  }
}
