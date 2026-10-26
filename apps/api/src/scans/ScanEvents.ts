import type { ScanEvent } from '@ox-scan/shared';

export type ScanEventListener = (event: ScanEvent) => void;

/** Per-scan pub/sub for progress events. Production: Redis pub/sub. */
export class ScanEvents {
  private readonly listeners = new Map<string, Set<ScanEventListener>>();

  subscribe(scanId: string, listener: ScanEventListener): () => void {
    const set = this.listeners.get(scanId) ?? new Set();
    set.add(listener);
    this.listeners.set(scanId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(scanId);
    };
  }

  emit(scanId: string, event: ScanEvent): void {
    for (const listener of [...(this.listeners.get(scanId) ?? [])]) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must not break the scan.
      }
    }
  }

  listenerCount(scanId: string): number {
    return this.listeners.get(scanId)?.size ?? 0;
  }
}
