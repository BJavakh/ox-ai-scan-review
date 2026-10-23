import {
  STEP_LABELS,
  STEP_ORDER,
  type ScanStatus,
  type ScanStep,
  type StepName,
} from '@ox-scan/shared';

/** Allowed transitions. Anything not listed is a programming error. See docs/ARCHITECTURE.md. */
export const TRANSITIONS: Readonly<Record<ScanStatus, readonly ScanStatus[]>> = {
  queued: ['fetching_repo', 'failed'],
  fetching_repo: ['resolving_dependencies', 'completed', 'failed'],
  resolving_dependencies: ['checking_vulnerabilities', 'failed'],
  checking_vulnerabilities: ['prioritizing', 'failed'],
  prioritizing: ['generating_summary', 'failed'],
  generating_summary: ['completed', 'failed'],
  completed: [],
  failed: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: ScanStatus, to: ScanStatus) {
    super(`Invalid scan transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: ScanStatus, to: ScanStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ScanStatus, to: ScanStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function createInitialSteps(): ScanStep[] {
  return STEP_ORDER.map((name) => ({
    name,
    label: STEP_LABELS[name],
    status: 'pending',
    detail: null,
    startedAt: null,
    finishedAt: null,
  }));
}

/** Percentage of finished (completed or skipped) steps. A completed scan is always 100. */
export function computeProgress(status: ScanStatus, steps: readonly ScanStep[]): number {
  if (status === 'completed') return 100;
  const finished = steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
  return Math.round((100 * finished) / STEP_ORDER.length);
}

export function isStepName(status: ScanStatus): status is StepName {
  return (STEP_ORDER as readonly string[]).includes(status);
}
