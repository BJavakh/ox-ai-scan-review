import type { ScanError, ScanErrorCode } from '@ox-scan/shared';

interface ErrorInfo {
  message: string;
  retryable: boolean;
}

/** Stable, human-readable messages. Upstream error text is never shown to users. */
export const SCAN_ERRORS: Readonly<Record<ScanErrorCode, ErrorInfo>> = {
  REPO_NOT_FOUND: {
    message:
      'Repository not found. Check the URL; private repositories are not supported in this version.',
    retryable: false,
  },
  REPO_EMPTY: {
    message: 'The repository is empty, so there is nothing to scan.',
    retryable: false,
  },
  REF_NOT_FOUND: {
    message: 'The branch, tag or commit in the URL was not found in this repository.',
    retryable: false,
  },
  GITHUB_RATE_LIMITED: {
    message:
      "GitHub's API rate limit was reached. Try again in a few minutes, or configure GITHUB_TOKEN on the server.",
    retryable: true,
  },
  GITHUB_UNAVAILABLE: {
    message: 'GitHub did not respond correctly. Try again shortly.',
    retryable: true,
  },
  NO_SUPPORTED_MANIFEST: {
    message:
      'No package-lock.json or package.json was found in the repository root. Only npm projects are supported in this version.',
    retryable: false,
  },
  MANIFEST_TOO_LARGE: {
    message: 'A dependency manifest is larger than the 10 MB limit.',
    retryable: false,
  },
  MANIFEST_INVALID: {
    message: 'The dependency manifest could not be parsed as a valid npm manifest.',
    retryable: false,
  },
  TOO_MANY_PACKAGES: {
    message: 'The project has more than 10,000 distinct packages, which is above the scan limit.',
    retryable: false,
  },
  VULN_SOURCE_UNAVAILABLE: {
    message: 'The vulnerability database (OSV.dev) could not be reached. Try again shortly.',
    retryable: true,
  },
  SCAN_TIMEOUT: {
    message: 'The scan took too long and was stopped. Try again shortly.',
    retryable: true,
  },
  INTERNAL_ERROR: {
    message: 'An unexpected error occurred while scanning.',
    retryable: true,
  },
};

/** A known, expected scan failure with a stable code. */
export class ScanFailure extends Error {
  readonly code: ScanErrorCode;

  constructor(code: ScanErrorCode, internalDetail?: string, options?: ErrorOptions) {
    super(internalDetail ?? code, options);
    this.name = 'ScanFailure';
    this.code = code;
  }

  toScanError(): ScanError {
    return toScanError(this.code);
  }
}

export function toScanError(code: ScanErrorCode): ScanError {
  const info = SCAN_ERRORS[code];
  return { code, message: info.message, retryable: info.retryable };
}
