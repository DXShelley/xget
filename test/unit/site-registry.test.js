import { describe, expect, it, vi } from 'vitest';
import {
  handleConfiguredSiteRequest,
  handleConfiguredTargetRequest,
  isConfiguredPathAllowed
} from '../../src/proxy/handle-configured-site.js';
import { runFilters } from '../../src/filters/run-filters.js';
import {
  resolveSite,
  resolveSiteByAlias,
  resolveSiteByProxyHost,
  resolveSiteByTargetUrl,
  validateSiteDefinitions
} from '../../src/proxy/site-registry.js';

describe('site registry', () => {
  it('resolves only explicitly configured mirror hosts', () => {
    expect(resolveSite('git.dxshelley.fun')).toMatchObject({
      id: 'github',
      upstreamOrigin: 'https://github.com'
    });
    expect(resolveSite('claude.fast.dxshelley.fun')).toMatchObject({
      id: 'claude-web',
      upstreamOrigin: 'https://claude.com'
    });
    expect(resolveSite('code.claude.fast.dxshelley.fun')).toMatchObject({
      id: 'claude-code',
      upstreamOrigin: 'https://code.claude.com'
    });
    expect(resolveSite('untrusted.example')).toBeNull();
  });

  it('resolves configured sites by alias, isolated host, and exact HTTPS target origin', () => {
    expect(resolveSiteByAlias('claude-code')).toMatchObject({
      upstreamOrigin: 'https://code.claude.com'
    });
    expect(resolveSiteByProxyHost('claude-code.fast.dxshelley.fun')).toMatchObject({
      id: 'claude-code'
    });
    expect(
      resolveSiteByTargetUrl(new URL('https://code.claude.com/docs/zh-CN/quickstart'))
    ).toMatchObject({ id: 'claude-code' });
    expect(resolveSiteByTargetUrl(new URL('http://code.claude.com/docs'))).toBeNull();
    expect(resolveSiteByTargetUrl(new URL('https://github.com/owner/repository'))).toBeNull();
    expect(resolveSiteByTargetUrl(new URL('https://example.com/'))).toBeNull();
  });

  it('resolves only the configured public Google origins', () => {
    const publicSites = [
      ['google-dev-docs', 'https://developers.google.com'],
      ['google-public', 'https://www.google.com']
    ];

    for (const [alias, upstreamOrigin] of publicSites) {
      expect(resolveSiteByAlias(alias)).toMatchObject({ id: alias, upstreamOrigin });
      expect(resolveSiteByTargetUrl(new URL(`${upstreamOrigin}/docs`))).toMatchObject({
        id: alias
      });
    }

    expect(resolveSite('ai-studio.fast.dxshelley.fun')).toMatchObject({
      id: 'ai-studio',
      upstreamOrigin: 'https://aistudio.google.com'
    });
    expect(resolveSite('aistudio.google.fast.dxshelley.fun')).toBeNull();
    expect(resolveSiteByProxyHost('ai-google-dev-docs.fast.dxshelley.fun')).toBeNull();
    expect(resolveSiteByAlias('chatgpt-web')).toBeNull();
    expect(resolveSiteByAlias('cloud-docs')).toBeNull();
    expect(resolveSiteByAlias('openai-docs')).toBeNull();
    expect(resolveSiteByTargetUrl(new URL('https://ai.google.dev/'))).toBeNull();
    expect(resolveSiteByTargetUrl(new URL('https://evilgoogle.dev/'))).toBeNull();
    expect(resolveSiteByTargetUrl(new URL('https://accounts.google.com/'))).toBeNull();
  });

  it('rejects duplicate site routing keys during registration', () => {
    const site = {
      id: 'gemini-web',
      alias: 'gemini-web',
      mirrorHost: 'gemini.fast.dxshelley.fun',
      upstreamOrigin: 'https://gemini.google.com'
    };

    for (const key of ['id', 'alias', 'mirrorHost', 'upstreamOrigin']) {
      const distinctSite = {
        id: 'other-site',
        alias: 'other-site',
        mirrorHost: 'other.fast.dxshelley.fun',
        upstreamOrigin: 'https://other.example'
      };
      distinctSite[key] = site[key];
      expect(() => validateSiteDefinitions([site, distinctSite])).toThrow(`Duplicate site ${key}`);
    }
    expect(() => validateSiteDefinitions([site])).not.toThrow();
  });

  it('runs request and response filters in registration order', async () => {
    /** @type {{ events: string[] }} */
    const context = { events: [] };
    const result = await runFilters(context, [
      async value => ({ ...value, events: [...value.events, 'first'] }),
      async value => ({ ...value, events: [...value.events, 'second'] })
    ]);

    expect(result.events).toEqual(['first', 'second']);
  });

  it('enforces configured path policy without restricting all-path sites', () => {
    expect(isConfiguredPathAllowed({ proxyPolicy: { paths: 'all' } }, '/docs/quickstart')).toBe(
      true
    );
    expect(
      isConfiguredPathAllowed({ proxyPolicy: { paths: ['/docs/*'] } }, '/docs/quickstart')
    ).toBe(true);
    expect(isConfiguredPathAllowed({ proxyPolicy: { paths: ['/docs/*'] } }, '/api/private')).toBe(
      false
    );
  });

  it('proxies a configured mirror without accepting unconfigured hosts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream'));
    const response = await handleConfiguredSiteRequest(
      new Request('https://claude.fast.dxshelley.fun/products?plan=pro')
    );

    expect(await response?.text()).toBe('upstream');
    expect(fetchSpy.mock.calls[0][0]).toBe('https://claude.com/products?plan=pro');
    expect(
      await handleConfiguredSiteRequest(new Request('https://untrusted.example/products'))
    ).toBeNull();
  });

  it('does not forward browser credentials to a public configured site', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream'));
    await handleConfiguredSiteRequest(
      new Request('https://claude.fast.dxshelley.fun/products', {
        headers: { Authorization: 'Bearer secret', Cookie: 'session=secret' }
      })
    );

    const headers = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('Cookie')).toBeNull();
  });

  it('rejects WebSocket upgrades for configured sites without fetching upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    const response = await handleConfiguredSiteRequest(
      new Request('https://claude.fast.dxshelley.fun/socket', {
        headers: { Connection: 'Upgrade', Upgrade: 'websocket' }
      })
    );

    expect(response?.status).toBe(426);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('retries transient GET failures once but never retries a POST body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('ready'))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }));
    const callsBefore = fetchSpy.mock.calls.length;

    const getResponse = await handleConfiguredSiteRequest(
      new Request('https://claude.fast.dxshelley.fun/docs')
    );
    const postResponse = await handleConfiguredSiteRequest(
      new Request('https://claude.fast.dxshelley.fun/docs', { method: 'POST', body: 'message=hi' })
    );

    expect(getResponse?.status).toBe(200);
    expect(postResponse?.status).toBe(503);
    expect(fetchSpy).toHaveBeenCalledTimes(callsBefore + 3);
  });

  it('proxies an allowlisted target URL through the configured adapter', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream'));
    const response = await handleConfiguredTargetRequest(
      new Request('https://fast.dxshelley.fun/?target=https://code.claude.com/docs'),
      new URL('https://code.claude.com/docs/zh-CN/quickstart?source=fast')
    );

    expect(await response?.text()).toBe('upstream');
    expect(fetchSpy.mock.calls.at(-1)?.[0]).toBe(
      'https://code.claude.com/docs/zh-CN/quickstart?source=fast'
    );
  });
});
