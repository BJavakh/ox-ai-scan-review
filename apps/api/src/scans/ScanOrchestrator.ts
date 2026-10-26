import type { FastifyBaseLogger } from 'fastify';
import type { Coverage, Report, ScanStatus, StepName } from '@ox-scan/shared';
import { analyze } from '../domain/analysis.js';
import { ScanFailure, toScanError } from '../domain/errors.js';
import { assertTransition, computeProgress } from '../domain/stateMachine.js';
import { buildSummaryInput } from '../domain/summary.js';
import {
  type DependencyResolver,
  UNSUPPORTED_MANIFESTS,
} from '../integrations/DependencyResolver.js';
import type { VulnerabilitySource } from '../integrations/VulnerabilitySource.js';
import type { GitHubClient } from '../integrations/github/GitHubClient.js';
import type { SummaryWriter } from '../integrations/llm/SummaryWriter.js';
import { buildReport } from './reportBuilder.js';
import type { ScanEvents } from './ScanEvents.js';
import type { ScanRepository, StoredScan } from './ScanRepository.js';

export interface OrchestratorDeps {
  repository: ScanRepository;
  events: ScanEvents;
  github: GitHubClient;
  resolver: DependencyResolver;
  vulnerabilities: VulnerabilitySource;
  summaries: SummaryWriter;
  logger: FastifyBaseLogger;
  scanTimeoutMs: number;
  /** Reuse a completed report for the same commit if it finished within this window. */
  resultCacheTtlMs?: number;
  now?: () => Date;
}

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

/** Drives one scan through the state machine, persisting and emitting every change. */
export class ScanOrchestrator {
  private readonly now: () => Date;
  /** Abort handles for scans in flight, so shutdown can stop them with a clear reason. */
  private readonly active = new Set<AbortController>();
  private closing = false;

  constructor(private readonly deps: OrchestratorDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async run(scanId: string): Promise<void> {
    const stored = await this.deps.repository.get(scanId);
    if (!stored) return;
    if (this.closing) {
      await this.fail(stored, new ScanFailure('SERVER_SHUTTING_DOWN'));
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new ScanFailure('SCAN_TIMEOUT'));
    }, this.deps.scanTimeoutMs);
    this.active.add(controller);
    const log = this.deps.logger.child({ scanId });

    try {
      await this.pipeline(stored, controller.signal);
      log.info(
        { status: stored.scan.status, ms: Date.now() - Date.parse(stored.scan.createdAt) },
        'scan finished',
      );
    } catch (error) {
      const failure =
        error instanceof ScanFailure
          ? error
          : // Aborts always carry a ScanFailure reason (timeout or shutdown).
            controller.signal.reason instanceof ScanFailure
            ? controller.signal.reason
            : new ScanFailure('INTERNAL_ERROR', 'unexpected', { cause: error });
      if (failure.code === 'INTERNAL_ERROR') log.error({ err: error }, 'scan crashed');
      else log.warn({ code: failure.code, detail: failure.message }, 'scan failed');
      await this.fail(stored, failure);
    } finally {
      clearTimeout(timer);
      this.active.delete(controller);
    }
  }

  /**
   * Graceful shutdown: running scans are aborted and queued ones fail on start, all with a
   * retryable code, so clients see a clear terminal state instead of a scan stuck forever.
   */
  shutdown(): number {
    this.closing = true;
    const count = this.active.size;
    for (const controller of this.active) {
      controller.abort(new ScanFailure('SERVER_SHUTTING_DOWN'));
    }
    return count;
  }

  private async pipeline(stored: StoredScan, signal: AbortSignal): Promise<void> {
    const { scan } = stored;
    const { owner, name } = scan.repo;
    const { github, resolver } = this.deps;

    // 1. Fetch repository: resolve the commit, then read only the manifests we need.
    await this.startStep(stored, 'fetching_repo');
    const ref = scan.ref ?? (await github.getDefaultBranch(owner, name, signal));
    const sha = await github.resolveCommit(owner, name, ref, signal);
    scan.commitSha = sha;

    const cached = await this.deps.repository.findCompletedByCommit(
      owner,
      name,
      sha,
      new Date(this.now().getTime() - (this.deps.resultCacheTtlMs ?? DEFAULT_CACHE_TTL_MS)),
    );
    if (cached?.report) {
      await this.finishStep(stored, 'fetching_repo', `Commit ${sha.slice(0, 7)} on ${ref}`);
      await this.completeFromCache(stored, cached);
      return;
    }

    const rootFiles = await github.listRootFiles(owner, name, sha, signal);
    const manifests = resolver.manifestsToFetch(rootFiles);
    if (manifests.length === 0) throw new ScanFailure('NO_SUPPORTED_MANIFEST');
    const files = new Map<string, string>();
    for (const manifest of manifests)
      files.set(manifest, await github.getFile(owner, name, sha, manifest, signal));
    const unsupported = UNSUPPORTED_MANIFESTS.filter((f) => rootFiles.includes(f));
    await this.finishStep(
      stored,
      'fetching_repo',
      `Commit ${sha.slice(0, 7)} on ${ref}, ${manifests.join(' + ')}`,
    );

    // 2. Resolve dependencies (pure parsing, no code execution).
    await this.startStep(stored, 'resolving_dependencies');
    const resolved = resolver.resolve(files);
    const coverage: Coverage = {
      ...resolved.coverage,
      ecosystem: resolver.ecosystem,
      unsupportedManifests: unsupported,
      scannedPath: '/',
    };
    await this.finishStep(
      stored,
      'resolving_dependencies',
      `${String(coverage.packagesChecked)} packages (${String(coverage.directDependencies)} direct)`,
    );

    // 3. Check known vulnerabilities.
    await this.startStep(stored, 'checking_vulnerabilities');
    const lookup = await this.deps.vulnerabilities.lookup(resolved.dependencies, signal);
    const advisoryCount = new Set([...lookup.matches.values()].flat()).size;
    await this.finishStep(
      stored,
      'checking_vulnerabilities',
      `${String(advisoryCount)} advisories affect ${String(lookup.matches.size)} packages`,
    );

    // 4. Prioritize deterministically.
    await this.startStep(stored, 'prioritizing');
    const analysis = analyze(resolved.dependencies, lookup.matches, lookup.advisories);
    await this.finishStep(
      stored,
      'prioritizing',
      `${String(analysis.actions.length)} actions, risk: ${analysis.riskLevel}`,
    );

    // 5. Write the summary (AI or template; never fails the scan for LLM reasons).
    await this.startStep(stored, 'generating_summary');
    const summaryInput = buildSummaryInput(`${owner}/${name}`, sha, coverage, analysis);
    const summary = await this.deps.summaries.write(summaryInput, signal);
    await this.finishStep(
      stored,
      'generating_summary',
      summary.mode === 'ai' ? 'Written by AI; IDs and versions checked' : 'Template summary',
    );

    const notes = [...resolved.notes, ...lookup.notes];
    const report = buildReport(
      scan,
      sha,
      coverage,
      analysis,
      summaryInput,
      summary,
      notes,
      this.now().toISOString(),
    );
    await this.complete(stored, report);
  }

  private async completeFromCache(stored: StoredScan, cached: StoredScan): Promise<void> {
    if (!cached.report) return;
    for (const step of stored.scan.steps) {
      if (step.status === 'pending' && step.name !== 'completed') {
        step.status = 'skipped';
        step.detail = 'Reused the result of a recent scan of the same commit';
        this.emitStep(stored, step.name);
      }
    }
    await this.complete(stored, {
      ...cached.report,
      scanId: stored.scan.id,
      ref: stored.scan.ref,
      reusedFromScanId: cached.scan.id,
    });
  }

  private step(stored: StoredScan, name: StepName) {
    const step = stored.scan.steps.find((s) => s.name === name);
    if (!step) throw new Error(`missing step ${name}`);
    return step;
  }

  private setStatus(stored: StoredScan, to: ScanStatus): void {
    assertTransition(stored.scan.status, to);
    stored.scan.status = to;
  }

  private async persist(stored: StoredScan): Promise<void> {
    stored.scan.progress = computeProgress(stored.scan.status, stored.scan.steps);
    stored.scan.updatedAt = this.now().toISOString();
    await this.deps.repository.save(stored);
    this.deps.events.emit(stored.scan.id, {
      event: 'progress',
      data: { status: stored.scan.status, progress: stored.scan.progress },
    });
  }

  private emitStep(stored: StoredScan, name: StepName): void {
    this.deps.events.emit(stored.scan.id, { event: 'step', data: { ...this.step(stored, name) } });
  }

  private async startStep(stored: StoredScan, name: Exclude<StepName, 'completed'>): Promise<void> {
    this.setStatus(stored, name);
    const step = this.step(stored, name);
    step.status = 'running';
    step.startedAt = this.now().toISOString();
    this.emitStep(stored, name);
    await this.persist(stored);
  }

  private async finishStep(stored: StoredScan, name: StepName, detail: string): Promise<void> {
    const step = this.step(stored, name);
    step.status = 'completed';
    step.detail = detail;
    step.finishedAt = this.now().toISOString();
    this.emitStep(stored, name);
    await this.persist(stored);
  }

  private async complete(stored: StoredScan, report: Report): Promise<void> {
    this.setStatus(stored, 'completed');
    const at = this.now().toISOString();
    const done = this.step(stored, 'completed');
    Object.assign(done, { status: 'completed', startedAt: at, finishedAt: at, detail: null });
    stored.scan.finishedAt = at;
    stored.report = report;
    this.emitStep(stored, 'completed');
    await this.persist(stored);
    this.deps.events.emit(stored.scan.id, { event: 'completed', data: { scanId: stored.scan.id } });
  }

  private async fail(stored: StoredScan, failure: ScanFailure): Promise<void> {
    if (stored.scan.status === 'completed' || stored.scan.status === 'failed') return;
    const running = stored.scan.steps.find((s) => s.status === 'running');
    if (running) {
      running.status = 'failed';
      running.finishedAt = this.now().toISOString();
      this.emitStep(stored, running.name);
    }
    this.setStatus(stored, 'failed');
    stored.scan.error = toScanError(failure.code);
    stored.scan.finishedAt = this.now().toISOString();
    await this.persist(stored);
    this.deps.events.emit(stored.scan.id, {
      event: 'failed',
      data: { scanId: stored.scan.id, error: stored.scan.error },
    });
  }
}
