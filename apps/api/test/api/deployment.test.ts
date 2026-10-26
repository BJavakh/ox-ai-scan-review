import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { apiErrorBodySchema } from '@ox-scan/shared';
import { loadEnv } from '../../src/config/env.js';
import { WEB_CSP, buildApp } from '../../src/http/app.js';
import { createFixtureFetch } from '../../src/integrations/fixtures/fixtureFetch.js';

let current: FastifyInstance | undefined;
let webDir = '';

beforeAll(async () => {
  webDir = await mkdtemp(join(tmpdir(), 'scan-review-web-'));
  await mkdir(join(webDir, 'assets'));
  await writeFile(join(webDir, 'index.html'), '<!doctype html><title>Scan Review</title>');
  await writeFile(join(webDir, 'assets', 'index-abc123.js'), 'console.log(1)');
});

afterAll(async () => {
  await rm(webDir, { recursive: true, force: true });
});

afterEach(async () => {
  await current?.close();
  current = undefined;
});

async function app(env: Record<string, string>, extraRoutes?: (app: FastifyInstance) => void) {
  const built = await buildApp(loadEnv({ NODE_ENV: 'test', SCANNER_MODE: 'mock', ...env }), {
    fetchFn: createFixtureFetch(),
    summaryGenerator: null,
  });
  extraRoutes?.(built.app);
  await built.app.ready();
  current = built.app;
  return built.app;
}

describe('single-origin web serving (WEB_DIST_DIR)', () => {
  it('serves the web app with the web CSP and revalidated HTML', async () => {
    const server = await app({ WEB_DIST_DIR: webDir });
    const res = await server.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-security-policy']).toBe(WEB_CSP);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('caches hashed assets as immutable', async () => {
    const server = await app({ WEB_DIST_DIR: webDir });
    const res = await server.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it("keeps the API's strict CSP and JSON 404s", async () => {
    const server = await app({ WEB_DIST_DIR: webDir });
    const health = await server.inject({ method: 'GET', url: '/api/health' });
    expect(health.headers['content-security-policy']).toContain("default-src 'none'");
    const missing = await server.inject({ method: 'GET', url: '/api/nope' });
    expect(missing.statusCode).toBe(404);
    expect(apiErrorBodySchema.parse(missing.json()).error.code).toBe('NOT_FOUND');
  });

  it('does not serve files outside the web root', async () => {
    const server = await app({ WEB_DIST_DIR: webDir });
    const res = await server.inject({ method: 'GET', url: '/../package.json' });
    expect(res.statusCode).toBe(404);
    const encoded = await server.inject({ method: 'GET', url: '/%2e%2e/%2e%2e/etc/passwd' });
    expect(encoded.statusCode).toBe(404);
  });

  it('serves no web files when WEB_DIST_DIR is not set', async () => {
    const server = await app({});
    expect((await server.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
  });
});

describe('client IP behind a reverse proxy (TRUST_PROXY_HOPS)', () => {
  const withIpRoute = (server: FastifyInstance) => {
    server.get('/test/ip', (request) => ({ ip: request.ip }));
  };
  const ipFor = async (server: FastifyInstance, forwardedFor: string) =>
    (
      await server.inject({
        method: 'GET',
        url: '/test/ip',
        remoteAddress: '10.0.0.1',
        headers: { 'x-forwarded-for': forwardedFor },
      })
    ).json<{ ip: string }>().ip;

  it('ignores X-Forwarded-For by default', async () => {
    const server = await app({}, withIpRoute);
    expect(await ipFor(server, '203.0.113.7')).toBe('10.0.0.1');
  });

  it('uses the address added by the trusted proxy, not one the client wrote', async () => {
    const server = await app({ TRUST_PROXY_HOPS: '1' }, withIpRoute);
    // The client sent "1.2.3.4" itself; the proxy appended the real address.
    expect(await ipFor(server, '1.2.3.4, 203.0.113.7')).toBe('203.0.113.7');
  });
});
