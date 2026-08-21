import { describe, expect, it, vi } from 'vitest';
import { handleConfiguredSiteRequest } from '../../src/proxy/handle-configured-site.js';
import { runFilters } from '../../src/proxy/filter-chain.js';
import { resolveSite } from '../../src/proxy/site-registry.js';

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

  it('runs request and response filters in registration order', async () => {
    /** @type {{ events: string[] }} */
    const context = { events: [] };
    const result = await runFilters(context, [
      async value => ({ ...value, events: [...value.events, 'first'] }),
      async value => ({ ...value, events: [...value.events, 'second'] })
    ]);

    expect(result.events).toEqual(['first', 'second']);
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
});
