import { randomUUID } from 'node:crypto';
import { type Report, type Scan, type ScanListItem, parseGitHubRepoUrl } from '@ox-scan/shared';
import { createInitialSteps } from '../domain/stateMachine.js';
import { AppError, notFound } from '../http/errors.js';
import type { JobQueue } from './JobQueue.js';
import { ScanQuota } from './ScanQuota.js';
import type { ScanOrchestrator } from './ScanOrchestrator.js';
import { type ScanRepository, dedupeKey } from './ScanRepository.js';

export const RECENT_SCANS_LIMIT = 20;

/** Application service behind the HTTP routes. */
export class ScanService {
  constructor(
    private readonly repository: ScanRepository,
    private readonly queue: JobQueue,
    private readonly orchestrator: ScanOrchestrator,
    private readonly now: () => Date = () => new Date(),
    private readonly quota: ScanQuota = new ScanQuota(Number.POSITIVE_INFINITY),
  ) {}

  /** `client` is the rate-limit key of the caller (IPv4 address or IPv6 /64). */
  async submit(repoUrl: string, client = 'local'): Promise<{ scan: Scan; deduplicated: boolean }> {
    const parsed = parseGitHubRepoUrl(repoUrl);
    if (!parsed.ok)
      throw new AppError(400, 'INVALID_REPO_URL', parsed.message, { reason: parsed.reason });
    const { owner, repo, ref } = parsed.value;

    const at = this.now().toISOString();
    const candidate: Scan = {
      id: randomUUID(),
      repo: { owner, name: repo, url: `https://github.com/${owner}/${repo}` },
      ref,
      commitSha: null,
      status: 'queued',
      progress: 0,
      steps: createInitialSteps(),
      error: null,
      createdAt: at,
      updatedAt: at,
      finishedAt: null,
    };
    // Quota and capacity only matter when a new scan would be queued; a duplicate submit is always answered.
    // An object, not a `let`: it is set inside the callback below.
    const decision: { refusal: AppError | null } = { refusal: null };
    const { stored, created } = await this.repository.createIfNoActive(
      { scan: candidate, report: null, dedupeKey: dedupeKey(owner, repo, ref) },
      () => {
        if (!this.quota.allows(client)) {
          decision.refusal = new AppError(
            429,
            'RATE_LIMITED',
            `You can start ${String(this.quota.perHour)} new scans per hour. Open a recent scan, or try again later.`,
          );
          return false;
        }
        if (!this.queue.hasCapacity()) {
          decision.refusal = new AppError(
            503,
            'SERVICE_BUSY',
            'The scanner is busy. Try again in a minute.',
          );
          return false;
        }
        return true;
      },
    );
    if (stored === null) {
      throw (
        decision.refusal ??
        new AppError(503, 'SERVICE_BUSY', 'The scanner is busy. Try again in a minute.')
      );
    }
    await this.repository.addRequester(stored.scan.id, client);
    if (created) this.quota.record(client);
    if (created) this.queue.enqueue(() => this.orchestrator.run(stored.scan.id));
    return { scan: stored.scan, deduplicated: !created };
  }

  async get(id: string): Promise<Scan> {
    const stored = await this.repository.get(id);
    if (!stored) throw notFound();
    return stored.scan;
  }

  async report(id: string): Promise<Report> {
    const stored = await this.repository.get(id);
    if (!stored) throw notFound();
    if (stored.scan.status !== 'completed' || stored.report === null) {
      throw new AppError(409, 'SCAN_NOT_COMPLETED', 'The scan has not completed.', {
        status: stored.scan.status,
      });
    }
    return stored.report;
  }

  /** Only the scans this client started or joined. */
  async listRecent(client = 'local'): Promise<ScanListItem[]> {
    const recent = await this.repository.listRecent(RECENT_SCANS_LIMIT, client);
    return recent.map(({ scan, riskLevel }) => ({
      id: scan.id,
      repo: scan.repo,
      ref: scan.ref,
      status: scan.status,
      riskLevel,
      commitSha: scan.commitSha,
      createdAt: scan.createdAt,
    }));
  }
}
