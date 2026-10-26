import { useEffect, useState } from 'react';
import type { Scan } from '@ox-scan/shared';
import { api } from '../api/client';
import { DotPill } from '../components/Badges';
import { Band, Panel } from '../components/Layout';
import { RescanButton } from '../components/RescanButton';
import { ScanTimeline } from '../components/ScanTimeline';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useScan } from '../hooks/useScan';
import { formatDuration, shortSha } from '../lib/format';
import { ReportView } from './ReportView';

/** Wall clock for a running scan; stops ticking once it finishes. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, [running]);
  return now;
}

function Report({ scan }: { scan: Scan }) {
  const report = useAsync(() => api.getReport(scan.id), scan.id);
  if (report.status === 'loading') return <Notice title="Loading report" />;
  if (report.status === 'error')
    return <Notice title="The report could not be loaded" message={report.error.message} />;
  return <ReportView report={report.data} scan={scan} />;
}

function Notice({
  title,
  message,
  children,
}: {
  title: string;
  message?: string;
  children?: React.ReactNode;
}) {
  return (
    <Band tone="paper" labelledBy="notice-title" className="hero">
      <p className="micro">Scan</p>
      <h1 id="notice-title" className="display display-sm">
        {title}
      </h1>
      {message !== undefined && <p className="hero-lead">{message}</p>}
      <div className="btn-row">
        {children}
        <a className="btn" href="#/">
          Scan another repository <span aria-hidden="true">→</span>
        </a>
      </div>
    </Band>
  );
}

export function ScanScreen({ id }: { id: string }) {
  const { scan, error, transport } = useScan(id);
  const now = useNow(scan !== null && scan.finishedAt === null);
  useDocumentTitle(
    scan === null
      ? null
      : scan.status === 'completed'
        ? undefined
        : `${scan.status === 'failed' ? 'Failed' : `${String(scan.progress)}%`} · ${scan.repo.owner}/${scan.repo.name}`,
  );

  if (error && !scan) {
    return error.status === 404 ? (
      <Notice
        title="Scan not found"
        message="This scan does not exist, or the server restarted. Scans are kept in memory, so start a new one."
      />
    ) : (
      <Notice title="Could not load the scan" message={error.message} />
    );
  }
  if (!scan) return <Notice title="Connecting" />;
  if (scan.status === 'completed') return <Report scan={scan} />;

  const failed = scan.status === 'failed';
  const running = scan.steps.find((s) => s.status === 'running');
  const elapsed =
    (scan.finishedAt === null ? now : Date.parse(scan.finishedAt)) - Date.parse(scan.createdAt);

  return (
    <>
      <Band tone="paper" labelledBy="scan-title" className="hero">
        <p className="micro">{failed ? 'Scan stopped' : 'Scanning'}</p>
        <h1 id="scan-title" className="display display-repo">
          <a href={scan.repo.url} target="_blank" rel="noopener noreferrer">
            {scan.repo.owner}/{scan.repo.name}
            <span className="visually-hidden"> (opens GitHub in a new tab)</span>
          </a>
        </h1>
        <dl className="facts">
          <div>
            <dt>Status</dt>
            <dd>
              {failed ? (
                <DotPill tone="critical">Failed</DotPill>
              ) : (
                <DotPill tone="live">{running?.label ?? 'Queued'}</DotPill>
              )}
            </dd>
          </div>
          <div>
            <dt>Elapsed</dt>
            <dd className="mono">{formatDuration(elapsed)}</dd>
          </div>
          <div>
            <dt>Commit</dt>
            <dd className="mono">
              {scan.commitSha === null ? 'resolving' : shortSha(scan.commitSha)}
            </dd>
          </div>
          <div>
            <dt>Ref</dt>
            <dd className="mono">{scan.ref ?? 'default branch'}</dd>
          </div>
        </dl>
        {error !== null && !failed && (
          <p className="form-error" role="status">
            Lost the connection to the server. Retrying…
          </p>
        )}
        {!failed && (
          <p className="hero-lead">
            We are reading the repository and checking each package against known advisories. You
            can leave this page: the scan keeps running and will be under Recent scans on the start
            page.
          </p>
        )}
        <p className="visually-hidden" aria-live="polite">
          {failed ? 'Scan failed.' : running ? `${running.label}.` : 'Waiting for a free scanner.'}
        </p>
      </Band>

      <Band tone="white" labelledBy="timeline-title">
        <h2 id="timeline-title" className="visually-hidden">
          Progress
        </h2>
        <Panel
          toolbar={
            <>
              <span className="toolbar-title">Pipeline</span>
              <span className="toolbar-meta">
                {failed
                  ? 'Stopped'
                  : `${String(scan.progress)}% · usually under 20 s · ${transport === 'live' ? 'live' : 'refreshing'}`}
              </span>
            </>
          }
        >
          <div
            className="progress-line"
            role="progressbar"
            aria-label="Scan progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={scan.progress}
          >
            <span
              className={failed ? 'is-failed' : ''}
              style={{ width: `${String(scan.progress)}%` }}
            />
          </div>
          <ScanTimeline
            steps={scan.steps}
            startedAt={scan.createdAt}
            finishedAt={scan.finishedAt}
            now={now}
          />
        </Panel>

        {failed && scan.error !== null && (
          <div className="failure" role="alert">
            <p className="micro">What went wrong · {scan.error.code}</p>
            <p className="failure-message">{scan.error.message}</p>
            <div className="btn-row">
              {scan.error.retryable && <RescanButton scan={scan} />}
              <a className="btn" href="#/">
                Scan another repository <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        )}
      </Band>
    </>
  );
}
