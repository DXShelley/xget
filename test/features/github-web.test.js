import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from '../../src/index.js';

/** @type {ExecutionContext} */
const executionContext = {
  waitUntil() {},
  passThroughOnException() {}
};

describe('GitHub Web integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves Xget platform routes on fast.dxshelley.fun', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

    const response = await worker.fetch(
      new Request('https://fast.dxshelley.fun/npm/react'),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://registry.npmjs.org/react');
  });

  it('proxies GitHub search without a mirror-only shortcut route', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('search'));
    const response = await worker.fetch(
      new Request('https://git.dxshelley.fun/search?q=Hermes'),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://github.com/search?q=Hermes');
  });

  it('proxies a public repository page and rewrites internal links', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        '<html><a href="https://github.com/DXShelley/hermes">repo</a><a href="/DXShelley/hermes/fork">fork</a><turbo-frame data-turbo-frame-src="/go-gitea/gitea/branches"></turbo-frame><script type="application/json">{"url":"/go-gitea/gitea/commits/main","api":"/go-gitea/gitea/tags"}</script></html>',
        {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }
      )
    );

    const response = await worker.fetch(
      new Request('https://git.dxshelley.fun/DXShelley/hermes', {
        headers: { Accept: 'text/html', Cookie: 'must-not-forward=true' }
      }),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('https://git.dxshelley.fun/DXShelley/hermes');
    expect(body).not.toContain('href="/DXShelley/hermes/fork"');
    expect(body).toContain('https://git.dxshelley.fun/DXShelley/hermes/fork');
    expect(body).toContain(
      'data-turbo-frame-src="https://git.dxshelley.fun/go-gitea/gitea/branches"'
    );
    expect(body).toContain('"url":"https://git.dxshelley.fun/go-gitea/gitea/commits/main"');
    expect(body).toContain('"api":"https://git.dxshelley.fun/go-gitea/gitea/tags"');
    expect(fetchSpy.mock.calls[0][0]).toBe('https://github.com/DXShelley/hermes');
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get('Cookie')).toBeNull();
  });

  it('keeps HTML and JSON repository responses in separate edge-cache variants', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    await worker.fetch(
      new Request('https://git.dxshelley.fun/go-gitea/gitea', {
        headers: { Accept: 'text/html' }
      }),
      {},
      executionContext
    );
    await worker.fetch(
      new Request('https://git.dxshelley.fun/go-gitea/gitea', {
        headers: {
          Accept: 'application/json',
          'X-GitHub-Client-Version': 'version',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }),
      {},
      executionContext
    );

    const cacheKeys = fetchSpy.mock.calls
      .filter(call => call[0] === 'https://github.com/go-gitea/gitea')
      .map(call => /** @type {RequestInit & { cf?: { cacheKey?: string } }} */ (call[1]))
      .map(options => options.cf?.cacheKey);
    expect(cacheKeys[0]).not.toBe(cacheKeys[1]);
    expect(cacheKeys[0]).toContain('__xget_github_variant=html');
    expect(cacheKeys[1]).toContain('__xget_github_variant=json');
  });

  it('proxies GitHub Web JSON fetches used to fill repository metadata', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          url: '/go-gitea/gitea/commit/abc123',
          shortMessageHtmlLink:
            '<a href="/go-gitea/gitea/commit/abc123" data-hovercard-url="/go-gitea/gitea/pull/1/hovercard">Fix repository metadata</a>'
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        }
      )
    );

    const response = await worker.fetch(
      new Request('https://git.dxshelley.fun/go-gitea/gitea/latest-commit', {
        headers: {
          Accept: 'application/json',
          'GitHub-Is-React': 'true',
          'GitHub-Verified-Fetch': 'true',
          Referer: 'https://git.dxshelley.fun/go-gitea/gitea',
          'X-Fetch-Nonce': 'v2:nonce',
          'X-GitHub-Client-Version': 'e85d7dcc80e884128537c9f6334006eb46b2d2c3',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://github.com/go-gitea/gitea/latest-commit');
    const body = await response.json();
    expect(body.url).toBe('https://git.dxshelley.fun/go-gitea/gitea/commit/abc123');
    expect(body.shortMessageHtmlLink).toBe(
      '<a href="https://git.dxshelley.fun/go-gitea/gitea/commit/abc123" data-hovercard-url="https://git.dxshelley.fun/go-gitea/gitea/pull/1/hovercard">Fix repository metadata</a>'
    );
    const upstreamHeaders = new Headers(fetchSpy.mock.calls[0][1]?.headers);
    expect(upstreamHeaders.get('GitHub-Is-React')).toBe('true');
    expect(upstreamHeaders.get('GitHub-Verified-Fetch')).toBe('true');
    expect(upstreamHeaders.get('X-Fetch-Nonce')).toBe('v2:nonce');
    expect(upstreamHeaders.get('X-GitHub-Client-Version')).toBe(
      'e85d7dcc80e884128537c9f6334006eb46b2d2c3'
    );
    expect(upstreamHeaders.get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(upstreamHeaders.get('Referer')).toBe('https://github.com/go-gitea/gitea');
  });

  it('proxies same-origin GitHub Fetch paths used by repository navigation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ shortMessageHtmlLink: 'Latest commit' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      })
    );

    const response = await worker.fetch(
      new Request('https://git.dxshelley.fun/go-gitea/gitea/latest-commit', {
        headers: {
          Accept: 'application/json',
          'X-GitHub-Client-Version': 'version',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://github.com/go-gitea/gitea/latest-commit');
    expect(await response.text()).toContain('Latest commit');
  });

  it('restores GitHub JSON fetch marker when the browser omits it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ oid: 'abc123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      })
    );

    await worker.fetch(
      new Request('https://git.dxshelley.fun/go-gitea/gitea/latest-commit', {
        headers: {
          Accept: 'application/json',
          'X-GitHub-Client-Version': 'e85d7dcc80e884128537c9f6334006eb46b2d2c3'
        }
      }),
      {},
      executionContext
    );

    const upstreamHeaders = new Headers(fetchSpy.mock.calls[0][1]?.headers);
    expect(upstreamHeaders.get('X-Requested-With')).toBe('XMLHttpRequest');
  });

  it.each(['/go-gitea/gitea/branches', '/go-gitea/gitea/tags', '/go-gitea/gitea/commits/main/'])(
    'proxies same-origin PJAX repository navigation for %s',
    async path => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('<div id="repo-content-pjax-container">content</div>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        })
      );

      const response = await worker.fetch(
        new Request(`https://git.dxshelley.fun${path}`, {
          headers: {
            Accept: 'text/html',
            'Sec-Fetch-Mode': 'cors',
            'X-PJAX': 'true',
            'X-PJAX-Container': '#repo-content-pjax-container'
          }
        }),
        {},
        executionContext
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('repo-content-pjax-container');
      expect(fetchSpy.mock.calls[0][0]).toBe(`https://github.com${path}`);
    }
  );

  it('proxies repository read pages with a CSP that allows local asset descendants', async () => {
    const paths = [
      '/xixu-me/xget',
      '/xixu-me/xget/tree/main/src',
      '/xixu-me/xget/blob/main/README.zh-Hans.md',
      '/go-gitea/gitea/security'
    ];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          '<link rel="stylesheet" href="https://github.githubassets.com/assets/app.css">',
          {
            status: 200,
            headers: {
              'Content-Security-Policy':
                'style-src github.githubassets.com; connect-src uploads.github.com github.com',
              'Content-Type': 'text/html; charset=utf-8'
            }
          }
        )
    );

    for (const path of paths) {
      const response = await worker.fetch(
        new Request(`https://git.dxshelley.fun${path}`, { headers: { Accept: 'text/html' } }),
        {},
        executionContext
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain(
        'https://git.dxshelley.fun/_github/proxy/github.githubassets.com/assets/app.css'
      );
      expect(response.headers.get('Content-Security-Policy')).toContain(
        'https://git.dxshelley.fun/_github/proxy/github.githubassets.com/'
      );
      expect(response.headers.get('Content-Security-Policy')).toContain('uploads.github.com');
    }

    expect(fetchSpy).toHaveBeenCalledTimes(paths.length);
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'https://github.com/xixu-me/xget',
      'https://github.com/xixu-me/xget/tree/main/src',
      'https://github.com/xixu-me/xget/blob/main/README.zh-Hans.md',
      'https://github.com/go-gitea/gitea/security'
    ]);
  });

  it('proxies mutation requests to the canonical GitHub URL with their body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('upstream', { status: 200, headers: { 'Content-Type': 'text/plain' } })
      );
    const response = await worker.fetch(
      new Request('https://git.dxshelley.fun/DXShelley/hermes/issues', {
        method: 'POST',
        body: 'title=should-not-reach-proxy',
        headers: {
          Accept: 'text/html',
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://github.com/DXShelley/hermes/issues',
      expect.objectContaining({ method: 'POST', body: expect.any(ReadableStream) })
    );
  });

  it('proxies allowlisted GitHub resources through the local namespace', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('asset', { status: 200, headers: { 'Content-Type': 'text/plain' } })
      );

    const response = await worker.fetch(
      new Request(
        'https://git.dxshelley.fun/_github/proxy/raw.githubusercontent.com/DXShelley/hermes/main/README.md'
      ),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://raw.githubusercontent.com/DXShelley/hermes/main/README.md'
    );
    expect(await response.text()).toBe('asset');
  });

  it('proxies the GitHub browser stats POST without enabling other API writes', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } })
      );

    const response = await worker.fetch(
      new Request('https://git.dxshelley.fun/_github/proxy/api.github.com/_private/browser/stats', {
        method: 'POST',
        body: '{"event":"page_view"}',
        headers: { 'Content-Type': 'application/json' }
      }),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.github.com/_private/browser/stats');
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get('Content-Type')).toBe(
      'application/json'
    );
    expect(await new Response(fetchSpy.mock.calls[0][1]?.body).text()).toBe(
      '{"event":"page_view"}'
    );
  });

  it('proxies the GitHub collector POST without enabling other collector writes', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } })
      );

    const response = await worker.fetch(
      new Request('https://git.dxshelley.fun/_github/proxy/collector.github.com/github/collect', {
        method: 'POST',
        body: '{"event":"page_view"}',
        headers: { 'Content-Type': 'application/json' }
      }),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://collector.github.com/github/collect');
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get('Content-Type')).toBe(
      'application/json'
    );
    expect(await new Response(fetchSpy.mock.calls[0][1]?.body).text()).toBe(
      '{"event":"page_view"}'
    );
  });

  it('proxies GitHub CSS and rewrites asset URLs inside the stylesheet', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          'body { background-image: url(https://github.githubassets.com/assets/icon.svg); }',
          { status: 200, headers: { 'Content-Type': 'text/css; charset=utf-8' } }
        )
      );

    const response = await worker.fetch(
      new Request(
        'https://git.dxshelley.fun/_github/proxy/github.githubassets.com/assets/app.css',
        {
          headers: { Accept: 'text/css,*/*;q=0.1' }
        }
      ),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://github.githubassets.com/assets/app.css');
    expect(await response.text()).toContain(
      'https://git.dxshelley.fun/_github/proxy/github.githubassets.com/assets/icon.svg'
    );
  });

  it('rewrites GitHub icon links while proxying repository HTML', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        '<link rel="apple-touch-icon" href="https://github.githubassets.com/assets/apple-touch-icon.png">',
        {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }
      )
    );

    const response = await worker.fetch(
      new Request('https://git.dxshelley.fun/Homebrew/brew', {
        headers: { Accept: 'text/html' }
      }),
      {},
      executionContext
    );

    expect(await response.text()).toContain(
      'href="https://git.dxshelley.fun/_github/proxy/github.githubassets.com/assets/apple-touch-icon.png"'
    );
  });

  it('proxies and rewrites the GitHub Web manifest', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          icons: [{ src: 'https://github.githubassets.com/assets/apple-touch-icon.png' }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/manifest+json' } }
      )
    );

    const response = await worker.fetch(
      new Request('https://git.dxshelley.fun/manifest.json', {
        headers: { Accept: 'application/manifest+json', 'Sec-Fetch-Mode': 'cors' }
      }),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://github.com/manifest.json');
    expect(await response.text()).toContain(
      'https://git.dxshelley.fun/_github/proxy/github.githubassets.com/assets/apple-touch-icon.png'
    );
  });

  it('applies the existing path safety policy before GitHub Web proxying', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await worker.fetch(
      new Request(`https://git.dxshelley.fun/DXShelley/hermes/${'a'.repeat(2100)}`, {
        headers: { Accept: 'text/html' }
      }),
      {},
      executionContext
    );

    expect(response.status).toBe(414);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
