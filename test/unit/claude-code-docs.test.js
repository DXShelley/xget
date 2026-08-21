import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleClaudeCodeDocsRequest } from '../../src/claude-code-docs/handle-request.js';

const site = { id: 'claude-code' };
const request = new Request('https://claude-code.fast.dxshelley.fun/docs/zh-CN/quickstart');
const targetUrl = new URL('https://code.claude.com/docs/zh-CN/quickstart');

describe('Claude Code documentation adapter', () => {
  /** @type {Response | null} */
  let cachedResponse;
  /** @type {{ match: ReturnType<typeof vi.fn>, put: ReturnType<typeof vi.fn> }} */
  let cacheDefault;

  beforeEach(() => {
    cachedResponse = null;
    cacheDefault = {
      match: vi.fn(async () => cachedResponse?.clone() || null),
      put: vi.fn(async (_key, response) => {
        cachedResponse = response.clone();
      })
    };
    vi.stubGlobal('caches', { default: cacheDefault });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not own another site or a non-documentation path', async () => {
    await expect(
      handleClaudeCodeDocsRequest({ request, site: { id: 'google-public' }, targetUrl })
    ).resolves.toBeNull();
    await expect(
      handleClaudeCodeDocsRequest({
        request,
        site,
        targetUrl: new URL('https://code.claude.com/api/status')
      })
    ).resolves.toBeNull();
  });

  it('serves the latest successful public document when the upstream later returns 500', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('healthy document', {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        })
      )
      .mockResolvedValue(new Response('upstream failure', { status: 500 }));

    const healthyResponse = await handleClaudeCodeDocsRequest({ request, site, targetUrl });
    const fallbackResponse = await handleClaudeCodeDocsRequest({ request, site, targetUrl });

    expect(await healthyResponse?.text()).toBe('healthy document');
    expect(cacheDefault.put).toHaveBeenCalledTimes(1);
    expect(await fallbackResponse?.text()).toBe('healthy document');
    expect(fallbackResponse?.headers.get('X-Xget-Cache')).toBe('stale');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('serves the cached document when the upstream request fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('healthy document', { status: 200 }))
      .mockRejectedValue(new Error('network unavailable'));

    await handleClaudeCodeDocsRequest({ request, site, targetUrl });
    const fallbackResponse = await handleClaudeCodeDocsRequest({ request, site, targetUrl });

    expect(await fallbackResponse?.text()).toBe('healthy document');
    expect(fallbackResponse?.headers.get('X-Xget-Cache')).toBe('stale');
  });
});
