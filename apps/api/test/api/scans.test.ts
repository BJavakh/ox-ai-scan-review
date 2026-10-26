import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { apiErrorBodySchema, healthResponseSchema, scanListResponseSchema } from '@ox-scan/shared';
import { createFixtureFetch } from '../../src/integrations/fixtures/fixtureFetch.js';
import {
  type SummaryGenerator,
  SummaryUnavailableError,
} from '../../src/integrations/llm/SummaryGenerator.js';
import { generateTemplateSummary } from '../../src/domain/templateSummary.js';
import { getReport, getScan, runScan, startScan, testApp } from '../helpers/app.js';
import { fakeFetch, status } from '../helpers/fetch.js';

const VULNERABLE = 'https://github.com/demo/vulnerable-app';
const fixtures = createFixtureFetch();
let current: FastifyInstance | undefined;

async function setup(options: Parameters<typeof testApp>[0] = {}) {
  const built = await testApp(options);
  current = built.app;
  return built;
}

afterEach(async () => {
  await current?.close();
  current = undefined;
});

function errorOf(body: unknown) {
  return apiErrorBodySchema.parse(body).error;
}

describe('happy path', () => {
  it('scans a vulnerable repo end to end and produces a prioritized report', async () => {
    const { app, services } = await setup();
    const { res, body } = await startScan(app, VULNERABLE);
    expect(res.statusCode).toBe(202);
    expect(body).toMatchObject({ status: 'queued', deduplicated: false });

    await services.queue.onIdle();
    const scan = await getScan(app, body.scanId);
    expect(scan).toMatchObject({ status: 'completed', progress: 100, error: null });
    expect(scan.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(scan.steps.every((s) => s.status === 'completed')).toBe(true);
    expect(scan.steps.find((s) => s.name === 'resolving_dependencies')?.detail).toBe(
      '13 packages (5 direct)',
    );

    const report = await getReport(app, body.scanId);
    expect(report.riskLevel).toBe('critical');
    expect(report.coverage).toMatchObject({
      manifest: 'package-lock.json',
      accuracy: 'exact',
      packagesChecked: 13,
      unsupportedManifests: [],
    });
    expect(report.summary).toMatchObject({
      mode: 'template',
      fallbackReason: 'AI summaries are disabled.',
    });
    expect(report.topRisks.length).toBeGreaterThan(0);
    expect(new Set(report.topRisks.map((r) => r.packageName)).size).toBe(report.topRisks.length);
    expect(report.stats.totalFindings).toBe(report.findings.length);
    expect(report.actions.length).toBeLessThan(report.findings.length);

    // Manifest hygiene, ranked separately from vulnerabilities, each with a fix.
    expect(report.otherRisks.map((r) => r.kind)).toEqual(['unpinned-range', 'unsupported-node']);
    expect(report.otherRisks[0]?.packages).toEqual(['mkdirp (*)']);
    expect(report.otherRisks.every((r) => r.fix.length > 0)).toBe(true);

    // One action per vulnerable package, sorted by score.
    const scores = report.actions.map((a) => a.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const lodash = report.actions.find((a) => a.packageName === 'lodash');
    expect(lodash).toMatchObject({
      currentVersions: ['4.17.15'],
      // Two 2026 advisories are only fixed in 4.18.0, so 4.17.21 would not be enough.
      targetVersion: '4.18.0',
      fixableCount: 6,
      direct: true,
      dev: false,
      command: 'npm install lodash@4.18.0',
    });
    const handlebars = report.actions.find((a) => a.packageName === 'handlebars');
    expect(handlebars).toMatchObject({ dev: true, highestSeverity: 'CRITICAL' });
    expect(handlebars?.command).toMatch(/^npm install --save-dev handlebars@/);
    const qs = report.actions.find((a) => a.packageName === 'qs');
    expect(qs).toMatchObject({
      direct: false,
      introducedBy: ['express'],
      command: 'npm update qs',
    });
  });

  it('reports a clean repo as "none" and lists what it did not scan', async () => {
    const { app, services } = await setup();
    const scan = await runScan(app, services, 'https://github.com/demo/clean-app');
    const report = await getReport(app, scan.id);
    expect(report).toMatchObject({ riskLevel: 'none', actions: [], findings: [], topRisks: [] });
    expect(report.coverage.unsupportedManifests).toEqual(['requirements.txt']);
    expect(report.summary.headline).toBe('No known vulnerabilities found in 3 npm packages.');
  });

  it('falls back to package.json with an accuracy warning', async () => {
    const { app, services } = await setup();
    const scan = await runScan(app, services, 'https://github.com/demo/approximate-app');
    const report = await getReport(app, scan.id);
    expect(report.coverage).toMatchObject({
      manifest: 'package.json',
      accuracy: 'approximate',
      skippedPackages: 1,
    });
    expect(report.coverage.unsupportedManifests).toEqual(['yarn.lock']);
    expect(report.notes.join(' ')).toContain('Lower accuracy');
  });

  it('scans a specific ref from a /tree/ URL', async () => {
    const { app, services } = await setup();
    const scan = await runScan(app, services, 'https://github.com/demo/vulnerable-app/tree/main');
    expect(scan).toMatchObject({ status: 'completed', ref: 'main' });
  });
});

describe('summaries', () => {
  it('uses the AI summary when it validates', async () => {
    const ai: SummaryGenerator = {
      generate: (input) =>
        Promise.resolve({
          ...generateTemplateSummary(input),
          headline: 'AI: upgrade lodash first.',
        }),
    };
    const { app, services } = await setup({ summaryGenerator: ai });
    const report = await getReport(app, (await runScan(app, services, VULNERABLE)).id);
    expect(report.summary).toEqual(
      expect.objectContaining({
        mode: 'ai',
        headline: 'AI: upgrade lodash first.',
        fallbackReason: null,
      }),
    );
  });

  it('falls back to the template when the LLM fails, without failing the scan', async () => {
    const ai: SummaryGenerator = {
      generate: () => Promise.reject(new SummaryUnavailableError('The AI summary timed out.')),
    };
    const { app, services } = await setup({ summaryGenerator: ai });
    const scan = await runScan(app, services, VULNERABLE);
    expect(scan.status).toBe('completed');
    const report = await getReport(app, scan.id);
    expect(report.summary).toMatchObject({
      mode: 'template',
      fallbackReason: 'The AI summary timed out.',
    });
    expect(report.topRisks.every((r) => r.explanation.length > 0)).toBe(true);
  });
});

describe('scan failures', () => {
  const githubDown = (respond: () => Response) =>
    fakeFetch((url, init) =>
      url.origin === 'https://api.github.com' ? respond() : fixtures(url, init),
    );

  it.each([
    ['repo not found', 'https://github.com/nobody/missing', undefined, 'REPO_NOT_FOUND', false],
    [
      'unknown branch',
      'https://github.com/demo/vulnerable-app/tree/nope',
      undefined,
      'REF_NOT_FOUND',
      false,
    ],
    [
      'no supported manifest',
      'https://github.com/demo/python-only',
      undefined,
      'NO_SUPPORTED_MANIFEST',
      false,
    ],
    [
      'GitHub rate limit',
      VULNERABLE,
      githubDown(() => status(403, { 'x-ratelimit-remaining': '0' })),
      'GITHUB_RATE_LIMITED',
      true,
    ],
    ['GitHub outage', VULNERABLE, githubDown(() => status(502)), 'GITHUB_UNAVAILABLE', true],
    [
      'OSV failure',
      VULNERABLE,
      fakeFetch((url, init) =>
        url.pathname === '/v1/querybatch' ? status(503) : fixtures(url, init),
      ),
      'VULN_SOURCE_UNAVAILABLE',
      true,
    ],
  ])('%s -> %s', async (_label, url, fetchFn, code, retryable) => {
    const { app, services } = await setup(fetchFn ? { fetchFn } : {});
    const scan = await runScan(app, services, url);
    expect(scan.status).toBe('failed');
    expect(scan.error).toMatchObject({ code, retryable });
    expect(scan.error?.message).not.toMatch(/HTTP|stack|Error:/);
    expect(scan.steps.filter((s) => s.status === 'failed')).toHaveLength(1);

    const report = await app.inject({ method: 'GET', url: `/api/scans/${scan.id}/report` });
    expect(report.statusCode).toBe(409);
    expect(errorOf(report.json())).toMatchObject({
      code: 'SCAN_NOT_COMPLETED',
      details: { status: 'failed' },
    });
  });

  it('times out a scan that hangs', async () => {
    const hanging = fakeFetch(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const { app, services } = await setup({ fetchFn: hanging, env: { SCAN_TIMEOUT_MS: '1000' } });
    const scan = await runScan(app, services, VULNERABLE);
    expect(scan.error).toMatchObject({ code: 'SCAN_TIMEOUT', retryable: true });
  });

  it('degrades the report when some advisories cannot be loaded', async () => {
    const flaky = fakeFetch((url, init) =>
      url.pathname === '/v1/vulns/GHSA-p6mc-m468-83gw' ? status(500) : fixtures(url, init),
    );
    const { app, services } = await setup({ fetchFn: flaky });
    const report = await getReport(app, (await runScan(app, services, VULNERABLE)).id);
    expect(report.notes.some((n) => n.includes('could not be loaded'))).toBe(true);
    expect(report.findings.find((f) => f.id === 'GHSA-p6mc-m468-83gw')?.severity).toBe('UNKNOWN');
  });
});

describe('dedupe and caching', () => {
  it('returns the in-flight scan for the same repo and ref', async () => {
    const { app, services } = await setup();
    const first = await startScan(app, VULNERABLE);
    const second = await startScan(app, 'https://github.com/Demo/Vulnerable-App.git');
    expect(second.res.statusCode).toBe(200);
    expect(second.body).toMatchObject({ scanId: first.body.scanId, deduplicated: true });

    const otherRef = await startScan(app, `${VULNERABLE}/tree/main`);
    expect(otherRef.body.deduplicated).toBe(false);
    await services.queue.onIdle();
  });

  it('reuses a completed result for the same commit', async () => {
    const { app, services } = await setup();
    const first = await runScan(app, services, VULNERABLE);
    const second = await runScan(app, services, VULNERABLE);
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('completed');
    expect(second.steps.filter((s) => s.status === 'skipped').map((s) => s.name)).toEqual([
      'resolving_dependencies',
      'checking_vulnerabilities',
      'prioritizing',
      'generating_summary',
    ]);
    const report = await getReport(app, second.id);
    expect(report).toMatchObject({ scanId: second.id, reusedFromScanId: first.id });
  });
});

describe('request validation and errors', () => {
  it.each([
    [{ repoUrl: 'https://gitlab.com/a/b' }, 'INVALID_REPO_URL', { reason: 'host' }],
    [{ repoUrl: 'https://github.com/a' }, 'INVALID_REPO_URL', { reason: 'path' }],
    [{}, 'VALIDATION_ERROR', undefined],
    [{ repoUrl: 'https://github.com/a/b', webhook: 'x' }, 'VALIDATION_ERROR', undefined],
    [{ repoUrl: 42 }, 'VALIDATION_ERROR', undefined],
  ])('rejects %j with %s', async (payload, code, details) => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/scans', payload });
    expect(res.statusCode).toBe(400);
    const error = errorOf(res.json());
    expect(error.code).toBe(code);
    if (details) expect(error.details).toEqual(details);
  });

  it('rejects malformed JSON, wrong content types and oversized bodies', async () => {
    const { app } = await setup();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers: { 'content-type': 'application/json' },
      payload: '{"repoUrl":',
    });
    expect([bad.statusCode, errorOf(bad.json()).code]).toEqual([400, 'VALIDATION_ERROR']);

    const text = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers: { 'content-type': 'text/plain' },
      payload: 'https://github.com/a/b',
    });
    expect([text.statusCode, errorOf(text.json()).code]).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE']);

    const big = await app.inject({
      method: 'POST',
      url: '/api/scans',
      payload: { repoUrl: 'x'.repeat(20_000) },
    });
    expect([big.statusCode, errorOf(big.json()).code]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
  });

  it('returns 404 for unknown scans and routes, 400 for malformed IDs', async () => {
    const { app } = await setup();
    const missing = await app.inject({
      method: 'GET',
      url: '/api/scans/8a7c3e0e-3a0b-4c55-9a55-1a1f4b9a4b8e',
    });
    expect([missing.statusCode, errorOf(missing.json()).code]).toEqual([404, 'NOT_FOUND']);
    const malformed = await app.inject({ method: 'GET', url: '/api/scans/../../etc/passwd' });
    expect(malformed.statusCode).toBe(404);
    const notUuid = await app.inject({ method: 'GET', url: '/api/scans/123' });
    expect([notUuid.statusCode, errorOf(notUuid.json()).code]).toEqual([400, 'VALIDATION_ERROR']);
    const route = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(errorOf(route.json()).code).toBe('NOT_FOUND');
  });

  it('rate limits scan creation per IP', async () => {
    const { app } = await setup();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/scans',
        payload: { repoUrl: 'bad' },
      });
      codes.push(res.statusCode);
      if (i === 10) expect(errorOf(res.json()).code).toBe('RATE_LIMITED');
    }
    expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('listing, health and headers', () => {
  it('lists recent scans newest first with their risk level', async () => {
    const { app, services } = await setup();
    await runScan(app, services, VULNERABLE);
    await runScan(app, services, 'https://github.com/demo/clean-app');
    const list = scanListResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/scans' })).json(),
    );
    expect(list.scans.map((s) => [s.repo.name, s.riskLevel])).toEqual([
      ['clean-app', 'none'],
      ['vulnerable-app', 'critical'],
    ]);
  });

  it('lists only the scans this client started or joined', async () => {
    const { app, services } = await setup();
    const from = (remoteAddress: string, repoUrl: string) =>
      app.inject({ method: 'POST', url: '/api/scans', payload: { repoUrl }, remoteAddress });
    const listFor = async (remoteAddress: string) =>
      scanListResponseSchema
        .parse((await app.inject({ method: 'GET', url: '/api/scans', remoteAddress })).json())
        .scans.map((s) => s.repo.name);

    await from('203.0.113.1', VULNERABLE);
    await from('203.0.113.2', 'https://github.com/demo/clean-app');
    // Joins the first client's in-flight scan (deduplicated) and must then see it too.
    await from('203.0.113.2', VULNERABLE);
    await services.queue.onIdle();

    expect(await listFor('203.0.113.1')).toEqual(['vulnerable-app']);
    expect(await listFor('203.0.113.2')).toEqual(['clean-app', 'vulnerable-app']);
    expect(await listFor('198.51.100.9')).toEqual([]);
  });

  it('reports health without leaking configuration', async () => {
    const { app } = await setup({ env: { ANTHROPIC_API_KEY: 'sk-ant-secret' } });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(healthResponseSchema.parse(res.json())).toEqual({
      status: 'ok',
      mode: 'live',
      aiSummaries: false,
    });
    expect(res.body).not.toContain('sk-ant');
  });

  it('sets security headers, CORS for the web origin only, and request IDs', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://localhost:5180', 'x-request-id': 'abc-123' },
    });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5180');
    expect(res.headers['x-request-id']).toBe('abc-123');
    expect(res.headers['x-powered-by']).toBeUndefined();

    const other = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example', 'x-request-id': 'bad id\nwith newline' },
    });
    // A fixed allowed origin is always sent; the browser rejects the mismatch.
    expect(other.headers['access-control-allow-origin']).toBe('http://localhost:5180');
    expect(other.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
