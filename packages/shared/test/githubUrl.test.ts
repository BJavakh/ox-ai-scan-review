import { describe, expect, it } from 'vitest';
import { parseGitHubRepoUrl } from '../src/githubUrl.js';

describe('parseGitHubRepoUrl', () => {
  it.each([
    ['https://github.com/expressjs/express', 'expressjs', 'express', null],
    ['https://github.com/expressjs/express/', 'expressjs', 'express', null],
    ['https://github.com/expressjs/express.git', 'expressjs', 'express', null],
    ['https://www.github.com/expressjs/express', 'expressjs', 'express', null],
    ['  https://github.com/a-b/c.d_e  ', 'a-b', 'c.d_e', null],
    ['https://github.com/vercel/next.js', 'vercel', 'next.js', null],
    ['https://github.com/o/r/tree/main', 'o', 'r', 'main'],
    ['https://github.com/o/r/tree/feature/login-v2', 'o', 'r', 'feature/login-v2'],
    ['https://github.com/o/r/tree/v1.2.3', 'o', 'r', 'v1.2.3'],
    ['https://github.com/o/r?tab=readme#top', 'o', 'r', null],
  ])('accepts %s', (input, owner, repo, ref) => {
    const result = parseGitHubRepoUrl(input);
    expect(result).toMatchObject({ ok: true, value: { owner, repo, ref } });
  });

  it('builds a canonical URL from validated parts only', () => {
    const result = parseGitHubRepoUrl('https://WWW.GitHub.com/o/r.git?x=<script>');
    expect(result).toEqual({
      ok: true,
      value: { owner: 'o', repo: 'r', ref: null, canonicalUrl: 'https://github.com/o/r' },
    });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    [`https://github.com/o/${'r'.repeat(300)}`, 'too_long'],
    ['github.com/o/r', 'not_a_url'],
    ['o/r', 'not_a_url'],
    ['http://github.com/o/r', 'protocol'],
    ['ftp://github.com/o/r', 'protocol'],
    ['javascript:alert(1)', 'protocol'],
    ['file:///etc/passwd', 'protocol'],
    ['https://gitlab.com/o/r', 'host'],
    ['https://github.com.evil.com/o/r', 'host'],
    ['https://api.github.com/repos/o/r', 'host'],
    ['https://169.254.169.254/latest/meta-data', 'host'],
    ['https://localhost/o/r', 'host'],
    ['https://raw.githubusercontent.com/o/r/main/x', 'host'],
    ['https://user:token@github.com/o/r', 'credentials'],
    ['https://github.com:8443/o/r', 'port'],
    ['https://github.com/o', 'path'],
    ['https://github.com/', 'path'],
    ['https://github.com/o/r/blob/main/package.json', 'path'],
    ['https://github.com/o/r/tree', 'path'],
    ['https://github.com/o/r/issues', 'path'],
    ['https://github.com/-o/r', 'owner'],
    ['https://github.com/o-/r', 'owner'],
    ['https://github.com/o--o/r', 'owner'],
    [`https://github.com/${'a'.repeat(40)}/r`, 'owner'],
    ['https://github.com/o%2e/r', 'owner'],
    ['https://github.com/o/r%20x', 'repo'],
    ['https://github.com/o/.git', 'repo'],
    ['https://github.com/o/r/tree/-flag', 'ref'],
    ['https://github.com/o/r/tree/a%2F..%2Fb', 'ref'],
    ['https://github.com/o/r/tree/semi;colon', 'ref'],
  ])('rejects %s (%s)', (input, reason) => {
    const result = parseGitHubRepoUrl(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(reason);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it.each([
    'https://github.com/o/r/tree/../../x/y',
    'https://github.com/a/b/../../c/d',
    'https://github.com/a/b/%2e%2e/%2E%2E/c/d',
    'https://github.com/a/./b',
  ])('rejects dot segments that URL() would silently resolve: %s', (input) => {
    expect(parseGitHubRepoUrl(input)).toMatchObject({ ok: false, reason: 'path' });
  });

  it('allows dots inside names', () => {
    expect(parseGitHubRepoUrl('https://github.com/o/.github')).toMatchObject({
      ok: true,
      value: { repo: '.github' },
    });
    expect(parseGitHubRepoUrl('https://github.com/o/r/tree/release-1.0')).toMatchObject({
      ok: true,
      value: { ref: 'release-1.0' },
    });
  });
});

describe('parseGitHubRepoUrl: characters URL() would rewrite', () => {
  it.each([
    'https://github.com/victim/x\\..\\..\\evil/repo',
    'https://github.com/o/r\\x',
    'https://github.com/o/r\ttab',
    'https://github.com/o/\nr',
  ])('rejects %j', (input) => {
    expect(parseGitHubRepoUrl(input)).toMatchObject({ ok: false, reason: 'path' });
  });
});
