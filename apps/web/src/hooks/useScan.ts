import { useEffect, useState } from 'react';
import { type Scan, isTerminalStatus, scanEventSchemas } from '@ox-scan/shared';
import { ApiRequestError, api, eventsUrl } from '../api/client';
import { applyStep } from '../lib/format';

export type Transport = 'live' | 'polling';

export interface ScanState {
  scan: Scan | null;
  error: ApiRequestError | null;
  transport: Transport;
}

const POLL_MS = 1500;
const MAX_POLL_RETRIES = 5;

function eventData(event: Event): unknown {
  return JSON.parse((event as MessageEvent<string>).data);
}

/**
 * Follows a scan: Server-Sent Events first, polling as the fallback when the
 * stream errors (proxies that buffer SSE, dropped connections). Mount with
 * `key={id}` so state resets when the scan changes.
 */
export function useScan(id: string): ScanState {
  const [state, setState] = useState<ScanState>({ scan: null, error: null, transport: 'live' });

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const update = (patch: Partial<ScanState>) => {
      if (!disposed) setState((prev) => ({ ...prev, ...patch }));
    };
    const updateScan = (fn: (scan: Scan) => Scan) => {
      if (!disposed) setState((prev) => (prev.scan ? { ...prev, scan: fn(prev.scan) } : prev));
    };

    let failures = 0;
    const poll = async () => {
      try {
        const scan = await api.getScan(id);
        failures = 0;
        update({ scan, error: null });
        if (!isTerminalStatus(scan.status) && !disposed)
          timer = setTimeout(() => void poll(), POLL_MS);
      } catch (error) {
        const apiError =
          error instanceof ApiRequestError
            ? error
            : new ApiRequestError(0, 'UNKNOWN', 'Unexpected error.');
        update({ error: apiError });
        // A blip (network, API restart) must not freeze the page: retry with backoff, except for 404.
        failures += 1;
        if (apiError.status !== 404 && failures <= MAX_POLL_RETRIES && !disposed) {
          timer = setTimeout(() => void poll(), POLL_MS * 2 ** failures);
        }
      }
    };

    const finish = () => {
      source?.close();
      source = null;
      void poll(); // fetch the final, authoritative state once
    };

    source = new EventSource(eventsUrl(id));
    source.addEventListener('snapshot', (e) => {
      update({ scan: scanEventSchemas.snapshot.parse(eventData(e)), error: null });
    });
    source.addEventListener('step', (e) => {
      const step = scanEventSchemas.step.parse(eventData(e));
      updateScan((scan) => applyStep(scan, step));
      // Step events do not carry the commit SHA; fetch it once the repository step is done.
      if (step.name === 'fetching_repo' && step.status === 'completed') {
        api.getScan(id).then(
          (scan) => {
            updateScan((current) => ({ ...current, commitSha: scan.commitSha }));
          },
          () => undefined,
        );
      }
    });
    source.addEventListener('progress', (e) => {
      const { status, progress } = scanEventSchemas.progress.parse(eventData(e));
      updateScan((scan) => ({ ...scan, status, progress }));
    });
    source.addEventListener('completed', finish);
    source.addEventListener('failed', finish);
    source.onerror = () => {
      if (source === null) return;
      source.close();
      source = null;
      update({ transport: 'polling' });
      void poll();
    };

    return () => {
      disposed = true;
      source?.close();
      clearTimeout(timer);
    };
  }, [id]);

  return state;
}
