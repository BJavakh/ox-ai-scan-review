import {
  type CreateScanResponse,
  type HealthResponse,
  type Report,
  type Scan,
  type ScanListItem,
  apiErrorBodySchema,
  createScanResponseSchema,
  healthResponseSchema,
  reportSchema,
  scanListResponseSchema,
  scanSchema,
} from '@ox-scan/shared';

/** A failed API call, carrying the server's stable error code when there is one. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * `parse` is a plain function rather than a generic Zod type: generic ZodType<T>
 * parameters make type-aware lint rules expand Zod's deep types and run out of memory.
 */
async function call<T>(path: string, parse: (body: unknown) => T, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
    headers.set('accept', 'application/json');
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiRequestError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check that the API is running.',
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorBodySchema.safeParse(body);
    throw parsed.success
      ? new ApiRequestError(response.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiRequestError(
          response.status,
          'UNEXPECTED_RESPONSE',
          'The server returned an unexpected error.',
        );
  }
  // Every response is validated against the shared contract.
  try {
    return parse(body);
  } catch {
    throw new ApiRequestError(
      response.status,
      'CONTRACT_MISMATCH',
      'The server response did not match the API contract.',
    );
  }
}

export const api = {
  health: (): Promise<HealthResponse> => call('/api/health', (b) => healthResponseSchema.parse(b)),
  createScan: (repoUrl: string): Promise<CreateScanResponse> =>
    call('/api/scans', (b) => createScanResponseSchema.parse(b), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoUrl }),
    }),
  getScan: (id: string): Promise<Scan> =>
    call(`/api/scans/${encodeURIComponent(id)}`, (b) => scanSchema.parse(b)),
  getReport: (id: string): Promise<Report> =>
    call(`/api/scans/${encodeURIComponent(id)}/report`, (b) => reportSchema.parse(b)),
  listScans: async (): Promise<ScanListItem[]> =>
    (await call('/api/scans', (b) => scanListResponseSchema.parse(b))).scans,
};

export function eventsUrl(id: string): string {
  return `/api/scans/${encodeURIComponent(id)}/events`;
}
