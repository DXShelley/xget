import { describe, expect, it, vi } from 'vitest';

import worker from '../../src/index.js';
import { handleWebAdapterRequest } from '../../src/web-adapters/handle-request.js';
import { resolveWebAdapterRoute } from '../../src/web-adapters/routing.js';

const executionContext = { waitUntil() {}, passThroughOnException() {} };

describe('authenticated web adapters', () => {
  it('routes only registered primary and resource origins', () => {
    const aiGoogleDocsRequest = new Request('https://ai-google-dev-docs.fast.dxshelley.fun/');
    expect(
      resolveWebAdapterRoute(aiGoogleDocsRequest, new URL(aiGoogleDocsRequest.url))
    ).toMatchObject({
      site: { id: 'ai-google-dev-docs' },
      upstreamUrl: 'https://ai.google.dev/'
    });

    const claudeRequest = new Request('https://claude-ai.fast.dxshelley.fun/chat');
    expect(resolveWebAdapterRoute(claudeRequest, new URL(claudeRequest.url))).toMatchObject({
      site: { id: 'claude-ai-web' },
      upstreamHost: 'claude.ai',
      upstreamUrl: 'https://claude.ai/chat'
    });

    const claudeAssetRequest = new Request(
      'https://claude-ai.fast.dxshelley.fun/_site/resource/assets.claude.ai/app.js'
    );
    expect(
      resolveWebAdapterRoute(claudeAssetRequest, new URL(claudeAssetRequest.url))
    ).toMatchObject({
      site: { id: 'claude-ai-web' },
      upstreamUrl: 'https://assets.claude.ai/app.js'
    });

    const geminiRequest = new Request('https://gemini.fast.dxshelley.fun/app');
    expect(resolveWebAdapterRoute(geminiRequest, new URL(geminiRequest.url))).toMatchObject({
      site: { id: 'gemini-web' },
      upstreamUrl: 'https://gemini.google.com/app'
    });

    const aiStudioRequest = new Request('https://ai-studio.fast.dxshelley.fun/');
    expect(resolveWebAdapterRoute(aiStudioRequest, new URL(aiStudioRequest.url))).toMatchObject({
      site: { id: 'ai-studio' },
      upstreamUrl: 'https://aistudio.google.com/'
    });

    const identityRequest = new Request('https://google-identity.fast.dxshelley.fun/signin');
    expect(resolveWebAdapterRoute(identityRequest, new URL(identityRequest.url))).toMatchObject({
      site: { id: 'google-identity' },
      upstreamUrl: 'https://accounts.google.com/signin'
    });
  });

  it('handles Gemini, AI Studio, and Google Identity hosts before platform routing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream'));
    fetchSpy.mockClear();

    const geminiResponse = await worker.fetch(
      new Request('https://gemini.fast.dxshelley.fun/app'),
      {},
      executionContext
    );
    const identityResponse = await worker.fetch(
      new Request('https://google-identity.fast.dxshelley.fun/signin'),
      {},
      executionContext
    );
    const aiStudioResponse = await worker.fetch(
      new Request('https://ai-studio.fast.dxshelley.fun/'),
      {},
      executionContext
    );

    expect(geminiResponse.status).toBe(200);
    expect(identityResponse.status).toBe(200);
    expect(aiStudioResponse.status).toBe(200);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://gemini.google.com/app');
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('https://accounts.google.com/signin');
    expect(fetchSpy.mock.calls[2]?.[0]).toBe('https://aistudio.google.com/');
  });

  it('keeps authorization on the primary origin and rewrites Google Identity redirects', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy
      .mockResolvedValueOnce(new Response('primary'))
      .mockResolvedValueOnce(new Response('asset'))
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { Location: 'https://accounts.google.com/signin' },
          status: 302
        })
      );

    await handleWebAdapterRequest({
      request: new Request('https://gemini.fast.dxshelley.fun/app', {
        headers: { Authorization: 'Bearer primary-token' }
      }),
      url: new URL('https://gemini.fast.dxshelley.fun/app')
    });
    await handleWebAdapterRequest({
      request: new Request(
        'https://gemini.fast.dxshelley.fun/_site/resource/www.gstatic.com/app.js',
        { headers: { Authorization: 'Bearer primary-token' } }
      ),
      url: new URL('https://gemini.fast.dxshelley.fun/_site/resource/www.gstatic.com/app.js')
    });
    const redirectResponse = await handleWebAdapterRequest({
      request: new Request('https://gemini.fast.dxshelley.fun/app'),
      url: new URL('https://gemini.fast.dxshelley.fun/app')
    });

    const primaryHeaders = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers);
    const assetHeaders = new Headers(fetchSpy.mock.calls[1]?.[1]?.headers);
    expect(primaryHeaders.get('Authorization')).toBe('Bearer primary-token');
    expect(assetHeaders.get('Authorization')).toBeNull();
    expect(redirectResponse?.headers.get('Location')).toBe(
      'https://google-identity.fast.dxshelley.fun/signin'
    );
  });
});
