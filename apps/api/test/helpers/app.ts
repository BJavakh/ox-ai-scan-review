import type { FastifyInstance } from 'fastify';
import { type Report, type Scan, reportSchema, scanSchema } from '@ox-scan/shared';
import { loadEnv } from '../../src/config/env.js';
import type { Services } from '../../src/container.js';
import { buildApp } from '../../src/http/app.js';
import { createFixtureFetch } from '../../src/integrations/fixtures/fixtureFetch.js';
import type { SummaryGenerator } from '../../src/integrations/llm/SummaryGenerator.js';
import type { FetchFn } from '../../src/lib/http.js';

export interface TestAppOptions {
  fetchFn?: FetchFn;
  summaryGenerator?: SummaryGenerator | null;
  env?: Record<string, string>;
  heartbeatMs?: number;
}

export async function testApp(
  options: TestAppOptions = {},
): Promise<{ app: FastifyInstance; services: Services }> {
  const env = loadEnv({ NODE_ENV: 'test', SCANNER_MODE: 'live', ...options.env });
  const built = await buildApp(env, {
    fetchFn: options.fetchFn ?? createFixtureFetch(),
    summaryGenerator: options.summaryGenerator ?? null,
    backoffMs: 0,
    ...(options.heartbeatMs ? { heartbeatMs: options.heartbeatMs } : {}),
  });
  await built.app.ready();
  return built;
}

export async function startScan(app: FastifyInstance, repoUrl: string) {
  const res = await app.inject({ method: 'POST', url: '/api/scans', payload: { repoUrl } });
  return { res, body: res.json<{ scanId: string; status: string; deduplicated: boolean }>() };
}

/** Start a scan, wait for the queue to drain, return the validated scan. */
export async function runScan(
  app: FastifyInstance,
  services: Services,
  repoUrl: string,
): Promise<Scan> {
  const { body } = await startScan(app, repoUrl);
  await services.queue.onIdle();
  return getScan(app, body.scanId);
}

export async function getScan(app: FastifyInstance, id: string): Promise<Scan> {
  const res = await app.inject({ method: 'GET', url: `/api/scans/${id}` });
  return scanSchema.parse(res.json());
}

export async function getReport(app: FastifyInstance, id: string): Promise<Report> {
  const res = await app.inject({ method: 'GET', url: `/api/scans/${id}/report` });
  if (res.statusCode !== 200) throw new Error(`report ${String(res.statusCode)}: ${res.body}`);
  return reportSchema.parse(res.json());
}
