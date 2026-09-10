import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRequestContext } from '../../src/app/request-context.js';
import { CONFIG } from '../../src/config/index.js';
import { finalizeResponse } from '../../src/response/finalize-response.js';
import { tryReadCachedResponse } from '../../src/upstream/cache.js';
import { fetchUpstreamResponse } from '../../src/upstream/fetch-upstream.js';
import { PerformanceMonitor } from '../../src/utils/performance.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Pipeline modules', () => {
  it('reuses cached full content for range requests through the cache helper', async () => {
    const cache = {
      match: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          new Response('full-body', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
          })
        )
    };
    const monitor = new PerformanceMonitor();
    const markSpy = vi.spyOn(monitor, 'mark');
    const request = new Request('https://example.com/gh/user/repo/file.txt', {
      headers: { Range: 'bytes=0-3' }
    });

    const response = await tryReadCachedResponse({
      cache: /** @type {Cache} */ (/** @type {unknown} */ (cache)),
      cacheTargetUrl: 'https://github.com/user/repo/file.txt',
      canUseCache: true,
      hasSensitiveHeaders: false,
      monitor,
      request,
      requestContext: createRequestContext(request, {})
    });

    expect(await response?.text()).toBe('full-body');
    expect(markSpy).toHaveBeenCalledWith('cache_hit_full_content');
  });

  it('retries upstream fetches through the transport helper before succeeding', async () => {
    const request = new Request('https://example.com/gh/user/repo/file.txt');
    const requestContext = createRequestContext(request, {});
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('temporary-network-error'))
      .mockResolvedValueOnce(
        new Response('ok', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        })
      );

    const result = await fetchUpstreamResponse({
      authorization: null,
      canUseCache: true,
      config: { ...CONFIG, MAX_RETRIES: 2, RETRY_DELAY_MS: 0 },
      effectivePath: '/gh/user/repo/file.txt',
      monitor: new PerformanceMonitor(),
      platform: 'gh',
      request,
      requestContext,
      shouldPassthroughRequest: false,
      targetUrl: 'https://github.com/user/repo/file.txt'
    });

    expect(result.responseGeneratedLocally).toBe(false);
    expect(result.response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('caps retry waits by the total request deadline', async () => {
    const request = new Request('https://example.com/gh/user/repo/file.txt');
    const requestContext = createRequestContext(request, {});
    /** @type {number[]} */
    const timeoutDelays = [];
    let timerCall = 0;

    vi.stubGlobal(
      'setTimeout',
      vi.fn((callback, delay) => {
        timerCall++;
        timeoutDelays.push(delay);
        if (timerCall === 2) {
          callback();
        }
        return { timerCall };
      })
    );
    vi.stubGlobal('clearTimeout', vi.fn());
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('temporary-network-error'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const result = await fetchUpstreamResponse({
      authorization: null,
      canUseCache: true,
      config: { ...CONFIG, MAX_RETRIES: 2, RETRY_DELAY_MS: 10000, TIMEOUT_SECONDS: 1 },
      effectivePath: '/gh/user/repo/file.txt',
      monitor: new PerformanceMonitor(),
      platform: 'gh',
      request,
      requestContext,
      shouldPassthroughRequest: false,
      targetUrl: 'https://github.com/user/repo/file.txt'
    });

    expect(result.response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(timeoutDelays.every(delay => delay <= 1000)).toBe(true);
  });

  it('rewrites npm metadata without retaining a stale streamed content length', async () => {
    const request = new Request('https://example.com/npm/pkg');
    const requestContext = createRequestContext(request, {});
    const upstreamBody = JSON.stringify({
      dist: {
        tarball: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz'
      }
    });

    const response = await finalizeResponse({
      cache: null,
      cacheTargetUrl: 'https://registry.npmjs.org/pkg',
      canUseCache: true,
      config: CONFIG,
      ctx: /** @type {ExecutionContext} */ ({ waitUntil() {}, passThroughOnException() {} }),
      effectivePath: '/npm/pkg',
      hasSensitiveHeaders: false,
      monitor: new PerformanceMonitor(),
      platform: 'npm',
      request,
      requestContext,
      response: new Response(upstreamBody, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(upstreamBody.length)
        }
      }),
      responseGeneratedLocally: false,
      url: new URL(request.url)
    });
    const body = await response.text();

    expect(body).toContain('https://example.com/npm/pkg/-/pkg-1.0.0.tgz');
    expect(response.headers.get('Content-Length')).toBeNull();
  });

  it('preserves upstream CSP for proxied HTML responses', async () => {
    const request = new Request('https://example.com/gh/user/repo');
    const requestContext = createRequestContext(request, {});
    const upstreamCsp = "default-src 'none'; style-src 'self' https://github.githubassets.com";

    const response = await finalizeResponse({
      cache: null,
      cacheTargetUrl: 'https://github.com/user/repo',
      canUseCache: true,
      config: CONFIG,
      ctx: /** @type {ExecutionContext} */ ({ waitUntil() {}, passThroughOnException() {} }),
      effectivePath: '/gh/user/repo',
      hasSensitiveHeaders: false,
      monitor: new PerformanceMonitor(),
      platform: 'gh',
      request,
      requestContext,
      response: new Response('<html><head></head></html>', {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': upstreamCsp
        }
      }),
      responseGeneratedLocally: false,
      url: new URL(request.url)
    });

    expect(response.headers.get('Content-Security-Policy')).toBe(upstreamCsp);
  });
});
