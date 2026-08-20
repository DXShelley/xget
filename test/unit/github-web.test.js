import { afterEach, describe, expect, it, vi } from 'vitest';
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
  rewriteGithubJson,
  rewriteGithubLocation,
  rewriteGithubText,
  rewriteGithubUrl
} from '../../src/github/rewrite.js';
import { finalizeGithubWebResponse } from '../../src/github/response.js';

afterEach(() => {
  vi.restoreAllMocks();
});

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
        headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' }
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

    const githubFetch = classifyGithubWebRequest(
      new Request('https://fast.example/gh/go-gitea/gitea/latest-commit', {
        headers: {
          Accept: 'application/json',
          'X-GitHub-Client-Version': 'e85d7dcc80e884128537c9f6334006eb46b2d2c3',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }),
      new URL('https://fast.example/gh/go-gitea/gitea/latest-commit')
    );
    expect(githubFetch).toEqual({
      kind: 'proxy',
      upstreamUrl: 'https://github.com/go-gitea/gitea/latest-commit'
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

  it('proxies GitHub browser Fetches from same-origin repository paths', () => {
    const latestCommit = classifyGithubWebRequest(
      new Request('https://fast.example/go-gitea/gitea/latest-commit', {
        headers: {
          Accept: 'application/json',
          'X-GitHub-Client-Version': 'version',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }),
      new URL('https://fast.example/go-gitea/gitea/latest-commit')
    );
    const pjaxBranches = classifyGithubWebRequest(
      new Request('https://fast.example/go-gitea/gitea/branches', {
        headers: {
          Accept: 'text/html',
          'Sec-Fetch-Mode': 'cors',
          'X-PJAX': 'true',
          'X-PJAX-Container': '#repo-content-pjax-container'
        }
      }),
      new URL('https://fast.example/go-gitea/gitea/branches')
    );
    const pjaxTags = classifyGithubWebRequest(
      new Request('https://fast.example/go-gitea/gitea/tags', {
        headers: {
          Accept: 'text/html',
          'Sec-Fetch-Mode': 'cors',
          'X-PJAX': 'true',
          'X-PJAX-Container': '#repo-content-pjax-container'
        }
      }),
      new URL('https://fast.example/go-gitea/gitea/tags')
    );

    expect(latestCommit).toEqual({
      kind: 'proxy',
      upstreamUrl: 'https://github.com/go-gitea/gitea/latest-commit'
    });
    expect(pjaxBranches).toEqual({
      kind: 'proxy',
      upstreamUrl: 'https://github.com/go-gitea/gitea/branches'
    });
    expect(pjaxTags).toEqual({
      kind: 'proxy',
      upstreamUrl: 'https://github.com/go-gitea/gitea/tags'
    });
  });

  it('keeps the repository security page read-only while redirecting security writes', () => {
    expect(isGithubWritePath('/go-gitea/gitea/security', 'GET')).toBe(false);
    expect(isGithubWritePath('/go-gitea/gitea/security/', 'GET')).toBe(false);
    expect(isGithubWritePath('/go-gitea/gitea/security/advisories/new', 'GET')).toBe(true);

    const securityPage = classifyGithubWebRequest(
      new Request('https://fast.example/gh/go-gitea/gitea/security', {
        headers: { Accept: 'text/html' }
      }),
      new URL('https://fast.example/gh/go-gitea/gitea/security')
    );
    expect(securityPage).toEqual({
      kind: 'proxy',
      upstreamUrl: 'https://github.com/go-gitea/gitea/security'
    });

    expect(
      classifyGithubWebRequest(
        new Request('https://fast.example/gh/go-gitea/gitea/security/', {
          headers: { Accept: 'text/html' }
        }),
        new URL('https://fast.example/gh/go-gitea/gitea/security/')
      )
    ).toEqual({
      kind: 'proxy',
      upstreamUrl: 'https://github.com/go-gitea/gitea/security/'
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

  it('proxies GitHub Web UI entry points, including write operations', () => {
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
      ).toEqual({ kind: 'proxy', upstreamUrl: `https://github.com${path}` });
    }
  });

  it('proxies all mutation methods and forwards their bodies', () => {
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
        kind: 'proxy',
        upstreamUrl: `https://github.com${path}`,
        forwardBody: method !== 'GET' && method !== 'HEAD'
      });
    }
  });

  it('proxies JavaScript write requests without changing the legacy Git route', () => {
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
      kind: 'proxy',
      upstreamUrl: 'https://github.com/DXShelley/xget/issues',
      forwardBody: true
    });
    expect(gitWrite).toBeNull();
  });

  it('rejects non-read methods for allowlisted GitHub assets', () => {
    expect(
      classifyGithubWebRequest(
        new Request('https://fast.example/_github/proxy/api.github.com/_private/browser/stats', {
          method: 'POST',
          body: '{"event":"page_view"}',
          headers: { 'Content-Type': 'application/json' }
        }),
        new URL('https://fast.example/_github/proxy/api.github.com/_private/browser/stats')
      )
    ).toEqual({
      kind: 'proxy',
      upstreamUrl: 'https://api.github.com/_private/browser/stats',
      forwardBody: true
    });

    expect(
      classifyGithubWebRequest(
        new Request('https://fast.example/_github/proxy/api.github.com/repos/DXShelley/xget', {
          method: 'OPTIONS'
        }),
        new URL('https://fast.example/_github/proxy/api.github.com/repos/DXShelley/xget')
      )
    ).toEqual({ kind: 'reject' });

    expect(
      classifyGithubWebRequest(
        new Request('https://fast.example/_github/proxy/collector.github.com/github/collect', {
          method: 'POST',
          body: '{"event":"page_view"}',
          headers: { 'Content-Type': 'application/json' }
        }),
        new URL('https://fast.example/_github/proxy/collector.github.com/github/collect')
      )
    ).toEqual({
      kind: 'proxy',
      upstreamUrl: 'https://collector.github.com/github/collect',
      forwardBody: true
    });

    expect(
      classifyGithubWebRequest(
        new Request('https://fast.example/_github/proxy/collector.github.com/github/other', {
          method: 'POST',
          body: '{}'
        }),
        new URL('https://fast.example/_github/proxy/collector.github.com/github/other')
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
    expect(getGithubProxyTarget('collector.github.com', '/github/collect')).toBe(
      'https://collector.github.com/github/collect'
    );
    expect(getGithubProxyTarget('evil.example', '/anything')).toBeNull();
    expect(getGithubProxyTarget(undefined, '/anything')).toBeNull();
  });

  it('forwards GitHub React metadata context without credentials', () => {
    const request = new Request('https://fast.example/xixu-me/Xget', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'zh-CN',
        Authorization: 'Bearer secret',
        Cookie: '_gh_sess=secret',
        'GitHub-Is-React': 'true',
        'GitHub-Verified-Fetch': 'true',
        'If-None-Match': 'W/"browser-cache-entry"',
        Referer: 'https://fast.example/gh/Homebrew/brew',
        'X-Fetch-Nonce': 'v2:nonce',
        'X-PJAX': 'true',
        'X-GitHub-Client-Version': 'version'
      }
    });
    const headers = getGithubRequestHeaders(request);

    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Accept-Language')).toBe('zh-CN');
    expect(headers.get('X-PJAX')).toBe('true');
    expect(headers.get('GitHub-Is-React')).toBe('true');
    expect(headers.get('GitHub-Verified-Fetch')).toBe('true');
    expect(headers.get('X-Fetch-Nonce')).toBe('v2:nonce');
    expect(headers.get('Referer')).toBe('https://github.com/Homebrew/brew');
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('Cookie')).toBeNull();
    expect(headers.get('If-None-Match')).toBeNull();
  });

  it.each(['latest-commit', 'recently-touched-branches', 'branch-and-tag-count'])(
    'proxies GitHub repository metadata endpoint %s with HAR request context',
    endpoint => {
      const url = new URL(`https://fast.example/Homebrew/brew/${endpoint}`);
      const request = new Request(url, {
        headers: {
          Accept: 'application/json',
          'GitHub-Is-React': 'true',
          'GitHub-Verified-Fetch': 'true',
          'Sec-Fetch-Mode': 'cors',
          'X-Fetch-Nonce': 'v2:nonce',
          'X-GitHub-Client-Version': 'version',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      expect(classifyGithubWebRequest(request, url)).toEqual({
        kind: 'proxy',
        upstreamUrl: `https://github.com/Homebrew/brew/${endpoint}`
      });
    }
  );

  it('bypasses shared cache for GitHub React metadata requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const config = { MAX_RETRIES: 1, RETRY_DELAY_MS: 0, TIMEOUT_SECONDS: 5, CACHE_DURATION: 1800 };

    await fetchGithubWeb({
      request: new Request('https://fast.example/gh/Homebrew/brew/latest-commit', {
        headers: {
          Accept: 'application/json',
          'GitHub-Is-React': 'true',
          'GitHub-Verified-Fetch': 'true',
          Referer: 'https://fast.example/gh/Homebrew/brew',
          'X-Fetch-Nonce': 'v2:nonce',
          'X-GitHub-Client-Version': 'version',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }),
      targetUrl: 'https://github.com/Homebrew/brew/latest-commit',
      config
    });

    const [[, firstGithubFetchOptions]] = fetchSpy.mock.calls;
    const firstOptions = /** @type {RequestInit & { cf?: Record<string, unknown> }} */ (
      firstGithubFetchOptions
    );

    expect(new Headers(firstOptions.headers).get('Cookie')).toBeNull();
    expect(new Headers(firstOptions.headers).get('X-Fetch-Nonce')).toBe('v2:nonce');
    expect(firstOptions.cf?.cacheEverything).toBe(false);
    expect(firstOptions.cf?.cacheTtl).toBe(0);
    expect(firstOptions.cf?.cacheKey).toBeUndefined();
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

  it('separates HTML, JSON, and fragment GET cache variants', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const config = { MAX_RETRIES: 1, RETRY_DELAY_MS: 0, TIMEOUT_SECONDS: 5, CACHE_DURATION: 1800 };

    await fetchGithubWeb({
      request: new Request('https://fast.example/gh/go-gitea/gitea', {
        headers: { Accept: 'text/html' }
      }),
      targetUrl: 'https://github.com/go-gitea/gitea',
      config
    });
    await fetchGithubWeb({
      request: new Request('https://fast.example/gh/go-gitea/gitea', {
        headers: {
          Accept: 'application/json',
          'X-GitHub-Client-Version': 'version',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }),
      targetUrl: 'https://github.com/go-gitea/gitea',
      config
    });
    await fetchGithubWeb({
      request: new Request('https://fast.example/gh/go-gitea/gitea', {
        headers: { Accept: 'text/html', 'X-PJAX': 'true' }
      }),
      targetUrl: 'https://github.com/go-gitea/gitea',
      config
    });
    await fetchGithubWeb({
      request: new Request('https://fast.example/gh/go-gitea/gitea', {
        headers: { Accept: 'text/html', 'X-PJAX': 'true', 'X-PJAX-Container': '#repo' }
      }),
      targetUrl: 'https://github.com/go-gitea/gitea',
      config
    });
    await fetchGithubWeb({
      request: new Request('https://fast.example/gh/go-gitea/gitea', {
        headers: { Accept: 'text/html', 'X-PJAX': 'true', 'X-PJAX-Container': '#issues' }
      }),
      targetUrl: 'https://github.com/go-gitea/gitea',
      config
    });
    await fetchGithubWeb({
      request: new Request('https://fast.example/gh/go-gitea/gitea', { method: 'POST' }),
      targetUrl: 'https://github.com/go-gitea/gitea',
      config
    });

    const githubFetchCalls = fetchSpy.mock.calls.filter(
      call => call[0] === 'https://github.com/go-gitea/gitea'
    );
    const cacheKeys = githubFetchCalls
      .map(call => /** @type {RequestInit & { cf?: { cacheKey?: string } }} */ (call[1]))
      .map(options => options.cf?.cacheKey)
      .filter(Boolean);
    const [[, firstGithubFetchOptions], , , , , [, lastGithubFetchOptions]] = githubFetchCalls;
    const cacheOptions = /** @type {RequestInit & { cf?: Record<string, unknown> } } */ (
      firstGithubFetchOptions
    );
    expect(cacheOptions.cf?.cacheEverything).toBe(true);
    expect(cacheOptions.cf?.cacheTtl).toBe(1800);
    expect(cacheKeys[0]).toContain('__xget_github_variant=html');
    expect(cacheKeys[1]).toContain('__xget_github_variant=json');
    expect(cacheKeys[2]).toContain('__xget_github_variant=fragment');
    expect(cacheKeys[3]).not.toBe(cacheKeys[4]);
    expect(new Set(cacheKeys).size).toBe(5);
    const nonGetOptions = /** @type {RequestInit & { cf?: Record<string, unknown> } } */ (
      lastGithubFetchOptions
    );
    expect(nonGetOptions.cf?.cacheEverything).toBe(false);
    expect(nonGetOptions.cf?.cacheKey).toBeUndefined();
  });

  it('keeps read-only GitHub links local and sends write links to GitHub', () => {
    const origin = 'https://fast.example';

    expect(rewriteGithubUrl('https://github.com/xixu-me/Xget/blob/main/README.md', origin)).toBe(
      `${origin}/gh/xixu-me/Xget/blob/main/README.md`
    );
    expect(rewriteGithubUrl('https://github.com/search?q=hermes&type=repositories', origin)).toBe(
      `${origin}/gh/search?q=hermes&type=repositories`
    );
    expect(rewriteGithubUrl('/go-gitea/gitea/security', origin)).toBe(
      `${origin}/gh/go-gitea/gitea/security`
    );
    expect(rewriteGithubUrl('/go-gitea/gitea/security/advisories/new', origin)).toBe(
      'https://github.com/go-gitea/gitea/security/advisories/new'
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

  it('rewrites relative metadata paths and embedded HTML links in JSON', () => {
    const rewritten = rewriteGithubJson(
      JSON.stringify({
        url: '/Homebrew/brew/commit/abc',
        tagsPath: '/Homebrew/brew/tags',
        shortMessageHtmlLink:
          '<a href="/Homebrew/brew/commit/abc" data-hovercard-url="/Homebrew/brew/pull/1/hovercard">commit</a>',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        externalUrl: 'https://example.com/repository'
      }),
      'https://fast.example'
    );

    expect(JSON.parse(rewritten)).toEqual({
      url: 'https://fast.example/gh/Homebrew/brew/commit/abc',
      tagsPath: 'https://fast.example/gh/Homebrew/brew/tags',
      shortMessageHtmlLink:
        '<a href="https://fast.example/gh/Homebrew/brew/commit/abc" data-hovercard-url="https://fast.example/gh/Homebrew/brew/pull/1/hovercard">commit</a>',
      avatarUrl: 'https://fast.example/_github/proxy/avatars.githubusercontent.com/u/1?v=4',
      externalUrl: 'https://example.com/repository'
    });
  });

  it('rewrites HTML attributes and absolute URLs while preserving unrelated links', () => {
    const html = `
      <a href="https://github.com/xixu-me/Xget">repo</a>
      <a href="/Homebrew/brew">relative repo</a>
      <a href="/xixu-me/Xget/issues/new">new issue</a>
      <a data-turbo-frame="repo-content-turbo-frame" href="/Homebrew/brew">frame target</a>
      <turbo-frame id="repo-content-turbo-frame" data-turbo-frame-src="/go-gitea/gitea/branches">
        branches
      </turbo-frame>
      <div data-custom-src="/go-gitea/gitea/branches">unrelated</div>
      <img src="https://github.githubassets.com/assets/app.js">
      <a href="https://docs.example.com">external</a>
    `;

    const rewritten = rewriteGithubHtml(html, 'https://fast.example');

    expect(rewritten).toContain('href="https://fast.example/gh/xixu-me/Xget"');
    expect(rewritten).toContain('href="https://fast.example/gh/Homebrew/brew"');
    expect(rewritten).toContain('href="https://github.com/xixu-me/Xget/issues/new"');
    expect(rewritten).toContain('data-turbo-frame="repo-content-turbo-frame"');
    expect(rewritten).not.toContain(
      'data-turbo-frame="https://fast.example/gh/repo-content-turbo-frame"'
    );
    expect(rewritten).toContain(
      'data-turbo-frame-src="https://fast.example/gh/go-gitea/gitea/branches"'
    );
    expect(rewritten).toContain('data-custom-src="/go-gitea/gitea/branches"');
    expect(rewritten).toContain(
      'src="https://fast.example/_github/proxy/github.githubassets.com/assets/app.js"'
    );
    expect(rewritten).toContain('href="https://docs.example.com"');
  });

  it('rewrites relative GitHub paths in embedded navigation data', () => {
    const html = `
      <script type="application/json">
        {
          "url": "/go-gitea/gitea/commits/main",
          "api": "/go-gitea/gitea/branches",
          "href": "/go-gitea/gitea/tags"
        }
      </script>
      <a href="/xixu-me/Xget/issues/new">write</a>
    `;

    const rewritten = rewriteGithubHtml(html, 'https://fast.example');

    expect(rewritten).toContain('"url": "https://fast.example/gh/go-gitea/gitea/commits/main"');
    expect(rewritten).toContain('"api": "https://fast.example/gh/go-gitea/gitea/branches"');
    expect(rewritten).toContain('"href": "https://fast.example/gh/go-gitea/gitea/tags"');
    expect(rewritten).toContain('href="https://github.com/xixu-me/Xget/issues/new"');
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
    expect(
      rewriteGithubText(
        'fetch("https://collector.github.com/github/collect")',
        'https://fast.example'
      )
    ).toBe('fetch("https://fast.example/_github/proxy/collector.github.com/github/collect")');
  });

  it('rewrites CSP proxy origins as path prefixes without matching nested hostnames', () => {
    expect(
      rewriteGithubCsp(
        'style-src github.githubassets.com; connect-src uploads.github.com gist.github.com github.com raw.githubusercontent.com collector.github.com',
        'https://fast.example'
      )
    ).toBe(
      'style-src https://fast.example/_github/proxy/github.githubassets.com/; connect-src uploads.github.com gist.github.com https://fast.example https://fast.example/_github/proxy/raw.githubusercontent.com/ https://fast.example/_github/proxy/collector.github.com/'
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
