import type { RiskLevel, Scan, ScanStep, Severity } from '@ox-scan/shared';

export function shortSha(sha: string | null): string {
  return sha === null ? 'unknown' : sha.slice(0, 7);
}

/** "4s", "1m 05s" */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes === 0
    ? `${String(seconds)}s`
    : `${String(minutes)}m ${String(seconds).padStart(2, '0')}s`;
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;
}

export const RISK_LABELS: Record<RiskLevel, string> = {
  critical: 'Critical risk',
  high: 'High risk',
  medium: 'Medium risk',
  low: 'Low risk',
  none: 'No known risk',
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MODERATE: 'Moderate',
  LOW: 'Low',
  UNKNOWN: 'Unknown',
};

/** The URL that recreates this scan (used by "Try again"). */
export function scanRepoUrl(scan: Pick<Scan, 'repo' | 'ref'>): string {
  return scan.ref === null ? scan.repo.url : `${scan.repo.url}/tree/${scan.ref}`;
}

/** Accept "github.com/o/r" and "o/r" shorthands by turning them into full URLs. */
export function normalizeRepoInput(input: string): string {
  const trimmed = input.trim();
  if (/^(www\.)?github\.com\//i.test(trimmed)) return `https://${trimmed}`;
  if (/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(trimmed)) return `https://github.com/${trimmed}`;
  return trimmed;
}

/** Merge a step event into a scan snapshot. */
export function applyStep(scan: Scan, step: ScanStep): Scan {
  return { ...scan, steps: scan.steps.map((s) => (s.name === step.name ? step : s)) };
}
