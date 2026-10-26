import type { FastifyBaseLogger } from 'fastify';
import type { Env } from './config/env.js';
import { NpmDependencyResolver } from './integrations/npm/NpmDependencyResolver.js';
import { createFixtureFetch } from './integrations/fixtures/fixtureFetch.js';
import { HttpGitHubClient } from './integrations/github/HttpGitHubClient.js';
import { AnthropicSummaryGenerator } from './integrations/llm/AnthropicSummaryGenerator.js';
import type { SummaryGenerator } from './integrations/llm/SummaryGenerator.js';
import { SummaryWriter } from './integrations/llm/SummaryWriter.js';
import { AdvisoryCache } from './integrations/osv/AdvisoryCache.js';
import { OsvVulnerabilitySource } from './integrations/osv/OsvVulnerabilitySource.js';
import type { FetchFn } from './lib/http.js';
import { InMemoryScanRepository } from './scans/InMemoryScanRepository.js';
import { InProcessJobQueue } from './scans/JobQueue.js';
import { ScanEvents } from './scans/ScanEvents.js';
import { ScanOrchestrator } from './scans/ScanOrchestrator.js';
import { ScanQuota } from './scans/ScanQuota.js';
import { ScanService } from './scans/ScanService.js';

export const MAX_PENDING_SCANS = 25;

export interface ContainerOverrides {
  /** Replaces network access to GitHub and OSV (tests). */
  fetchFn?: FetchFn;
  /** Replaces the LLM (tests). `null` disables it. */
  summaryGenerator?: SummaryGenerator | null;
  backoffMs?: number;
  now?: () => Date;
}

export type Services = ReturnType<typeof createContainer>;

/** Wires implementations. The only place that knows about SCANNER_MODE. */
export function createContainer(
  env: Env,
  logger: FastifyBaseLogger,
  overrides: ContainerOverrides = {},
) {
  const mock = env.SCANNER_MODE === 'mock';
  const fetchFn =
    overrides.fetchFn ??
    (mock ? createFixtureFetch({ latencyMs: 250, fallbackRepo: 'demo__vulnerable-app' }) : fetch);
  const http = { fetchFn, backoffMs: overrides.backoffMs ?? 300 };

  let ai: SummaryGenerator | null;
  let unavailableReason: string;
  if (overrides.summaryGenerator !== undefined) {
    ai = overrides.summaryGenerator;
    unavailableReason = 'AI summaries are disabled.';
  } else if (mock) {
    ai = null;
    unavailableReason = 'Mock mode always uses the template summary.';
  } else if (env.ANTHROPIC_API_KEY) {
    ai = new AnthropicSummaryGenerator({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
      timeoutMs: env.LLM_TIMEOUT_MS,
    });
    unavailableReason = '';
  } else {
    ai = null;
    unavailableReason = 'ANTHROPIC_API_KEY is not configured.';
  }

  const advisoryCache = new AdvisoryCache();
  const repository = new InMemoryScanRepository();
  const events = new ScanEvents();
  const queue = new InProcessJobQueue(env.SCAN_CONCURRENCY, MAX_PENDING_SCANS, (error) => {
    logger.fatal({ err: error }, 'scan job escaped its own error handling');
  });
  const summaries = new SummaryWriter(ai, unavailableReason, logger);
  const orchestrator = new ScanOrchestrator({
    repository,
    events,
    github: new HttpGitHubClient({ ...http, token: mock ? undefined : env.GITHUB_TOKEN }),
    resolver: new NpmDependencyResolver(),
    vulnerabilities: new OsvVulnerabilitySource({ ...http, cache: advisoryCache }),
    summaries,
    logger,
    scanTimeoutMs: env.SCAN_TIMEOUT_MS,
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  const service = new ScanService(
    repository,
    queue,
    orchestrator,
    overrides.now,
    new ScanQuota(env.SCANS_PER_HOUR),
  );

  return {
    repository,
    events,
    queue,
    summaries,
    orchestrator,
    service,
    advisoryCache,
    mode: env.SCANNER_MODE,
  };
}
