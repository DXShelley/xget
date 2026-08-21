import { afterEach, describe, expect, it, vi } from 'vitest';

import { PerformanceMonitor, addPerformanceHeaders } from '../../src/utils/performance.js';
import {
  filterPlatformTextResponse as rewriteTextResponse,
  isFlatpakReferenceFilePath,
  shouldFilterPlatformTextResponse as shouldRewriteTextResponse
} from '../../src/platforms/response-filters.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Runtime helper coverage', () => {
  it('serializes performance metrics and warns on duplicate marks', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const monitor = new PerformanceMonitor();

    monitor.mark('request-start');
    monitor.mark('request-start');
    monitor.mark('complete');

    const response = addPerformanceHeaders(
      new Response('ok', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      }),
      monitor
    );
    const metrics = JSON.parse(response.headers.get('X-Performance-Metrics') || '{}');

    expect(warnSpy).toHaveBeenCalledWith('Mark with name request-start already exists.');
    expect(metrics).toHaveProperty('request-start');
    expect(metrics).toHaveProperty('complete');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('removes the legacy restrictive CSP from cached proxied responses', () => {
    const monitor = new PerformanceMonitor();
    const response = addPerformanceHeaders(
      new Response('<html></html>', {
        status: 200,
        headers: {
          'Content-Security-Policy': "default-src 'none'; img-src 'self'; script-src 'none'",
          'X-Content-Type-Options': 'nosniff'
        }
      }),
      monitor,
      { isProxiedResponse: true }
    );

    expect(response.headers.has('Content-Security-Policy')).toBe(false);
  });

  it('preserves an upstream CSP on proxied responses', () => {
    const monitor = new PerformanceMonitor();
    const upstreamCsp = "default-src 'none'; style-src https://github.githubassets.com";
    const response = addPerformanceHeaders(
      new Response('<html></html>', {
        status: 200,
        headers: { 'Content-Security-Policy': upstreamCsp }
      }),
      monitor,
      { isProxiedResponse: true }
    );

    expect(response.headers.get('Content-Security-Policy')).toBe(upstreamCsp);
  });

  it('exposes cache hit, miss, and bypass status separately', () => {
    const hitMonitor = new PerformanceMonitor();
    hitMonitor.mark('cache_hit');
    expect(
      addPerformanceHeaders(new Response('hit'), hitMonitor).headers.get('X-Cache-Status')
    ).toBe('HIT');

    const missMonitor = new PerformanceMonitor();
    missMonitor.mark('cache_miss');
    expect(
      addPerformanceHeaders(new Response('miss'), missMonitor).headers.get('X-Cache-Status')
    ).toBe('MISS');

    const bypassMonitor = new PerformanceMonitor();
    bypassMonitor.mark('cache_bypass');
    expect(
      addPerformanceHeaders(new Response('bypass'), bypassMonitor).headers.get('X-Cache-Status')
    ).toBe('BYPASS');
  });

  it('rewrites only supported upstream response types', () => {
    expect(shouldRewriteTextResponse('pypi', '/pypi/simple/demo/', 'text/html')).toBe(true);
    expect(shouldRewriteTextResponse('npm', '/npm/demo', 'application/json')).toBe(true);
    expect(
      shouldRewriteTextResponse(
        'flathub',
        '/flathub/repo/demo.flatpakrepo',
        'application/octet-stream'
      )
    ).toBe(true);
    expect(shouldRewriteTextResponse('gh', '/gh/user/repo/file.txt', 'text/plain')).toBe(false);

    expect(isFlatpakReferenceFilePath('/flathub/repo/demo.flatpakref')).toBe(true);
    expect(isFlatpakReferenceFilePath('/flathub/repo/summary')).toBe(false);

    expect(
      rewriteTextResponse(
        'flathub',
        '/flathub/repo/demo.flatpakrepo',
        'Url=https://dl.flathub.org/repo/',
        'https://example.com'
      )
    ).toContain('https://example.com/flathub/repo/');
    expect(
      rewriteTextResponse('gh', '/gh/user/repo/file.txt', 'unchanged', 'https://example.com')
    ).toBe('unchanged');
  });
});
