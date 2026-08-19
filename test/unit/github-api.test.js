import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearGithubApiTokenCache, fetchGithubApi } from '../../src/github/api.js';

afterEach(() => {
  clearGithubApiTokenCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const config = {
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 0,
  TIMEOUT_SECONDS: 5,
  GITHUB_API_CACHE_DURATION: 60
};

describe('GitHub REST API transport', () => {
  it('uses anonymous API access when the GitHub App is not configured', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }));

    const result = await fetchGithubApi({
      request: new Request('https://fast.example/_github/proxy/api.github.com/repos/a/b/commits'),
      targetUrl: 'https://api.github.com/repos/a/b/commits?sha=main',
      config,
      env: {}
    });

    expect(result.response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [[, rawOptions]] = fetchSpy.mock.calls;
    const options = /** @type {RequestInit & { cf?: Record<string, unknown> }} */ (rawOptions);
    const headers = new Headers(options.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('Accept')).toBe('application/vnd.github+json');
    expect(headers.get('X-GitHub-Api-Version')).toBe('2022-11-28');
    expect(options.cf?.cacheEverything).toBe(true);
    expect(options.cf?.cacheTtl).toBe(60);
    expect(options.cf?.cacheTtlByStatus).toEqual({
      '200-299': 60,
      '300-399': 0,
      '400-599': 0
    });
    expect(options.cf?.cacheKey).toContain('__xget_github_api=1');
  });

  it('exchanges a GitHub App JWT for an installation token without exposing it in the cache key', async () => {
    vi.stubGlobal('crypto', {
      subtle: {
        importKey: vi.fn().mockResolvedValue('test-key'),
        sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
      }
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ token: 'installation-secret', expires_at: '2099-01-01T00:00:00Z' }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));

    await fetchGithubApi({
      request: new Request('https://fast.example/api'),
      targetUrl: 'https://api.github.com/repos/a/b/branches',
      config,
      env: {
        GITHUB_APP_ID: '1234',
        GITHUB_APP_INSTALLATION_ID: '5678',
        GITHUB_APP_PRIVATE_KEY:
          '-----BEGIN RSA PRIVATE KEY-----\nAQ==\n-----END RSA PRIVATE KEY-----'
      }
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [[tokenUrl], [apiUrl, rawApiOptions]] = fetchSpy.mock.calls;
    expect(tokenUrl).toBe('https://api.github.com/app/installations/5678/access_tokens');
    expect(apiUrl).toBe('https://api.github.com/repos/a/b/branches');
    const apiOptions = /** @type {RequestInit & { cf?: { cacheKey?: string } }} */ (rawApiOptions);
    const apiHeaders = new Headers(apiOptions?.headers);
    expect(apiHeaders.get('Authorization')).toBe('Bearer installation-secret');
    expect(apiOptions.cf?.cacheKey).not.toContain('installation-secret');
    expect(apiOptions.cf?.cacheKey).toContain('__xget_github_api=1');
  });

  it('does not retry API rate limits', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"message":"rate limited"}', { status: 429 }));

    const result = await fetchGithubApi({
      request: new Request('https://fast.example/api'),
      targetUrl: 'https://api.github.com/repos/a/b/tags',
      config,
      env: {}
    });

    expect(result.response.status).toBe(429);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to anonymous access when the App API is rate limited', async () => {
    vi.stubGlobal('crypto', {
      subtle: {
        importKey: vi.fn().mockResolvedValue('test-key'),
        sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
      }
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ token: 'installation-secret', expires_at: '2099-01-01T00:00:00Z' }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response('{"message":"rate limited"}', {
          status: 403,
          headers: { 'X-RateLimit-Remaining': '0' }
        })
      );

    const result = await fetchGithubApi({
      request: new Request('https://fast.example/api'),
      targetUrl: 'https://api.github.com/repos/a/b/commits',
      config,
      env: {
        GITHUB_APP_ID: '1234',
        GITHUB_APP_INSTALLATION_ID: '5678',
        GITHUB_APP_PRIVATE_KEY:
          '-----BEGIN RSA PRIVATE KEY-----\nAQ==\n-----END RSA PRIVATE KEY-----'
      }
    });

    expect(result.response.status).toBe(403);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to anonymous API access when the App cannot access a public repository', async () => {
    vi.stubGlobal('crypto', {
      subtle: {
        importKey: vi.fn().mockResolvedValue('test-key'),
        sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
      }
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ token: 'installation-secret', expires_at: '2099-01-01T00:00:00Z' }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(new Response('{"message":"not accessible"}', { status: 401 }))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));

    const result = await fetchGithubApi({
      request: new Request('https://fast.example/api'),
      targetUrl: 'https://api.github.com/repos/a/b/commits',
      config,
      env: {
        GITHUB_APP_ID: '1234',
        GITHUB_APP_INSTALLATION_ID: '5678',
        GITHUB_APP_PRIVATE_KEY:
          '-----BEGIN RSA PRIVATE KEY-----\nAQ==\n-----END RSA PRIVATE KEY-----'
      }
    });

    expect(result.response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const [, appApiCall, anonymousApiCall] = fetchSpy.mock.calls;
    const [, appApiOptions] = appApiCall;
    const [, anonymousApiOptions] = anonymousApiCall;
    const appApiHeaders = new Headers(appApiOptions?.headers);
    const anonymousApiHeaders = new Headers(anonymousApiOptions?.headers);
    expect(appApiHeaders.get('Authorization')).toBe('Bearer installation-secret');
    expect(anonymousApiHeaders.get('Authorization')).toBeNull();
    const typedAppApiOptions =
      /** @type {RequestInit & { cf?: { cacheTtlByStatus?: Record<string, number> } }} */ (
        appApiOptions
      );
    expect(typedAppApiOptions?.cf?.cacheTtlByStatus).toEqual({
      '200-299': 60,
      '300-399': 0,
      '400-599': 0
    });
  });
});
