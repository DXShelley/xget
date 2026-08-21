import { describe, expect, it } from 'vitest';

import { finalizeConfiguredResponse } from '../../src/proxy/configured-response.js';

describe('configured response finalizer', () => {
  const site = {
    browserCapabilities: { rewriteSameOriginRedirects: true },
    upstreamOrigin: 'https://code.claude.com'
  };

  it('rewrites same-site redirects to the current proxy origin', async () => {
    const response = await finalizeConfiguredResponse({
      request: new Request('https://claude-code.fast.dxshelley.fun/docs/start'),
      response: new Response(null, {
        status: 302,
        headers: { Location: 'https://code.claude.com/docs/next?locale=zh-CN' }
      }),
      site,
      targetUrl: new URL('https://code.claude.com/docs/start')
    });

    expect(response.headers.get('Location')).toBe(
      'https://claude-code.fast.dxshelley.fun/docs/next?locale=zh-CN'
    );
  });

  it('keeps an external redirect external and marks configured responses private', async () => {
    const response = await finalizeConfiguredResponse({
      request: new Request('https://claude-code.fast.dxshelley.fun/docs/start'),
      response: new Response('redirect', {
        status: 302,
        headers: { Location: 'https://accounts.example.com/login', Connection: 'keep-alive' }
      }),
      site,
      targetUrl: new URL('https://code.claude.com/docs/start')
    });

    expect(response.headers.get('Location')).toBe('https://accounts.example.com/login');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.has('Connection')).toBe(false);
  });

  it('removes upstream cookies and rewrites same-origin body URLs', async () => {
    const response = await finalizeConfiguredResponse({
      request: new Request('https://claude-code.fast.dxshelley.fun/docs/start'),
      response: new Response(
        '<script src="https://code.claude.com/assets/app.js"></script><img src="https://cdn.example.com/logo.svg">',
        {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Set-Cookie': 'session=upstream-only; Path=/',
            'Content-Security-Policy': 'connect-src https://code.claude.com https://api.example.com'
          }
        }
      ),
      site,
      targetUrl: new URL('https://code.claude.com/docs/start')
    });

    expect(response.headers.has('Set-Cookie')).toBe(false);
    expect(response.headers.get('Content-Security-Policy')).toContain(
      'https://claude-code.fast.dxshelley.fun'
    );
    expect(response.headers.get('Content-Security-Policy')).toContain('https://api.example.com');
    const body = await response.text();
    expect(body).toContain('https://claude-code.fast.dxshelley.fun/assets/app.js');
    expect(body).not.toContain('https://code.claude.com/assets/app.js');
    expect(body).toContain('https://cdn.example.com/logo.svg');
  });
});
