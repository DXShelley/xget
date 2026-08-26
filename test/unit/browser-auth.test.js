import { describe, expect, it, vi } from 'vitest';
import {
  gitAuthenticationChallenge,
  handleBrowserAuth,
  validateBrowserSession,
  validateDockerCredential,
  validateGitCredential
} from '../../src/auth/browser.js';
import { handleRequest } from '../../src/app/handle-request.js';

const env = {
  XGET_AUTH_REQUIRED: 'true',
  XGET_LOGIN_SECRET: 'login-secret',
  XGET_SESSION_SECRET: 'session-secret'
};

describe('browser authentication', () => {
  it('returns a non-cacheable login page', async () => {
    const response = await handleBrowserAuth(
      new Request('https://fast.example/__xget/auth/login'),
      env
    );
    if (!response) throw new Error('Expected login response');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toContain('form');
  });

  it('issues and validates a 90-day session cookie', async () => {
    const response = await handleBrowserAuth(
      new Request('https://fast.example/__xget/auth/login', {
        body: new URLSearchParams({ secret: 'login-secret' }),
        method: 'POST'
      }),
      env
    );
    if (!response) throw new Error('Expected login response');
    expect(response.status).toBe(303);
    const cookie = response.headers.get('Set-Cookie');
    if (!cookie) throw new Error('Expected session cookie');
    expect(cookie).toContain('__Host-xget_session=');
    expect(cookie).toContain('Max-Age=7776000');
    const principal = await validateBrowserSession(
      new Request('https://fast.example/', { headers: { Cookie: cookie.split(';')[0] } }),
      env
    );
    expect(principal).toMatchObject({ id: 'browser-user', authMethod: 'browser-session' });
  });

  it('rejects an invalid secret and tampered session', async () => {
    const failed = await handleBrowserAuth(
      new Request('https://fast.example/__xget/auth/login', {
        body: new URLSearchParams({ secret: 'wrong' }),
        method: 'POST'
      }),
      env
    );
    if (!failed) throw new Error('Expected failed login response');
    expect(failed.status).toBe(401);
    expect(
      await validateBrowserSession(
        new Request('https://fast.example/', {
          headers: { Cookie: '__Host-xget_session=bad.value' }
        }),
        env
      )
    ).toBeNull();
  });

  it('does not allow an external return URL', async () => {
    const response = await handleBrowserAuth(
      new Request('https://fast.example/__xget/auth/login?return_to=https://evil.example', {
        body: JSON.stringify({ secret: 'login-secret' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      }),
      env
    );
    if (!response) throw new Error('Expected login response');
    expect(response.headers.get('Location')).toBe('/');
  });

  it('blocks the main request before proxy routing when unauthenticated', async () => {
    const response = await handleRequest(
      new Request('https://fast.example/npm/example'),
      env,
      /** @type {ExecutionContext} */ ({ waitUntil() {}, passThroughOnException() {} })
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain('/__xget/auth/login');
  });

  it('does not turn protocol requests into browser redirects', async () => {
    const response = await handleRequest(
      new Request('https://fast.example/cr/docker/v2/library/alpine/manifests/latest', {
        headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' }
      }),
      env,
      /** @type {ExecutionContext} */ ({ waitUntil() {}, passThroughOnException() {} })
    );
    expect(response.status).not.toBe(302);
  });

  it('issues a 90-day Git credential and validates Git Basic credentials', async () => {
    const browserLogin = await handleBrowserAuth(
      new Request('https://git.example/__xget/auth/login', {
        body: new URLSearchParams({ secret: 'login-secret' }),
        method: 'POST'
      }),
      env
    );
    if (!browserLogin) throw new Error('Expected browser login response');
    const browserCookie = browserLogin.headers.get('Set-Cookie');
    if (!browserCookie) throw new Error('Expected browser session cookie');
    const tokenResponse = await handleBrowserAuth(
      new Request('https://git.example/__xget/auth/git-token', {
        headers: { Cookie: browserCookie.split(';')[0] },
        method: 'POST'
      }),
      env
    );
    if (!tokenResponse) throw new Error('Expected Git token response');
    const { token } = await tokenResponse.json();
    const request = new Request('https://git.example/user/repo.git/info/refs', {
      headers: { Authorization: `Basic ${btoa(`xget:${token}`)}` }
    });
    expect(await validateGitCredential(request, env)).toMatchObject({
      authMethod: 'git-basic',
      id: 'git:browser-user'
    });
    expect(await validateGitCredential(new Request(request.url), env)).toBeNull();
    const challenge = gitAuthenticationChallenge();
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get('WWW-Authenticate')).toContain('Basic');
  });

  it('passes an authenticated Git request through the main handler', async () => {
    const browserLogin = await handleBrowserAuth(
      new Request('https://git.example/__xget/auth/login', {
        body: new URLSearchParams({ secret: 'login-secret' }),
        method: 'POST'
      }),
      env
    );
    if (!browserLogin) throw new Error('Expected browser login response');
    const browserCookie = browserLogin.headers.get('Set-Cookie');
    if (!browserCookie) throw new Error('Expected browser session cookie');
    const tokenResponse = await handleBrowserAuth(
      new Request('https://git.example/__xget/auth/git-token', {
        headers: { Cookie: browserCookie.split(';')[0] },
        method: 'POST'
      }),
      env
    );
    if (!tokenResponse) throw new Error('Expected Git token response');
    const { token } = await tokenResponse.json();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('refs'));
    try {
      const response = await handleRequest(
        new Request('https://git.dxshelley.fun/user/repo.git/info/refs', {
          headers: {
            Authorization: `Basic ${btoa(`xget:${token}`)}`,
            'User-Agent': 'git/2.40.0'
          }
        }),
        env,
        /** @type {ExecutionContext} */ ({ waitUntil() {}, passThroughOnException() {} })
      );
      expect(response.status).not.toBe(401);
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('accepts the configured login secret for the simple first-use flow', async () => {
    const request = new Request('https://git.example/user/repo.git/info/refs', {
      headers: { Authorization: `Basic ${btoa('yuzq:login-secret')}` }
    });
    expect(await validateGitCredential(request, env)).toMatchObject({
      authMethod: 'git-basic',
      id: 'git:yuzq'
    });
  });

  it('accepts the Docker access token in both Basic and Bearer forms', async () => {
    const browserLogin = await handleBrowserAuth(
      new Request('https://git.example/__xget/auth/login', {
        body: new URLSearchParams({ secret: 'login-secret' }),
        method: 'POST'
      }),
      env
    );
    if (!browserLogin) throw new Error('Expected browser login response');
    const cookie = browserLogin.headers.get('Set-Cookie');
    if (!cookie) throw new Error('Expected browser session cookie');
    const tokenResponse = await handleBrowserAuth(
      new Request('https://git.example/__xget/auth/git-token', {
        headers: { Cookie: cookie.split(';')[0] },
        method: 'POST'
      }),
      env
    );
    if (!tokenResponse) throw new Error('Expected access token response');
    const { token } = await tokenResponse.json();
    const basic = new Request('https://docker.example/v2/', {
      headers: { Authorization: `Basic ${btoa(`xget:${token}`)}` }
    });
    const bearer = new Request('https://docker.example/v2/', {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(await validateDockerCredential(basic, env)).toMatchObject({
      authMethod: 'docker-bearer'
    });
    expect(await validateDockerCredential(bearer, env)).toMatchObject({
      authMethod: 'docker-bearer'
    });
  });

  it('accepts the configured login secret for Docker first-use login', async () => {
    const request = new Request('https://docker.example/v2/', {
      headers: { Authorization: `Basic ${btoa('xget:login-secret')}` }
    });
    expect(await validateDockerCredential(request, env)).toMatchObject({
      authMethod: 'docker-basic',
      id: 'docker:basic'
    });
  });
});
