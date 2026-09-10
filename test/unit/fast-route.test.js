import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConfig } from '../../src/config/index.js';
import { handleFastRoute } from '../../src/proxy/fast-route.js';

const AUTHENTICATED_BROWSER_PRINCIPAL = { authMethod: 'browser-session' };

describe('Fast route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for an unrelated host so another router can own it', async () => {
    const response = await handleFastRoute(
      new Request('https://git.dxshelley.fun/owner/repository'),
      new URL('https://git.dxshelley.fun/owner/repository')
    );
    expect(response).toBeNull();
  });

  it('redirects an allowlisted target to its isolated origin', async () => {
    const target = encodeURIComponent('https://code.claude.com/docs/zh-CN/quickstart');
    const response = await handleFastRoute(
      new Request(`https://fast.dxshelley.fun/?target=${target}`),
      new URL(`https://fast.dxshelley.fun/?target=${target}`)
    );

    expect(response?.headers.get('Location')).toBe(
      'https://claude-code.fast.dxshelley.fun/docs/zh-CN/quickstart'
    );
  });

  it('transparently proxies an unregistered HTTPS target only for an authenticated opt-in deployment', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('transparent'));
    const target = encodeURIComponent('https://example.com/resource?download=1');
    const response = await handleFastRoute(
      new Request(`https://fast.dxshelley.fun/?target=${target}`),
      new URL(`https://fast.dxshelley.fun/?target=${target}`),
      createConfig({ XGET_PROXY_TARGET_ALLOWLIST: 'false' }),
      AUTHENTICATED_BROWSER_PRINCIPAL
    );

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe('transparent');
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://example.com/resource?download=1');
  });

  it('does not forward proxy credentials or client identity headers transparently', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('transparent'));
    const target = encodeURIComponent('https://example.com/resource');
    await handleFastRoute(
      new Request(`https://fast.dxshelley.fun/?target=${target}`, {
        headers: {
          Authorization: 'Bearer proxy-secret',
          Cookie: 'session=proxy-secret',
          'X-Forwarded-For': '198.51.100.1'
        }
      }),
      new URL(`https://fast.dxshelley.fun/?target=${target}`),
      createConfig({ XGET_PROXY_TARGET_ALLOWLIST: 'false' }),
      AUTHENTICATED_BROWSER_PRINCIPAL
    );

    const headers = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('Cookie')).toBeNull();
    expect(headers.get('X-Forwarded-For')).toBeNull();
  });

  it('rejects an unregistered target by default', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const target = encodeURIComponent('https://example.com/resource');
    const response = await handleFastRoute(
      new Request(`https://fast.dxshelley.fun/?target=${target}`),
      new URL(`https://fast.dxshelley.fun/?target=${target}`),
      createConfig()
    );

    expect(response?.status).toBe(400);
    expect(await response?.text()).toBe('Invalid proxy target');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('requires a browser session when transparent proxying is enabled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const target = encodeURIComponent('https://example.com/resource');
    const request = new Request(`https://fast.dxshelley.fun/?target=${target}`);
    const url = new URL(request.url);
    const config = createConfig({ XGET_PROXY_TARGET_ALLOWLIST: 'false' });

    for (const principal of [undefined, { authMethod: 'compatibility' }]) {
      const response = await handleFastRoute(request, url, config, principal);
      expect(response?.status).toBe(400);
      expect(await response?.text()).toBe('Invalid proxy target');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects non-HTTPS and credential-bearing transparent targets', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const target of [
      'http://example.com/resource',
      'https://user:pass@example.com/resource'
    ]) {
      const encodedTarget = encodeURIComponent(target);
      const response = await handleFastRoute(
        new Request(`https://fast.dxshelley.fun/?target=${encodedTarget}`),
        new URL(`https://fast.dxshelley.fun/?target=${encodedTarget}`),
        createConfig({ XGET_PROXY_TARGET_ALLOWLIST: 'false' }),
        AUTHENTICATED_BROWSER_PRINCIPAL
      );
      expect(response?.status).toBe(400);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends an isolated host to its fixed configured upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream'));
    const response = await handleFastRoute(
      new Request('https://claude-code.fast.dxshelley.fun/docs/quickstart'),
      new URL('https://claude-code.fast.dxshelley.fun/docs/quickstart')
    );

    expect(response?.status).toBe(200);
    expect(fetchSpy.mock.calls.at(-1)?.[0]).toBe('https://code.claude.com/docs/quickstart');
  });
});
