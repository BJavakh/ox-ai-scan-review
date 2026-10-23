import { describe, expect, it } from 'vitest';
import type { ScanFailure } from '../../src/domain/errors.js';
import { createFixtureFetch } from '../../src/integrations/fixtures/fixtureFetch.js';
import { OsvVulnerabilitySource } from '../../src/integrations/osv/OsvVulnerabilitySource.js';
import type { FetchFn } from '../../src/lib/http.js';
import { dependency } from '../helpers/builders.js';
import { fakeFetch, signal, status } from '../helpers/fetch.js';

const fixtures = createFixtureFetch();
const source = (fetchFn: FetchFn = fixtures) =>
  new OsvVulnerabilitySource({ fetchFn, backoffMs: 0, retries: 1 });

const deps = [
  dependency({ name: 'lodash', version: '4.17.15' }),
  dependency({ name: 'minimist', version: '1.2.5', direct: false }),
  dependency({ name: 'ms', version: '2.0.0' }),
];

describe('OsvVulnerabilitySource', () => {
  it('batches queries, then hydrates and normalizes each advisory once', async () => {
    const fetchFn = fakeFetch((url, init) => fixtures(url, init));
    const result = await source(fetchFn).lookup(
      [...deps, deps[0] ?? dependency({ name: 'x' })],
      signal(),
    );

    expect(result.matches.get('lodash@4.17.15')).toHaveLength(6);
    expect(result.matches.get('minimist@1.2.5')).toEqual(['GHSA-xvch-5gv4-984h']);
    expect(result.matches.has('ms@2.0.0')).toBe(false);
    expect(result.advisories.size).toBe(7);
    expect(result.notes).toEqual([]);

    const posts = fetchFn.calls.filter((u) => u.pathname === '/v1/querybatch');
    expect(posts).toHaveLength(1);
    expect(fetchFn.calls.every((u) => u.origin === 'https://api.osv.dev')).toBe(true);

    const advisory = result.advisories.get('GHSA-p6mc-m468-83gw');
    expect(advisory).toMatchObject({
      databaseSeverity: 'HIGH',
      aliases: ['CVE-2020-8203'],
      hydrated: true,
    });
    expect(advisory?.affected.every((a) => a.name.length > 0)).toBe(true);
  });

  it('degrades gracefully when some advisories cannot be hydrated', async () => {
    const fetchFn = fakeFetch((url, init) =>
      url.pathname.endsWith('GHSA-p6mc-m468-83gw') ? status(500) : fixtures(url, init),
    );
    const result = await source(fetchFn).lookup(deps, signal());
    expect(result.matches.get('lodash@4.17.15')).toContain('GHSA-p6mc-m468-83gw');
    expect(result.advisories.has('GHSA-p6mc-m468-83gw')).toBe(false);
    expect(result.notes[0]).toMatch(/^1 advisories could not be loaded/);
  });

  it('drops withdrawn advisories', async () => {
    const fetchFn = fakeFetch(async (url, init) => {
      if (url.pathname.endsWith('GHSA-xvch-5gv4-984h')) {
        const body = (await (await fixtures(url, init)).json()) as Record<string, unknown>;
        return Response.json({ ...body, withdrawn: '2026-01-01T00:00:00Z' });
      }
      return fixtures(url, init);
    });
    const result = await source(fetchFn).lookup(deps, signal());
    expect(result.matches.has('minimist@1.2.5')).toBe(false);
  });

  it.each([
    ['a 503 after retries', () => status(503)],
    ['a malformed body', () => Response.json({ results: 'nope' })],
    ['a result count mismatch', () => Response.json({ results: [] })],
  ])('fails the scan with VULN_SOURCE_UNAVAILABLE on %s', async (_label, respond) => {
    const fetchFn = fakeFetch((url, init) =>
      url.pathname === '/v1/querybatch' ? respond() : fixtures(url, init),
    );
    await expect(source(fetchFn).lookup(deps, signal())).rejects.toMatchObject({
      code: 'VULN_SOURCE_UNAVAILABLE',
    } satisfies Partial<ScanFailure>);
  });

  it('makes no calls for an empty dependency list', async () => {
    const fetchFn = fakeFetch(() => status(500));
    const result = await source(fetchFn).lookup([], signal());
    expect(result.matches.size).toBe(0);
    expect(fetchFn.calls).toHaveLength(0);
  });
});
