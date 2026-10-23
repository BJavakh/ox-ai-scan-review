import { z } from 'zod';
import { commitShaSchema } from '@ox-scan/shared';
import { ScanFailure } from '../../domain/errors.js';
import {
  type FetchFn,
  ResponseTooLargeError,
  UpstreamHttpError,
  UpstreamNetworkError,
  readBodyCapped,
  request,
  safeJsonParse,
} from '../../lib/http.js';
import { GITHUB_API_ORIGIN, type GitHubClient, MAX_MANIFEST_BYTES } from './GitHubClient.js';

const repoSchema = z.object({ default_branch: z.string().min(1).max(255) });
const commitSchema = z.object({ sha: commitShaSchema });
const contentsSchema = z.array(z.object({ name: z.string(), type: z.string() })).max(10_000);

type Resource = 'repo' | 'ref' | 'file';

export interface HttpGitHubClientOptions {
  fetchFn?: FetchFn;
  token?: string | undefined;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
}

/** Maps GitHub HTTP failures to stable scan error codes. */
export function mapGitHubFailure(
  status: number,
  headers: Headers,
  resource: Resource,
): ScanFailure {
  if (
    status === 429 ||
    (status === 403 && (headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after')))
  ) {
    return new ScanFailure('GITHUB_RATE_LIMITED', `GitHub ${String(status)}`);
  }
  if (status === 409) return new ScanFailure('REPO_EMPTY');
  if (status === 404 || status === 451 || status === 422) {
    if (resource === 'ref') return new ScanFailure('REF_NOT_FOUND');
    if (resource === 'file')
      return new ScanFailure('GITHUB_UNAVAILABLE', 'listed file not readable');
    return new ScanFailure('REPO_NOT_FOUND');
  }
  return new ScanFailure('GITHUB_UNAVAILABLE', `GitHub ${String(status)}`);
}

export class HttpGitHubClient implements GitHubClient {
  private readonly fetchFn: FetchFn;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly backoffMs: number;

  constructor(options: HttpGitHubClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retries = options.retries ?? 2;
    this.backoffMs = options.backoffMs ?? 300;
    this.headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ox-ai-scan-review',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    };
  }

  async getDefaultBranch(owner: string, repo: string, signal: AbortSignal): Promise<string> {
    const body = await this.getJson(['repos', owner, repo], {}, signal, 'repo');
    return this.parse(repoSchema, body).default_branch;
  }

  async resolveCommit(
    owner: string,
    repo: string,
    ref: string,
    signal: AbortSignal,
  ): Promise<string> {
    const body = await this.getJson(['repos', owner, repo, 'commits', ref], {}, signal, 'ref');
    return this.parse(commitSchema, body).sha;
  }

  async listRootFiles(
    owner: string,
    repo: string,
    sha: string,
    signal: AbortSignal,
  ): Promise<string[]> {
    const body = await this.getJson(
      ['repos', owner, repo, 'contents'],
      { ref: sha },
      signal,
      'repo',
    );
    return this.parse(contentsSchema, body)
      .filter((entry) => entry.type === 'file')
      .map((entry) => entry.name);
  }

  async getFile(
    owner: string,
    repo: string,
    sha: string,
    path: string,
    signal: AbortSignal,
  ): Promise<string> {
    const response = await this.send(
      ['repos', owner, repo, 'contents', path],
      { ref: sha },
      signal,
      'file',
      'application/vnd.github.raw+json',
    );
    try {
      return await readBodyCapped(response, MAX_MANIFEST_BYTES);
    } catch (error) {
      if (error instanceof ResponseTooLargeError) throw new ScanFailure('MANIFEST_TOO_LARGE');
      throw new ScanFailure('GITHUB_UNAVAILABLE', 'body read failed', { cause: error });
    }
  }

  /** Builds a URL on the fixed API origin; every path segment is escaped. */
  private url(segments: readonly string[], query: Record<string, string>): URL {
    const path = segments.map((s) => encodeURIComponent(s)).join('/');
    const url = new URL(`/${path}`, GITHUB_API_ORIGIN);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url;
  }

  private async send(
    segments: readonly string[],
    query: Record<string, string>,
    signal: AbortSignal,
    resource: Resource,
    accept?: string,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await request(this.fetchFn, this.url(segments, query), {
        headers: accept ? { ...this.headers, Accept: accept } : this.headers,
        timeoutMs: this.timeoutMs,
        retries: this.retries,
        backoffMs: this.backoffMs,
        signal,
        redirectOrigin: GITHUB_API_ORIGIN,
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof UpstreamHttpError)
        throw mapGitHubFailure(error.status, error.headers, resource);
      if (error instanceof UpstreamNetworkError)
        throw new ScanFailure('GITHUB_UNAVAILABLE', 'network', { cause: error });
      throw error;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw mapGitHubFailure(response.status, response.headers, resource);
    }
    return response;
  }

  private async getJson(
    segments: readonly string[],
    query: Record<string, string>,
    signal: AbortSignal,
    resource: Resource,
  ): Promise<unknown> {
    const response = await this.send(segments, query, signal, resource);
    let text: string;
    try {
      text = await readBodyCapped(response, 2 * 1024 * 1024);
    } catch (error) {
      throw new ScanFailure('GITHUB_UNAVAILABLE', 'metadata body unreadable', { cause: error });
    }
    const parsed = safeJsonParse(text);
    if (!parsed.ok) throw new ScanFailure('GITHUB_UNAVAILABLE', 'invalid JSON from GitHub');
    return parsed.value;
  }

  private parse<T>(schema: z.ZodType<T>, body: unknown): T {
    const result = schema.safeParse(body);
    if (!result.success)
      throw new ScanFailure('GITHUB_UNAVAILABLE', 'unexpected GitHub response shape');
    return result.data;
  }
}
