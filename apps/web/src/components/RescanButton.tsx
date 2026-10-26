import { useState } from 'react';
import type { Scan } from '@ox-scan/shared';
import { ApiRequestError, api } from '../api/client';
import { navigate } from '../hooks/useHashRoute';
import { scanRepoUrl } from '../lib/format';

/** Starts a new scan of the same repository and ref, then opens it. */
export function RescanButton({
  scan,
  label = 'Scan again',
  className = 'btn btn-ink',
}: {
  scan: Pick<Scan, 'repo' | 'ref'>;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rescan = async () => {
    setBusy(true);
    setError(null);
    try {
      const { scanId } = await api.createScan(scanRepoUrl(scan));
      navigate({ name: 'scan', id: scanId });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Could not start the scan.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={() => void rescan()}>
        {busy ? 'Starting' : label} <span aria-hidden="true">→</span>
      </button>
      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
