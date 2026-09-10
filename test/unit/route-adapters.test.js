import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRequestContext } from '../../src/app/request-context.js';
import {
  handleApplicationRoute,
  resolveRouteFeature
} from '../../src/app/route-adapters/registry.js';

afterEach(() => vi.restoreAllMocks());

describe('application route adapters', () => {
  it.each([
    [
      'public-page',
      'public-page',
      new Request('https://example-public.fast.dxshelley.fun/guide'),
      { PAGE_MAP: {}, XGET_PROXY_TARGET_ALLOWLIST: 'false' }
    ],
    ['web-site', 'web-site', new Request('https://claude-ai.fast.dxshelley.fun/'), {}],
    ['github', 'github', new Request('https://git.dxshelley.fun/openai/codex'), {}],
    [
      'configured-site',
      'configured-site',
      new Request('https://claude-code.fast.dxshelley.fun/docs/start'),
      {}
    ],
    ['fast', 'fast', new Request('https://fast.dxshelley.fun/npm/example'), {}],
    [
      'none',
      'none',
      new Request('https://docker.fast.dxshelley.fun/v2/library/alpine/tags/list'),
      {}
    ]
  ])('fixes the %s route strategy at request entry', (feature, adapterKind, request, env) => {
    const context = createRequestContext(request, env);

    expect(context.routeFeature || 'none').toBe(feature);
    expect(context.routeAdapter?.kind || 'none').toBe(adapterKind);
    expect(context.routeAdapter === null || Object.isFrozen(context.routeAdapter)).toBe(true);
    expect(resolveRouteFeature(context) || 'none').toBe(feature);
  });

  it('keeps registered host ownership ahead of protocol-shaped paths', () => {
    const context = createRequestContext(
      new Request('https://claude-code.fast.dxshelley.fun/v2/library/alpine/manifests/latest'),
      {}
    );

    expect(context.protocolFeature).toBe('web');
    expect(context.routeFeature).toBe('configured-site');
    expect(context.routeAdapter?.kind).toBe('configured-site');
  });

  it('executes only the selected configured-site strategy', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    const context = createRequestContext(
      new Request('https://claude-code.fast.dxshelley.fun/docs/quickstart'),
      {}
    );

    const result = await handleApplicationRoute(context);

    expect(result?.response.status).toBe(503);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://code.claude.com/docs/quickstart');
  });

  it('does not re-resolve a route strategy after request entry', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const context = createRequestContext(
      new Request('https://claude-code.fast.dxshelley.fun/docs/quickstart'),
      {}
    );

    expect(await handleApplicationRoute({ ...context, routeAdapter: null })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('routes a configured host through its strategy without normalizing double slashes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const context = createRequestContext(
      new Request('https://google-dev-docs.fast.dxshelley.fun//outside.example/path?q=1'),
      {}
    );

    const result = await handleApplicationRoute(context);

    expect(result?.response.status).toBe(200);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://developers.google.com//outside.example/path?q=1'
    );
  });
});
