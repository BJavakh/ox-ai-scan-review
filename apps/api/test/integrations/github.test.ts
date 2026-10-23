import { describe, expect, it } from 'vitest';
import { ScanFailure } from '../../src/domain/errors.js';
import { HttpGitHubClient } from '../../src/integrations/github/HttpGitHubClient.js';
import { createFixtureFetch } from '../../src/integrations/fixtures/fixtureFetch.js';
import { fakeFetch, signal, status } from '../helpers/fetch.js';

const fixtures = createFixtureFetch();
const client = (fetchFn = fixtures, token?: string) =>
  new HttpGitHubClient({ fetchFn, token, backoffMs: 0, retries: 1 });

async function failureCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ScanFailure) return error.code;
    throw error;
  }
  throw new Error('expected failure');
}

describe('HttpGitHubClient', () => {
  it('resolves the default branch, commit, root files and file contents', async () => {
    const gh = client();
    expect(await gh.getDefaultBranch('demo', 'vulnerable-app', signal())).toBe('main');
    const sha = await gh.resolveCommit('demo', 'vulnerable-app', 'main', signal());
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const files = await gh.listRootFiles('demo', 'vulnerable-app', sha, signal());
    expect(files.sort()).toEqual(['package-lock.json', 'package.json']);
    const lock = await gh.getFile('demo', 'vulnerable-app', sha, 'package-lock.json', signal());
    expect(JSON.parse(lock)).toMatchObject({ lockfileVersion: 3 });
  });

  it('only calls the fixed API origin with escaped path segments', async () => {
    const fetchFn = fakeFetch(() => status(404));
    await failureCode(client(fetchFn).resolveCommit('o', 'r', 'feature/x?y#z', signal()));
    const [call] = fetchFn.calls;
    expect(call?.origin).toBe('https://api.github.com');
    expect(call?.pathname).toBe('/repos/o/r/commits/feature%2Fx%3Fy%23z');
  });

  it('sends the token only when configured', async () => {
    const seen: (string | null)[] = [];
    const fetchFn = fakeFetch((_u, init) => {
      seen.push(new Headers(init?.headers).get('authorization'));
      return Response.json({ default_branch: 'main' });
    });
    await client(fetchFn).getDefaultBranch('o', 'r', signal());
    await client(fetchFn, 'ghp_test').getDefaultBranch('o', 'r', signal());
    expect(seen).toEqual([null, 'Bearer ghp_test']);
  });

  it.each([
    [404, {}, 'repo', 'REPO_NOT_FOUND'],
    [403, { 'x-ratelimit-remaining': '0' }, 'repo', 'GITHUB_RATE_LIMITED'],
    [429, {}, 'repo', 'GITHUB_RATE_LIMITED'],
    [403, {}, 'repo', 'GITHUB_UNAVAILABLE'],
    [500, {}, 'repo', 'GITHUB_UNAVAILABLE'],
    [409, {}, 'ref', 'REPO_EMPTY'],
    [422, {}, 'ref', 'REF_NOT_FOUND'],
    [404, {}, 'ref', 'REF_NOT_FOUND'],
  ] as const)('maps HTTP %d %j on %s to %s', async (code, headers, kind, expected) => {
    const gh = client(fakeFetch(() => status(code, headers)));
    const call =
      kind === 'repo'
        ? gh.getDefaultBranch('o', 'r', signal())
        : gh.resolveCommit('o', 'r', 'main', signal());
    expect(await failureCode(call)).toBe(expected);
  });

  it('reports unknown repositories as not found', async () => {
    expect(await failureCode(client().getDefaultBranch('nobody', 'nothing', signal()))).toBe(
      'REPO_NOT_FOUND',
    );
  });

  it('rejects manifests over 10 MB while streaming', async () => {
    const big = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const gh = client(fakeFetch(() => new Response(big)));
    expect(
      await failureCode(gh.getFile('o', 'r', 'a'.repeat(40), 'package-lock.json', signal())),
    ).toBe('MANIFEST_TOO_LARGE');
  });

  it('treats malformed GitHub responses as upstream errors', async () => {
    const gh = client(fakeFetch(() => Response.json({ sha: 'not-a-sha' })));
    expect(await failureCode(gh.resolveCommit('o', 'r', 'main', signal()))).toBe(
      'GITHUB_UNAVAILABLE',
    );
  });
});
