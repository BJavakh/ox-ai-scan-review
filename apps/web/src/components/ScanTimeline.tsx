import type { ScanStep, StepStatus } from '@ox-scan/shared';
import { formatDuration } from '../lib/format';

const STATUS_TEXT: Record<StepStatus, string> = {
  pending: 'Waiting',
  running: 'Running',
  completed: 'Done',
  skipped: 'Skipped',
  failed: 'Failed',
};

const MIN_SPAN_MS = 8_000;

interface Props {
  steps: ScanStep[];
  startedAt: string;
  finishedAt: string | null;
  now: number;
}

/**
 * The scan as a schedule: one row per pipeline step, bars sized by real
 * step timings, and a "now" marker that moves while the scan runs.
 */
export function ScanTimeline({ steps, startedAt, finishedAt, now }: Props) {
  const start = Date.parse(startedAt);
  const end = finishedAt === null ? now : Date.parse(finishedAt);
  const elapsed = Math.max(0, end - start);
  // While running, leave headroom so the marker travels instead of sitting at the edge.
  const span = Math.max(MIN_SPAN_MS, finishedAt === null ? elapsed * 1.35 : elapsed);
  const pct = (ms: number) => `${String(Math.min(100, Math.max(0, (ms / span) * 100)))}%`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * span);
  const visibleSteps = steps.filter((s) => s.name !== 'completed');

  return (
    <div className="timeline" role="group" aria-label="Scan steps">
      <div className="tl-head" aria-hidden="true">
        <span className="tl-col-label">Step</span>
        <div className="tl-scale">
          {ticks.map((t) => (
            <span key={t} className="tl-tick" style={{ left: pct(t) }}>
              {formatDuration(t)}
            </span>
          ))}
        </div>
      </div>
      <ol className="tl-rows">
        {visibleSteps.map((step) => {
          const s = step.startedAt === null ? null : Date.parse(step.startedAt) - start;
          const e =
            step.finishedAt === null
              ? step.status === 'running'
                ? elapsed
                : null
              : Date.parse(step.finishedAt) - start;
          const hasBar = s !== null && e !== null;
          return (
            <li
              key={step.name}
              className={`tl-row is-${step.status}`}
              aria-current={step.status === 'running' ? 'step' : undefined}
            >
              <div className="tl-label">
                <span className="tl-dot" aria-hidden="true" />
                <span className="tl-name">{step.label}</span>
                <span className="visually-hidden">: {STATUS_TEXT[step.status]}</span>
                <span className="tl-detail">{step.detail ?? STATUS_TEXT[step.status]}</span>
              </div>
              <div className="tl-track" aria-hidden="true">
                {hasBar && (
                  <span
                    className="tl-bar"
                    style={{ left: pct(s), width: `max(6px, ${pct(Math.max(0, e - s))})` }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {finishedAt === null && (
        <span
          className="tl-now"
          style={{
            left: `calc(var(--tl-label-w) + (100% - var(--tl-label-w)) * ${String(Math.min(1, elapsed / span))})`,
          }}
          aria-hidden="true"
        >
          <span className="tl-now-cap">now</span>
        </span>
      )}
    </div>
  );
}
