import { describe, expect, it } from 'vitest';
import {
  ResponseTooLargeError,
  UpstreamHttpError,
  UpstreamNetworkError,
  readBodyCapped,
  request,
} from '../../src/lib/http.js';
import { fakeFetch, status } from '../helpers/fetch.js';

const url = new URL('https://api.github.com/x');
const base = { timeoutMs: 1000, backoffMs: 0 };

describe('request', () => {
  it('retries 5xx and 429 up to the limit, then returns the last response', async () => {
    let n = 0;
    const fetchFn = fakeFetch(() => (++n < 3 ? status(n === 1 ? 503 : 429) : status(200)));
    const res = await request(fetchFn, url, { ...base, retries: 2 });
    expect(res.status).toBe(200);
    expect(fetchFn.calls).toHaveLength(3);
  });

  it('does not retry 4xx and does not retry when retries is 0', async () => {
    const notFound = fakeFetch(() => status(404));
    expect((await request(notFound, url, { ...base, retries: 2 })).status).toBe(404);
    expect(notFound.calls).toHaveLength(1);

    const flaky = fakeFetch(() => status(503));
    expect((await request(flaky, url, { ...base, retries: 0 })).status).toBe(503);
    expect(flaky.calls).toHaveLength(1);
  });

  it('retries network errors and then throws a typed error', async () => {
    const fetchFn = fakeFetch(() => {
      throw new TypeError('socket hang up');
    });
    await expect(request(fetchFn, url, { ...base, retries: 1 })).rejects.toBeInstanceOf(
      UpstreamNetworkError,
    );
    expect(fetchFn.calls).toHaveLength(2);
  });

  it('times out slow responses', async () => {
    const fetchFn = fakeFetch(
      (_u, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('timeout', 'TimeoutError'));
          });
        }),
    );
    await expect(request(fetchFn, url, { timeoutMs: 20, retries: 0 })).rejects.toBeInstanceOf(
      UpstreamNetworkError,
    );
  });

  it('throws the parent signal reason immediately when aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('scan deadline');
    controller.abort(reason);
    await expect(
      request(
        fakeFetch(() => status(200)),
        url,
        { ...base, signal: controller.signal },
      ),
    ).rejects.toBe(reason);
  });

  it('follows redirects only within the allowed origin', async () => {
    const same = fakeFetch((u) =>
      u.pathname === '/x' ? status(301, { location: '/repositories/1' }) : status(200),
    );
    const res = await request(same, url, { ...base, redirectOrigin: 'https://api.github.com' });
    expect(res.status).toBe(200);
    expect(same.calls.map((c) => c.pathname)).toEqual(['/x', '/repositories/1']);

    const offsite = fakeFetch(() => status(302, { location: 'http://169.254.169.254/latest' }));
    await expect(
      request(offsite, url, { ...base, redirectOrigin: 'https://api.github.com' }),
    ).rejects.toBeInstanceOf(UpstreamHttpError);
    expect(offsite.calls).toHaveLength(1);
  });
});

describe('readBodyCapped', () => {
  it('reads bodies under the cap', async () => {
    expect(await readBodyCapped(new Response('hello'), 10)).toBe('hello');
  });

  it('rejects by content-length before reading', async () => {
    const res = new Response('x', { headers: { 'content-length': '999999' } });
    await expect(readBodyCapped(res, 100)).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it('stops streaming once the cap is crossed', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(64));
      },
    });
    await expect(readBodyCapped(new Response(stream), 200)).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
    expect(pulled).toBeLessThan(10);
  });
});
