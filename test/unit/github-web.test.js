import { describe, expect, it, vi } from 'vitest';
import {
  GITHUB_PROXY_HOSTS,
  getGithubWebShortcuts,
  getGithubProxyTarget
} from '../../src/github/config.js';
import {
  classifyGithubWebRequest,
  getGithubUpstreamUrl,
  isGithubWritePath
} from '../../src/github/routing.js';
import { fetchGithubWeb, getGithubRequestHeaders } from '../../src/github/fetch.js';
import {
  rewriteGithubHtml,
  rewriteGithubCsp,
  rewriteGithubLocation,
  rewriteGithubText,
  rewriteGithubUrl
} from '../../src/github/rewrite.js';
import { finalizeGithubWebResponse } from '../../src/github/response.js';

describe('GitHub read-only Web routing', () => {
  it('maps hermes to repository search', () => {
    expect(getGithubWebShortcuts()).toMatchObject({ hermes: '/search' });

    const result = classifyGithubWebRequest(
      new Request('https://fast.example/search?q=Hermes'),
      new URL('https://fast.example/search?q=Hermes')
    );

    expect(result).toEqual({
      kind: 'redirect',
      targetUrl: 'https://fast.example/gh/search?q=hermes&type=repositories'
    });
  });

  it('supports configured shortcut overrides without accepting unsafe paths', () => {
    expect(
      getGithubWebShortcuts({ GITHUB_WEB_SHORTCUTS: 'xget=/xixu-me/Xget,docs=/owner/repo' })
    ).toEqual({
      hermes: '/search',
      xget: '/xixu-me/Xget',
      docs: '/owner/repo'
    });
    expect(getGithubWebShortcuts({ GITHUB_WEB_SHORTCUTS: 'bad=//evil.test,../bad=/a/b' })).toEqual({
      hermes: '/search'
    });
  });

  it('routes generic search and repository pages to github.com', () => {
    const search = classifyGithubWebRequest(
      new Request('https://fast.example/search?q=cloudflare&type=repositories'),
      new URL('https://fast.example/search?q=cloudflare&type=repositories')
    );
    const repository = classifyGithubWebRequest(
      new Request('https://fast.example/xixu-me/Xget/blob/main/README.md'),
      new URL('https://fast.example/gh/xixu-me/Xget/blob/main/README.md')
    );
    const browserRepository = classifyGithubWebRequest(
      new Request('https://fast.example/gh/xixu-me/Xget/blob/main/README.md', {
        headers: { Accept: 'text/html' }
      }),
      new URL('https://fast.example/gh/xixu-me/Xget/blob/main/README.md')
    );

    expect(search).toEqual({
      kind: 'proxy',
      upstreamUrl: 'https://github.com/search?q=cloudflare&type=repositories'
    });
    expect(repository).toBeNull();
    expect(browserRepository).toEqual({
      kind: 'proxy',
      upstreamUrl: 'https://github.com/xixu-me/Xget/blob/main/README.md'
    });

    const missingPrefix = classifyGithubWebRequest(
      new Request('https://fast.example/Homebrew/brew', {
        headers: { Accept: 'text/html' }
      }),
      new URL('https://fast.example/Homebrew/brew')
    );
    expect(missingPrefix).toEqual({
      kind: 'redirect',
      targetUrl: 'https://fast.example/gh/Homebrew/brew'
    });

    const browserProfile = classifyGithubWebRequest(
      new Request('https://fast.example/gh/Homebrew', {
        headers: { Accept: 'text/html' }
      }),
      new URL('https://fast.example/gh/Homebrew')
    );
    expect(browserProfile).toEqual({
      kind: 'proxy',
      upstreamUrl: 'https://github.com/Homebrew'
    });

    const browserFetch = classifyGithubWebRequest(
      new Request('https://fast.example/gh/xixu-me/Xget', {
        headers: { Accept: '*/*', 'Sec-Fetch-Mode': 'cors' }
      }),
      new URL('https://fast.example/gh/xixu-me/Xget')
    );
    expect(browserFetch).toEqual({
      kind: 'proxy',
      upstreamUrl: 'https://github.com/xixu-me/Xget'
    });

    const manifest = classifyGithubWebRequest(
      new Request('https://fast.example/gh/manifest.json', {
        headers: { Accept: 'application/manifest+json', 'Sec-Fetch-Mode': 'cors' }
      }),
      new URL('https://fast.example/gh/manifest.json')
    );
    expect(manifest).toEqual({
      kind: 'proxy',
      upstreamUrl: 'https://github.com/manifest.json'
    });
  });

  it('leaves existing Xget platform routes to the legacy router', () => {
    expect(
      classifyGithubWebRequest(
        new Request('https://fast.example/gh/xixu-me/Xget'),
        new URL('https://fast.example/gh/xixu-me/Xget')
      )
    ).toBeNull();
    expect(
      classifyGithubWebRequest(
        new Request('https://fast.example/npm/react'),
        new URL('https://fast.example/npm/react')
      )
    ).toBeNull();
  });

  it('redirects read-only UI entry points for write operations to GitHub', () => {
    for (const path of [
      '/DXShelley/hermes/fork',
      '/DXShelley/hermes/edit/main/README.md',
      '/DXShelley/hermes/issues/new',
      '/DXShelley/hermes/pulls/new',
      '/settings',
      '/login',
      '/signup'
    ]) {
      const localPath = path === '/settings' || path === '/login' ? path : `/gh${path}`;
      expect(isGithubWritePath(path, 'GET')).toBe(true);
      expect(
        classifyGithubWebRequest(
          new Request(`https://fast.example${localPath}`, {
            headers: { Accept: 'text/html' }
          }),
          new URL(`https://fast.example${localPath}`)
        )
      ).toEqual({
        kind: 'redirect',
        targetUrl: `https://github.com${path}`
      });
    }
  });

  it('redirects all mutation methods without proxying them', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const path = '/DXShelley/hermes/issues';
      expect(isGithubWritePath(path, method)).toBe(true);
      expect(
        classifyGithubWebRequest(
          new Request(`https://fast.example/gh${path}`, {
            method,
            headers: { Accept: 'text/html' },
            ...(method === 'POST' && { body: 'title=blocked' })
          }),
          new URL(`https://fast.example/gh${path}`)
        )
      ).toEqual({
        kind: 'redirect',
        targetUrl: `https://github.com${path}`
      });
    }
  });

  it('redirects JavaScript write requests without changing the legacy Git route', () => {
    const browserlessWrite = classifyGithubWebRequest(
      new Request('https://fast.example/gh/DXShelley/xget/issues', {
        method: 'POST',
        headers: { Accept: '*/*', 'Sec-Fetch-Mode': 'cors' }
      }),
      new URL('https://fast.example/gh/DXShelley/xget/issues')
    );
    const gitWrite = classifyGithubWebRequest(
      new Request('https://fast.example/gh/DXShelley/xget.git/git-receive-pack', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-git-receive-pack-request',
          'User-Agent': 'git/2.34.1'
        }
      }),
      new URL('https://fast.example/gh/DXShelley/xget.git/git-receive-pack')
    );

    expect(browserlessWrite).toEqual({
      kind: 'redirect',
      targetUrl: 'https://github.com/DXShelley/xget/issues'
    });
    expect(gitWrite).toBeNull();
  });

  it('rejects non-read methods for allowlisted GitHub assets', () => {
    expect(
      classifyGithubWebRequest(
        new Request('https://fast.example/_github/proxy/api.github.com/repos/DXShelley/xget', {
          method: 'OPTIONS'
        }),
        new URL('https://fast.example/_github/proxy/api.github.com/repos/DXShelley/xget')
      )
    ).toEqual({ kind: 'reject' });
  });

  it('builds GitHub upstream URLs without allowing an arbitrary host', () => {
    expect(getGithubUpstreamUrl('/xixu-me/Xget', '?tab=readme')).toBe(
      'https://github.com/xixu-me/Xget?tab=readme'
    );
    expect(getGithubProxyTarget('raw.githubusercontent.com', '/owner/repo/main.txt')).toBe(
      `${GITHUB_PROXY_HOSTS['raw.githubusercontent.com']}/owner/repo/main.txt`
    );
    expect(getGithubProxyTarget('github.githubassets.com', '/assets/app.css')).toBe(
      'https://github.githubassets.com/assets/app.css'
    );
    expect(getGithubProxyTarget('github-cloud.s3.amazonaws.com', '/asset')).toBe(
      'https://github-cloud.s3.amazonaws.com/asset'
    );
    expect(getGithubProxyTarget('evil.example', '/anything')).toBeNull();
    expect(getGithubProxyTarget(undefined, '/anything')).toBeNull();
  });

  it('forwards only safe navigation headers and never forwards credentials or bodies', () => {
    const request = new Request('https://fast.example/xixu-me/Xget', {
      method: 'GET',
      headers: {
        Accept: 'text/html',
        'Accept-Language': 'zh-CN',
        Authorization: 'Bearer secret',
        Cookie: 'logged_in=true',
        'X-PJAX': 'true'
      }
    });
    const headers = getGithubRequestHeaders(request);

    expect(headers.get('Accept')).toBe('text/html');
    expect(headers.get('Accept-Language')).toBe('zh-CN');
    expect(headers.get('X-PJAX')).toBe('true');
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('Cookie')).toBeNull();
  });

  it('uses manual redirects and retries transient GitHub failures', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(
        new Response('ok', {
          status: 302,
          headers: { Location: 'https://github.com/xixu-me/Xget' }
        })
      );

    const result = await fetchGithubWeb({
      request: new Request('https://fast.example/xixu-me/Xget', {
        headers: { Cookie: 'secret=1' }
      }),
      targetUrl: 'https://github.com/xixu-me/Xget',
      config: { MAX_RETRIES: 2, RETRY_DELAY_MS: 0, TIMEOUT_SECONDS: 5 }
    });

    expect(result.response.status).toBe(302);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][1]?.redirect).toBe('manual');
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get('Cookie')).toBeNull();
    expect(fetchSpy.mock.calls[0][1]?.body).toBeUndefined();
  });

  it('keeps read-only GitHub links local and sends write links to GitHub', () => {
    const origin = 'https://fast.example';

    expect(rewriteGithubUrl('https://github.com/xixu-me/Xget/blob/main/README.md', origin)).toBe(
      `${origin}/gh/xixu-me/Xget/blob/main/README.md`
    );
    expect(rewriteGithubUrl('https://github.com/search?q=hermes&type=repositories', origin)).toBe(
      `${origin}/gh/search?q=hermes&type=repositories`
    );
    expect(rewriteGithubUrl('/Homebrew/brew', origin)).toBe(`${origin}/gh/Homebrew/brew`);
    expect(rewriteGithubUrl('/xixu-me/Xget/fork', origin)).toBe(
      'https://github.com/xixu-me/Xget/fork'
    );
    expect(
      rewriteGithubUrl('https://raw.githubusercontent.com/xixu-me/Xget/main/README.md', origin)
    ).toBe(`${origin}/_github/proxy/raw.githubusercontent.com/xixu-me/Xget/main/README.md`);
    expect(rewriteGithubUrl('https://example.com/docs', origin)).toBe('https://example.com/docs');
  });

  it('rewrites HTML attributes and absolute URLs while preserving unrelated links', () => {
    const html = `
      <a href="https://github.com/xixu-me/Xget">repo</a>
      <a href="/Homebrew/brew">relative repo</a>
      <a href="/xixu-me/Xget/issues/new">new issue</a>
      <img src="https://github.githubassets.com/assets/app.js">
      <a href="https://docs.example.com">external</a>
    `;

    const rewritten = rewriteGithubHtml(html, 'https://fast.example');

    expect(rewritten).toContain('href="https://fast.example/gh/xixu-me/Xget"');
    expect(rewritten).toContain('href="https://fast.example/gh/Homebrew/brew"');
    expect(rewritten).toContain('href="https://github.com/xixu-me/Xget/issues/new"');
    expect(rewritten).toContain(
      'src="https://fast.example/_github/proxy/github.githubassets.com/assets/app.js"'
    );
    expect(rewritten).toContain('href="https://docs.example.com"');
  });

  it('rewrites static JavaScript URL prefixes without consuming template expressions', () => {
    const script = 'const url = `https://github.com/github/github/blob/master/${t[1]}#L${t[2]}`;';

    expect(rewriteGithubText(script, 'https://fast.example')).toBe(
      'const url = `https://fast.example/gh/github/github/blob/master/${t[1]}#L${t[2]}`;'
    );
  });

  it('rewrites redirect headers and embedded text URLs', () => {
    expect(rewriteGithubLocation('/xixu-me/Xget/blob/main/README.md', 'https://fast.example')).toBe(
      'https://fast.example/gh/xixu-me/Xget/blob/main/README.md'
    );
    expect(rewriteGithubLocation('https://github.com/login', 'https://fast.example')).toBe(
      'https://github.com/login'
    );
    expect(
      rewriteGithubText('"url":"https://api.github.com/repos/xixu-me/Xget"', 'https://fast.example')
    ).toBe('"url":"https://fast.example/_github/proxy/api.github.com/repos/xixu-me/Xget"');
  });

  it('rewrites CSP proxy origins as path prefixes without matching nested hostnames', () => {
    expect(
      rewriteGithubCsp(
        'style-src github.githubassets.com; connect-src uploads.github.com gist.github.com github.com raw.githubusercontent.com',
        'https://fast.example'
      )
    ).toBe(
      'style-src https://fast.example/_github/proxy/github.githubassets.com/; connect-src uploads.github.com gist.github.com https://fast.example https://fast.example/_github/proxy/raw.githubusercontent.com/'
    );
  });

  it('finalizes text responses without leaking cookies or stale encoded-body headers', async () => {
    const response = await finalizeGithubWebResponse({
      response: new Response('<a href="https://github.com/xixu-me/Xget">repo</a>', {
        status: 200,
        headers: {
          'Content-Encoding': 'gzip',
          'Content-Length': '64',
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': 'script-src github.githubassets.com',
          'Set-Cookie': 'logged_in=true'
        }
      }),
      origin: 'https://fast.example'
    });

    expect(await response.text()).toContain('https://fast.example/gh/xixu-me/Xget');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('Content-Length')).toBeNull();
    expect(response.headers.get('Content-Security-Policy')).toContain(
      'https://fast.example/_github/proxy/github.githubassets.com'
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rewrites GitHub manifest icon URLs through the local asset proxy', async () => {
    const response = await finalizeGithubWebResponse({
      response: new Response(
        JSON.stringify({
          icons: [{ src: 'https://github.githubassets.com/assets/apple-touch-icon.png' }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' } }
      ),
      origin: 'https://fast.example'
    });

    expect(await response.text()).toContain(
      'https://fast.example/_github/proxy/github.githubassets.com/assets/apple-touch-icon.png'
    );
  });
});
