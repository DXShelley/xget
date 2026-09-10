import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConfig } from '../../src/config/index.js';
import { handleFastRoute } from '../../src/proxy/fast-route.js';
import { getBrowserSites } from '../../src/proxy/site-registry.js';

const AUTHENTICATED_BROWSER_PRINCIPAL = { authMethod: 'browser-session' };

function transparentConfig(overrides = {}) {
  return createConfig({ XGET_PROXY_TARGET_ALLOWLIST: 'false', ...overrides });
}

function authenticatedTransparentOptions() {
  return { principal: AUTHENTICATED_BROWSER_PRINCIPAL };
}

describe('Fast route', () => {
  it.each(['https://code.claude.com', 'https://ai.google.dev'])(
    'keeps double-slash target paths on the registered mirror for %s',
    async origin => {
      const url = new URL('https://fast.dxshelley.fun/');
      url.searchParams.set('target', `${origin}//outside.example/path?q=1#section`);
      const response = await handleFastRoute(new Request(url), url);
      const location = new URL(response?.headers.get('Location') || '');
      expect(location.hostname.endsWith('.fast.dxshelley.fun')).toBe(true);
      expect(location.pathname).toBe('//outside.example/path');
      expect(location.search).toBe('?q=1');
      expect(location.hash).toBe('#section');
    }
  );

  it('keeps a double-slash alias path on the configured upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const url = new URL('https://fast.dxshelley.fun/_/google-dev-docs//outside.example/path?q=1');
    const response = await handleFastRoute(new Request(url), url);
    expect(response?.status).toBe(200);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://developers.google.com//outside.example/path?q=1'
    );
  });

  it('preserves POST semantics when a transparent redirect reaches a registered site', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 308,
        headers: { Location: 'https://code.claude.com/submit' }
      })
    );
    const url = new URL('https://fast.dxshelley.fun/?target=https%3A%2F%2Fexample.com%2Fsubmit');
    const config = transparentConfig({ ALLOWED_METHODS: 'GET,HEAD,POST' });
    const init = { method: 'POST', body: 'payload=unchanged' };
    const response = await handleFastRoute(
      new Request(url, init),
      url,
      config,
      authenticatedTransparentOptions()
    );
    const next = new URL(response?.headers.get('Location') || '', url);
    const redirect = await handleFastRoute(new Request(next, init), next, config);
    expect(redirect?.status).toBe(307);
    expect(redirect?.headers.get('Location')).toBe('https://claude-code.fast.dxshelley.fun/submit');
  });

  it('allows same-origin challenge connections without allowing external connections', async () => {
    const url = new URL('https://fast.dxshelley.fun/');
    const response = await handleFastRoute(new Request(url), url);
    const directives = response?.headers.get('Content-Security-Policy')?.split('; ');
    expect(directives).toContain("connect-src 'self'");
    expect(directives).toContain("default-src 'none'");
    expect(directives?.find(value => value.startsWith('form-action '))).toContain("'self'");
  });

  it('permits form redirects only to self and the exact registered mirror origins', async () => {
    const url = new URL('https://fast.dxshelley.fun/');
    const entry = await handleFastRoute(new Request(url), url);
    const policy = entry?.headers.get('Content-Security-Policy') || '';
    const sources = policy
      .split('; ')
      .find(value => value.startsWith('form-action '))
      ?.split(' ')
      .slice(1);
    const expected = new Set(["'self'"]);
    for (const site of getBrowserSites()) {
      const target = new URL(url);
      target.searchParams.set('target', site.upstreamOrigin);
      const response = await handleFastRoute(new Request(target), target);
      expected.add(new URL(response?.headers.get('Location') || '').origin);
    }
    expect(new Set(sources)).toEqual(expected);
  });

  it('preserves the fragment when redirecting a registered target', async () => {
    const url = new URL('https://fast.dxshelley.fun/');
    url.searchParams.set('target', 'https://code.claude.com/docs?q=1#install');
    const response = await handleFastRoute(new Request(url), url);
    expect(response?.headers.get('Location')).toBe(
      'https://claude-code.fast.dxshelley.fun/docs?q=1#install'
    );
  });

  it.each(['GET', 'HEAD'])('handles the entry favicon locally for %s', async method => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const url = new URL('https://fast.dxshelley.fun/favicon.ico');
    const response = await handleFastRoute(new Request(url, { method }), url);
    expect(response?.status).toBe(204);
    expect(response?.headers.has('Location')).toBe(false);
    expect(await response?.text()).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([301, 302, 303, 307, 308])(
    'keeps upstream %s redirects on the proxy origin',
    async status => {
      const destination = 'https://learn.chatgpt.com/docs/changelog';
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, {
          status,
          headers: { Location: destination, Refresh: `0;url=${destination}` }
        })
      );
      const url = new URL('https://fast.dxshelley.fun/');
      url.searchParams.set('target', 'https://developers.openai.com/codex/changelog');
      const response = await handleFastRoute(
        new Request(url),
        url,
        transparentConfig(),
        authenticatedTransparentOptions()
      );
      expect(response?.status).toBe(status);
      const location = new URL(response?.headers.get('Location') || '', url);
      expect(location.origin).toBe(url.origin);
      expect(location.pathname).toBe('/');
      expect(location.searchParams.get('target')).toBe(destination);
      expect(response?.headers.has('Refresh')).toBe(false);
      expect(fetchSpy.mock.calls[0]?.[1]?.redirect).toBe('manual');
    }
  );

  it('resolves relative redirect URLs against the upstream and follows the proxy chain', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: '../next?q=1#section' } })
      )
      .mockResolvedValueOnce(new Response('destination'));
    const url = new URL(
      'https://fast.dxshelley.fun/?target=https%3A%2F%2Fexample.com%2Fdocs%2Fstart'
    );
    const config = transparentConfig();
    const response = await handleFastRoute(
      new Request(url),
      url,
      config,
      authenticatedTransparentOptions()
    );
    const location = new URL(response?.headers.get('Location') || '', url);
    expect(location.origin).toBe(url.origin);
    expect(location.searchParams.get('target')).toBe('https://example.com/next?q=1#section');
    expect(location.hash).toBe('#section');
    const destination = await handleFastRoute(
      new Request(location),
      location,
      config,
      authenticatedTransparentOptions()
    );
    expect(await destination?.text()).toBe('destination');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each([
    'http://example.com/',
    'https://user:pass@example.com/',
    // eslint-disable-next-line no-script-url -- Untrusted upstream input must be rejected.
    'javascript:alert(1)',
    'https://['
  ])('rejects an unsafe upstream redirect: %s', async location => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 308,
        headers: { Location: location, Refresh: `0;url=${location}` }
      })
    );
    const url = new URL('https://fast.dxshelley.fun/?target=https%3A%2F%2Fexample.com%2F');
    const response = await handleFastRoute(
      new Request(url),
      url,
      transparentConfig(),
      authenticatedTransparentOptions()
    );
    expect(response?.status).toBe(502);
    expect(response?.headers.has('Location')).toBe(false);
    expect(response?.headers.has('Refresh')).toBe(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([307, 308])(
    'preserves POST bodies when the client follows a %s redirect',
    async status => {
      /** @type {string[]} */
      const bodies = [];
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        bodies.push(await new Response(init?.body).text());
        return bodies.length === 1
          ? new Response(null, { status, headers: { Location: 'https://next.example/submit' } })
          : new Response('accepted');
      });
      const config = transparentConfig({ ALLOWED_METHODS: 'GET,HEAD,POST' });
      const url = new URL('https://fast.dxshelley.fun/?target=https%3A%2F%2Fexample.com%2Fsubmit');
      const init = { method: 'POST', body: 'payload=unchanged' };
      const redirect = await handleFastRoute(
        new Request(url, init),
        url,
        config,
        authenticatedTransparentOptions()
      );
      expect(redirect?.status).toBe(status);
      const next = new URL(redirect?.headers.get('Location') || '', url);
      const response = await handleFastRoute(
        new Request(next, init),
        next,
        config,
        authenticatedTransparentOptions()
      );
      expect(await response?.text()).toBe('accepted');
      expect(bodies).toEqual(['payload=unchanged', 'payload=unchanged']);
      expect(fetchSpy.mock.calls.map(call => call[1]?.method)).toEqual(['POST', 'POST']);
    }
  );

  it('does not change successful responses that carry a Location header', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('created', {
        status: 201,
        headers: { Location: 'https://example.com/items/1' }
      })
    );
    const url = new URL('https://fast.dxshelley.fun/?target=https%3A%2F%2Fexample.com%2F');
    const response = await handleFastRoute(
      new Request(url),
      url,
      transparentConfig(),
      authenticatedTransparentOptions()
    );
    expect(response?.status).toBe(201);
    expect(response?.headers.get('Location')).toBe('https://example.com/items/1');
    expect(await response?.text()).toBe('created');
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
      transparentConfig(),
      authenticatedTransparentOptions()
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
      transparentConfig(),
      authenticatedTransparentOptions()
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
    const config = transparentConfig();

    for (const principal of [undefined, { authMethod: 'compatibility' }]) {
      const response = await handleFastRoute(request, url, config, { principal });
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
        transparentConfig(),
        authenticatedTransparentOptions()
      );
      expect(response?.status).toBe(400);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
