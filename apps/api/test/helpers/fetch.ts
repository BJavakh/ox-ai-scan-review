import type { FetchFn } from '../../src/lib/http.js';

export type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

/** A fetch that records calls and delegates to a handler. */
export function fakeFetch(handler: Handler): FetchFn & { calls: URL[] } {
  const calls: URL[] = [];
  const fn = async (input: Parameters<FetchFn>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url);
    init?.signal?.throwIfAborted();
    return handler(url, init);
  };
  const recorded: FetchFn & { calls: URL[] } = Object.assign(fn, { calls });
  return recorded;
}

export const signal = () => new AbortController().signal;

export function status(code: number, headers: Record<string, string> = {}): Response {
  return new Response(code === 204 ? null : JSON.stringify({ message: 'x' }), {
    status: code,
    headers,
  });
}
