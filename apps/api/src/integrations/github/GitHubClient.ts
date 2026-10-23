/** Read-only access to a public GitHub repository at a pinned commit. */
export interface GitHubClient {
  getDefaultBranch(owner: string, repo: string, signal: AbortSignal): Promise<string>;
  resolveCommit(owner: string, repo: string, ref: string, signal: AbortSignal): Promise<string>;
  /** Names of regular files in the repository root at `sha`. */
  listRootFiles(owner: string, repo: string, sha: string, signal: AbortSignal): Promise<string[]>;
  /** Raw file contents at `sha`, capped at MAX_MANIFEST_BYTES. */
  getFile(
    owner: string,
    repo: string,
    sha: string,
    path: string,
    signal: AbortSignal,
  ): Promise<string>;
}

export const GITHUB_API_ORIGIN = 'https://api.github.com';
export const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
