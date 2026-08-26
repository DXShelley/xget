import { describe, expect, it } from 'vitest';
import { handleBrowserAuth, validateBrowserSession } from '../../src/auth/browser.js';
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
});
