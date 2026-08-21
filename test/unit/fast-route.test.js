import { describe, expect, it, vi } from 'vitest';

import { handleFastRoute } from '../../src/proxy/fast-route.js';

describe('Fast route', () => {
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
