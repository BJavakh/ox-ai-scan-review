import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { FetchFn } from '../../lib/http.js';

/** apps/api/fixtures, valid from both src/ (tsx) and dist/ (node). */
export const FIXTURES_DIR = resolve(import.meta.dirname, '../../../fixtures');

const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,200}$/;
const metaSchema = z.object({ default_branch: z.string(), sha: z.string() });
const indexSchema = z.record(z.string(), z.array(z.string()));
const batchSchema = z.object({
  queries: z.array(z.object({ package: z.object({ name: z.string() }), version: z.string() })),
});

export interface FixtureFetchOptions {
  fixturesDir?: string;
  /** Artificial latency per request, so progress is visible in the offline demo. */
  latencyMs?: number;
  /** Repo fixture used for unknown owner/repo (mock mode). Unknown repos 404 otherwise. */
  fallbackRepo?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const notFound = () => json({ message: 'Not Found' }, 404);

/**
 * A `fetch` that serves recorded GitHub and OSV responses from disk. Used by
 * SCANNER_MODE=mock and by tests, so the real HTTP clients (status mapping,
 * size caps, parsing) run unchanged against deterministic data.
 */
export function createFixtureFetch(options: FixtureFetchOptions = {}): FetchFn {
  const dir = options.fixturesDir ?? FIXTURES_DIR;
  const latency = options.latencyMs ?? 0;

  async function repoDir(owner: string, repo: string): Promise<string | null> {
    const name = `${owner}__${repo}`.toLowerCase();
    const candidates = [name, options.fallbackRepo].filter((c): c is string => c !== undefined);
    const existing = new Set(await readdir(join(dir, 'github')));
    const found = candidates.find((c) => SAFE_SEGMENT.test(c) && existing.has(c));
    return found === undefined ? null : join(dir, 'github', found);
  }

  async function github(url: URL): Promise<Response> {
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const [prefix, owner, repo, kind, ...rest] = parts;
    if (prefix !== 'repos' || owner === undefined || repo === undefined) return notFound();
    const base = await repoDir(owner, repo);
    if (base === null) return notFound();
    const meta = metaSchema.parse(JSON.parse(await readFile(join(base, 'meta.json'), 'utf8')));

    if (kind === undefined) return json({ default_branch: meta.default_branch, private: false });
    if (kind === 'commits') {
      const ref = rest.join('/');
      return ref === meta.default_branch || ref === meta.sha
        ? json({ sha: meta.sha })
        : json({ message: 'No commit found' }, 422);
    }
    if (kind === 'contents') {
      const files = (await readdir(base)).filter((f) => f !== 'meta.json');
      if (rest.length === 0) return json(files.map((name) => ({ name, type: 'file' })));
      const [file] = rest;
      if (
        rest.length !== 1 ||
        file === undefined ||
        !SAFE_SEGMENT.test(file) ||
        !files.includes(file)
      )
        return notFound();
      return new Response(await readFile(join(base, file)), { status: 200 });
    }
    return notFound();
  }

  async function osv(url: URL, init: RequestInit | undefined): Promise<Response> {
    if (url.pathname === '/v1/querybatch' && init?.method === 'POST') {
      const index = indexSchema.parse(
        JSON.parse(await readFile(join(dir, 'osv', 'index.json'), 'utf8')),
      );
      const body = batchSchema.parse(JSON.parse(typeof init.body === 'string' ? init.body : '{}'));
      return json({
        results: body.queries.map((q) => {
          const ids = index[`${q.package.name}@${q.version}`] ?? [];
          return ids.length === 0
            ? {}
            : { vulns: ids.map((id) => ({ id, modified: '2026-01-01T00:00:00Z' })) };
        }),
      });
    }
    const match = /^\/v1\/vulns\/([^/]+)$/.exec(url.pathname);
    const id = match?.[1] === undefined ? undefined : decodeURIComponent(match[1]);
    if (id === undefined || !SAFE_SEGMENT.test(id)) return notFound();
    try {
      return new Response(await readFile(join(dir, 'osv', 'vulns', `${id}.json`)), { status: 200 });
    } catch {
      return notFound();
    }
  }

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (latency > 0) await new Promise((r) => setTimeout(r, latency));
    init?.signal?.throwIfAborted();
    if (url.origin === 'https://api.github.com') return github(url);
    if (url.origin === 'https://api.osv.dev') return osv(url, init);
    throw new TypeError(`fixture fetch: unexpected origin ${url.origin}`);
  };
}
