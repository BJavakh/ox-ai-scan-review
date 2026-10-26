import { MAX_REPO_URL_LENGTH } from './api.js';

export interface GitHubRepoTarget {
  owner: string;
  repo: string;
  /** Branch, tag or commit from a `/tree/{ref}` URL; null means the default branch. */
  ref: string | null;
  /** Canonical URL rebuilt from validated parts. Never echo the raw input. */
  canonicalUrl: string;
}

export type RepoUrlErrorReason =
  | 'empty'
  | 'too_long'
  | 'not_a_url'
  | 'protocol'
  | 'host'
  | 'credentials'
  | 'port'
  | 'path'
  | 'owner'
  | 'repo'
  | 'ref';

export type ParseRepoUrlResult =
  | { ok: true; value: GitHubRepoTarget }
  | { ok: false; reason: RepoUrlErrorReason; message: string };

const ALLOWED_HOSTS = new Set(['github.com', 'www.github.com']);

/** 1-39 chars, alphanumerics or single hyphens, no leading/trailing hyphen. */
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const REF_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;
/** `.`/`..` path segments, literal or percent-encoded. URL() would silently resolve them. */
const DOT_SEGMENT = /\/(?:\.|%2e){1,2}(?=\/|$|[?#])/i;

const MESSAGES: Record<RepoUrlErrorReason, string> = {
  empty: 'Enter a GitHub repository URL.',
  too_long: `The URL is longer than ${MAX_REPO_URL_LENGTH} characters.`,
  not_a_url: 'That does not look like a URL. Use https://github.com/{owner}/{repo}.',
  protocol: 'Only https:// URLs are supported.',
  host: 'Only github.com repositories are supported.',
  credentials: 'Remove the username or token from the URL.',
  port: 'Remove the port from the URL.',
  path: 'Use a repository URL like https://github.com/{owner}/{repo} or .../tree/{branch}.',
  owner: 'The owner name is not a valid GitHub user or organization name.',
  repo: 'The repository name is not valid.',
  ref: 'The branch or tag name is not valid.',
};

function fail(reason: RepoUrlErrorReason): ParseRepoUrlResult {
  return { ok: false, reason, message: MESSAGES[reason] };
}

function isValidRepoName(name: string): boolean {
  return REPO_PATTERN.test(name) && name !== '.' && name !== '..';
}

function isValidRef(ref: string): boolean {
  if (!REF_PATTERN.test(ref)) return false;
  if (ref.startsWith('-') || ref.startsWith('/') || ref.endsWith('/')) return false;
  if (ref.includes('//')) return false;
  return !ref.split('/').some((part) => part === '..' || part === '.');
}

/**
 * Parse a user-supplied GitHub repository URL.
 *
 * Accepts https://github.com/{owner}/{repo} with an optional trailing slash,
 * `.git` suffix, or `/tree/{ref}`. Everything else is rejected. The result is
 * only ever used to build requests against fixed API base URLs; the input URL
 * itself is never fetched (see docs/SECURITY.md, SSRF).
 */
export function parseGitHubRepoUrl(input: string): ParseRepoUrlResult {
  const trimmed = input.trim();
  if (trimmed === '') return fail('empty');
  if (trimmed.length > MAX_REPO_URL_LENGTH) return fail('too_long');
  // URL() treats "\\" as "/" and drops tabs and newlines, so the path it parses could differ from what was shown.
  if (/[\\\s]/.test(trimmed)) return fail('path');
  if (DOT_SEGMENT.test(trimmed)) return fail('path');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return fail('not_a_url');
  }

  if (url.protocol !== 'https:') return fail('protocol');
  if (!ALLOWED_HOSTS.has(url.hostname)) return fail('host');
  if (url.username !== '' || url.password !== '') return fail('credentials');
  if (url.port !== '') return fail('port');

  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const [owner, rawRepo, ...rest] = segments;
  if (owner === undefined || rawRepo === undefined) return fail('path');

  let ref: string | null = null;
  if (rest.length > 0) {
    const [marker, ...refParts] = rest;
    if (marker !== 'tree' || refParts.length === 0) return fail('path');
    ref = refParts.join('/');
  }

  const repo = rest.length === 0 && rawRepo.endsWith('.git') ? rawRepo.slice(0, -4) : rawRepo;

  if (!OWNER_PATTERN.test(owner)) return fail('owner');
  if (!isValidRepoName(repo)) return fail('repo');
  if (ref !== null && !isValidRef(ref)) return fail('ref');

  const base = `https://github.com/${owner}/${repo}`;
  return {
    ok: true,
    value: { owner, repo, ref, canonicalUrl: ref === null ? base : `${base}/tree/${ref}` },
  };
}
