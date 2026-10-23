export type FetchFn = typeof fetch;

/** Non-2xx response from an upstream after retries. Carries status and headers for mapping. */
export class UpstreamHttpError extends Error {
  constructor(
    readonly status: number,
    readonly headers: Headers,
  ) {
    super(`Upstream responded with HTTP ${String(status)}`);
    this.name = 'UpstreamHttpError';
  }
}

/** Network failure or per-request timeout after all retries. */
export class UpstreamNetworkError extends Error {
  constructor(options?: ErrorOptions) {
    super('Upstream request failed', options);
    this.name = 'UpstreamNetworkError';
  }
}

export class ResponseTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Response exceeded ${String(limitBytes)} bytes`);
    this.name = 'ResponseTooLargeError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** Parent signal (the scan deadline). If it aborts, its reason is thrown immediately. */
  signal?: AbortSignal;
  /** Extra attempts after the first, only for read-only requests. */
  retries?: number;
  backoffMs?: number;
  /** Redirects are followed only within this origin; otherwise they are errors. */
  redirectOrigin?: string;
}

const MAX_REDIRECTS = 3;
const MAX_RETRY_AFTER_MS = 5_000;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason;
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelay(attempt: number, base: number, headers?: Headers): number {
  const retryAfter = Number(headers?.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS);
  }
  return base * 2 ** attempt + Math.floor(Math.random() * Math.min(base, 100));
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // ignore: we only want to free the socket
  }
}

/**
 * fetch with a per-attempt timeout, bounded retries with exponential backoff
 * (network errors, 5xx, 429), same-origin-only redirects, and parent-signal
 * cancellation. Returns 2xx and 4xx responses; throws on exhausted retries.
 */
export async function request(
  fetchFn: FetchFn,
  url: URL,
  options: RequestOptions,
): Promise<Response> {
  const retries = options.retries ?? 0;
  const backoffMs = options.backoffMs ?? 300;
  let target = url;
  let redirects = 0;

  for (let attempt = 0; ;) {
    throwIfAborted(options.signal);
    const signals = [AbortSignal.timeout(options.timeoutMs)];
    if (options.signal) signals.push(options.signal);

    let response: Response;
    try {
      response = await fetchFn(target, {
        method: options.method ?? 'GET',
        headers: options.headers,
        body: options.body,
        redirect: 'manual',
        signal: AbortSignal.any(signals),
      });
    } catch (error) {
      throwIfAborted(options.signal);
      if (attempt >= retries) throw new UpstreamNetworkError({ cause: error });
      await sleep(retryDelay(attempt, backoffMs), options.signal);
      attempt += 1;
      continue;
    }

    if (response.status >= 300 && response.status < 400) {
      await discard(response);
      const location = response.headers.get('location');
      const next = location === null ? null : new URL(location, target);
      if (next === null || next.origin !== options.redirectOrigin || redirects >= MAX_REDIRECTS) {
        throw new UpstreamHttpError(response.status, response.headers);
      }
      target = next;
      redirects += 1;
      continue;
    }

    if (isRetryableStatus(response.status) && attempt < retries) {
      await discard(response);
      await sleep(retryDelay(attempt, backoffMs, response.headers), options.signal);
      attempt += 1;
      continue;
    }
    return response;
  }
}

/** Read a body as UTF-8, aborting as soon as it exceeds `maxBytes`. */
export async function readBodyCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response);
    throw new ResponseTooLargeError(maxBytes);
  }
  if (!response.body) return '';

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new ResponseTooLargeError(maxBytes);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Parse JSON without letting a parse error escape as anything but a typed failure. */
export function safeJsonParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}
