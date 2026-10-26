import type { ReactNode } from 'react';
import type { RiskLevel, Severity } from '@ox-scan/shared';
import { RISK_LABELS, SEVERITY_LABELS } from '../lib/format';

type Tone = 'critical' | 'high' | 'moderate' | 'low' | 'unknown' | 'none' | 'neutral' | 'live';

/** Soft pill with a status dot. */
export function DotPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`dot-pill tone-${tone}`}>
      <span className="dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function SeverityPill({ severity }: { severity: Severity }) {
  return <DotPill tone={severity.toLowerCase() as Tone}>{SEVERITY_LABELS[severity]}</DotPill>;
}

const RISK_TONE: Record<RiskLevel, Tone> = {
  critical: 'critical',
  high: 'high',
  medium: 'moderate',
  low: 'low',
  none: 'none',
};

/** `estimated`: no lockfile, so versions were inferred from package.json ranges. */
export function RiskPill({ level, estimated = false }: { level: RiskLevel; estimated?: boolean }) {
  return (
    <DotPill tone={RISK_TONE[level]}>
      {RISK_LABELS[level]}
      {estimated && ' · estimated'}
    </DotPill>
  );
}

export function Meta({ children }: { children: ReactNode }) {
  return <span className="meta">{children}</span>;
}

export function dependencyLabel(direct: boolean, dev: boolean, introducedBy: string[]): string {
  const scope = dev ? 'Development' : 'Production';
  if (direct) return `${scope} · Direct`;
  return introducedBy.length > 0
    ? `${scope} · via ${introducedBy.join(', ')}`
    : `${scope} · Transitive`;
}
