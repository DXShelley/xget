import { validateDockerCredential } from '../auth/browser.js';
import {
  fetchToken,
  getScopeFromUrl,
  handleDockerAuth,
  parseAuthenticate,
  readRegistryTokenResponse,
  responseUnauthorized
} from '../protocols/docker.js';
import { normalizeEffectivePath } from '../routing/resolve-target.js';
import { addSecurityHeaders } from '../utils/security.js';
import {
  allowAnonymous,
  createProtocolAdapter,
  isAuthenticationRequired,
  stripProxyAuthentication
} from './base.js';

/** @param {URL} url @returns {Response} */
function dockerAuthenticationChallenge(url) {
  const realmPath = url.pathname.startsWith('/cr/')
    ? `/cr/${url.pathname.split('/')[2]}/v2/auth`
    : '/v2/auth';
  return new Response('Docker authentication required', {
    headers: {
      'Cache-Control': 'no-store',
      'Docker-Distribution-Api-Version': 'registry/2.0',
      'WWW-Authenticate': `Bearer realm="${url.origin}${realmPath}",service="xget"`
    },
    status: 401
  });
}

/** @param {Response} response @param {string} targetUrl @param {RequestInit} fetchOptions */
async function followRedirect(response, targetUrl, fetchOptions) {
  if (![301, 302, 303, 307, 308].includes(response.status)) return response;
  const location = response.headers.get('Location');
  if (!location) return response;

  const headers = new Headers(fetchOptions.headers);
  headers.delete('Authorization');
  return await fetch(new URL(location, targetUrl), {
    ...fetchOptions,
    headers,
    redirect: 'follow'
  });
}

/**
 * Follows Docker redirects through the adapter's credential-stripping policy.
 * @param {Response} response Upstream response.
 * @param {{ fetchOptions: RequestInit, targetUrl: string }} options Fetch context.
 * @returns {Promise<Response>} A response safe to return to the pipeline.
 */
async function transformDockerFetchedResponse(response, { fetchOptions, targetUrl }) {
  return await followRedirect(response, targetUrl, fetchOptions);
}

export const DOCKER_ADAPTER = createProtocolAdapter({
  kind: 'docker',
  allowsSharedCache: () => false,
  preserveUpstreamAuthenticationChallenge: true,
  usesProtocolSemantics: true,
  /** @param {{ env: Record<string, unknown>, request: Request, url: URL }} context */
  authenticate: async context => {
    if (context.url.pathname.includes('/v2/auth')) return allowAnonymous();
    const principal = await validateDockerCredential(context.request, context.env);
    if (principal) return { principal, response: null };
    return isAuthenticationRequired(context.env)
      ? { principal: null, response: dockerAuthenticationChallenge(context.url) }
      : allowAnonymous();
  },
  /** @param {{ headers: Headers, principal?: { authMethod: string } | null }} options */
  prepareUpstreamHeaders: ({ headers, principal }) => {
    if (principal?.authMethod === 'docker-basic' || principal?.authMethod === 'docker-bearer')
      stripProxyAuthentication(headers);
  },
  /** @param {RequestInit} options */
  configureFetchOptions: options => ({ ...options, redirect: 'manual' }),
  /** @param {{ config: import('../config/index.js').ApplicationConfig, env: Record<string, unknown>, request: Request, url: URL }} context */
  handleProtocolRoute: async context => {
    const { url } = context;
    if (url.pathname === '/v2/' || url.pathname === '/v2') {
      const headers = new Headers({
        'Docker-Distribution-Api-Version': 'registry/2.0',
        'Content-Type': 'application/json'
      });
      addSecurityHeaders(headers);
      return new Response('{}', { status: 200, headers });
    }
    if (url.pathname === '/v2/auth' || /^\/cr\/[^/]+\/v2\/auth\/?$/.test(url.pathname)) {
      return await handleDockerAuth(context.request, url, context.config, context.env);
    }
    return null;
  },
  /** @param {{ url: URL }} context */
  normalizePath: context => normalizeEffectivePath(context.url, true),
  transformFetchedResponse: transformDockerFetchedResponse,
  /** @param {{ effectivePath: string, fetchOptions: RequestInit, platform: string, requestContext: { url: URL }, requestHeaders: Headers, response: Response, signal: AbortSignal, targetUrl: string }} options */
  retryUnauthorized: async ({
    effectivePath,
    fetchOptions,
    platform,
    requestContext,
    requestHeaders,
    response,
    signal,
    targetUrl
  }) => {
    const authenticate = response.headers.get('WWW-Authenticate');
    const scope = getScopeFromUrl(requestContext.url, effectivePath, platform);
    if (!authenticate) return responseUnauthorized(requestContext.url, platform);

    try {
      const tokenResponse = await fetchToken(
        parseAuthenticate(authenticate),
        scope || '',
        '',
        signal
      );
      if (!tokenResponse.ok) return responseUnauthorized(requestContext.url, platform);
      const token = await readRegistryTokenResponse(tokenResponse);
      if (!token) return responseUnauthorized(requestContext.url, platform);

      const headers = new Headers(requestHeaders);
      headers.set('Authorization', `Bearer ${token}`);
      const retryOptions = /** @type {RequestInit} */ ({
        ...fetchOptions,
        headers,
        redirect: 'manual'
      });
      const retryResponse = await fetch(targetUrl, retryOptions);
      const redirectedResponse = await followRedirect(retryResponse, targetUrl, retryOptions);
      return redirectedResponse.ok
        ? redirectedResponse
        : responseUnauthorized(requestContext.url, platform);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      console.warn('Token fetch failed:', error);
      return responseUnauthorized(requestContext.url, platform);
    }
  }
});
