import { runFilters } from '../filters/run-filters.js';
import { createErrorResponse } from '../utils/security.js';
import { finalizeConfiguredResponse } from './configured-response.js';
import { resolveSite, resolveSiteByTargetUrl } from './site-registry.js';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'cookie',
  'host',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const CLIENT_IDENTITY_HEADERS = new Set([
  'cf-connecting-ip',
  'cf-connecting-ipv6',
  'fastly-client-ip',
  'forwarded',
  'true-client-ip',
  'via',
  'x-client-ip',
  'x-cluster-client-ip',
  'x-envoy-external-address',
  'x-forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-originating-ip',
  'x-proxyuser-ip',
  'x-real-ip',
  'x-remote-addr',
  'x-remote-ip',
  'x-remote-user-ip'
]);

/**
 * @typedef {{ upstreamOrigin: string, allowedMethods: string[], proxyPolicy: { paths: 'all' | string[], timeoutSeconds: number, maxRetries: number, stripClientIdentityHeaders: boolean }, browserCapabilities: { forwardCredentials: boolean, rewriteSameOriginRedirects: boolean }, requestFilters: Array<(context: any) => any>, responseFilters: Array<(context: any) => any> }} ConfiguredSite
 */

/**
 * Tests whether a configured site's path policy accepts a request path.
 * @param {{ proxyPolicy?: { paths?: 'all' | string[] } }} site
 * @param {string} pathname
 * @returns {boolean} Whether the path is allowed by the configured policy.
 */
export function isConfiguredPathAllowed(site, pathname) {
  const paths = site.proxyPolicy?.paths || 'all';
  if (paths === 'all') return true;
  if (!Array.isArray(paths)) return false;
  return paths.some(pattern => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
    return new RegExp(`^${escaped}$`).test(pathname);
  });
}

/**
 * Builds headers for a configuration-backed site without changing its credential names.
 * @param {Request} request
 * @param {URL} upstreamUrl
 * @param {{ browserCapabilities?: { forwardCredentials?: boolean }, proxyPolicy?: { stripClientIdentityHeaders?: boolean } }} site
 * @returns {Headers} Headers safe to send upstream.
 */
function getConfiguredHeaders(request, upstreamUrl, site) {
  const headers = new Headers();
  const mirrorOrigin = new URL(request.url).origin;
  for (const [key, value] of request.headers) {
    const normalizedKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalizedKey)) continue;
    if (
      site.proxyPolicy?.stripClientIdentityHeaders &&
      CLIENT_IDENTITY_HEADERS.has(normalizedKey)
    ) {
      continue;
    }
    if (
      ['authorization', 'cookie'].includes(normalizedKey) &&
      !site.browserCapabilities?.forwardCredentials
    ) {
      continue;
    }
    if (normalizedKey === 'origin' && value === mirrorOrigin) {
      headers.set(key, upstreamUrl.origin);
    } else if (normalizedKey === 'referer') {
      try {
        const referer = new URL(value);
        headers.set(
          key,
          referer.origin === mirrorOrigin
            ? `${upstreamUrl.origin}${referer.pathname}${referer.search}`
            : value
        );
      } catch {
        // Drop malformed Referer values rather than creating an invalid upstream request.
      }
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

/**
 * Fetches an upstream response with a bounded timeout and safe-method retry policy.
 * @param {Request} request
 * @param {{ proxyPolicy?: { timeoutSeconds?: number, maxRetries?: number } }} site
 * @param {URL} targetUrl
 * @param {Headers} headers
 * @returns {Promise<Response>} Upstream response after safe retries.
 */
async function fetchConfiguredUpstream(request, site, targetUrl, headers) {
  const canRetry = request.method === 'GET' || request.method === 'HEAD';
  const retries = Math.max(0, Math.min(site.proxyPolicy?.maxRetries || 0, 2));
  const attempts = canRetry ? retries + 1 : 1;
  const timeoutMilliseconds =
    Math.max(1, Math.min(site.proxyPolicy?.timeoutSeconds || 20, 30)) * 1000;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
    try {
      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'manual',
        signal: controller.signal
      });
      if (!canRetry || !RETRYABLE_STATUS_CODES.has(response.status) || attempt === attempts - 1) {
        return response;
      }
      response.body?.cancel();
    } catch (error) {
      lastError = error;
      if (!canRetry || attempt === attempts - 1) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error('Configured upstream did not return a response');
}

/**
 * Proxies a request handled by a configuration-only adapter.
 * @param {Request} request
 * @returns {Promise<Response | null>} The upstream response, or null when another adapter owns the host.
 */
export async function handleConfiguredSiteRequest(request) {
  const mirrorUrl = new URL(request.url);
  const site = resolveSite(mirrorUrl.hostname);
  if (!site || site.adapter !== 'configured') return null;
  const targetUrl = new URL(site.upstreamOrigin);
  targetUrl.pathname = mirrorUrl.pathname;
  targetUrl.search = mirrorUrl.search;
  return await proxyConfiguredRequest(request, /** @type {ConfiguredSite} */ (site), targetUrl);
}

/**
 * Proxies a request through a fixed configured site.
 * @param {Request} request
 * @param {ConfiguredSite | null} site
 * @param {URL} targetUrl
 * @returns {Promise<Response | null>} Proxied response, or null for an unconfigured target.
 */
async function proxyConfiguredRequest(request, site, targetUrl) {
  if (!site || !site.allowedMethods) return null;
  if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
    return new Response('WebSocket is not supported by this proxy', { status: 426 });
  }
  if (!isConfiguredPathAllowed(site, targetUrl.pathname)) {
    return new Response('Path not allowed', { status: 403 });
  }
  if (!site.allowedMethods.includes(request.method)) {
    return new Response('Method not allowed', { status: 405 });
  }

  const requestContext = await runFilters({ request, site, targetUrl }, site.requestFilters || []);
  const response = await fetchConfiguredUpstream(
    request,
    site,
    requestContext.targetUrl,
    getConfiguredHeaders(request, requestContext.targetUrl, site)
  );
  const responseContext = await runFilters(
    { request, response, site, targetUrl: requestContext.targetUrl },
    site.responseFilters || []
  );
  return await finalizeConfiguredResponse({
    request,
    response: responseContext.response,
    site,
    targetUrl: requestContext.targetUrl
  });
}

/**
 * Proxies a full URL only when its origin is a configured HTTPS upstream.
 * @param {Request} request
 * @param {URL} targetUrl
 * @returns {Promise<Response | null>}
 */
export async function handleConfiguredTargetRequest(request, targetUrl) {
  const site = resolveSiteByTargetUrl(targetUrl);
  return await proxyConfiguredRequest(
    request,
    /** @type {ConfiguredSite | null} */ (site),
    targetUrl
  );
}

/**
 * Proxies an HTTPS target without requiring a registered site. This is intended
 * only for authenticated transparent proxy deployments.
 * @param {Request} request
 * @param {URL} targetUrl
 * @param {import('../config/index.js').ApplicationConfig} config
 * @returns {Promise<Response | null>}
 */
export async function handleTransparentTargetRequest(request, targetUrl, config) {
  if (targetUrl.protocol !== 'https:' || targetUrl.username || targetUrl.password) return null;

  /** @type {ConfiguredSite} */
  const site = {
    upstreamOrigin: targetUrl.origin,
    allowedMethods: config.SECURITY.ALLOWED_METHODS,
    proxyPolicy: {
      paths: /** @type {'all'} */ ('all'),
      timeoutSeconds: config.TIMEOUT_SECONDS,
      maxRetries: config.MAX_RETRIES,
      stripClientIdentityHeaders: true
    },
    browserCapabilities: {
      forwardCredentials: false,
      rewriteSameOriginRedirects: false
    },
    requestFilters: [],
    responseFilters: []
  };

  const response = await proxyConfiguredRequest(request, site, targetUrl);
  if (!response || ![301, 302, 303, 307, 308].includes(response.status)) return response;
  const location = response.headers.get('Location');
  if (location === null) return response;

  let redirectTarget;
  try {
    redirectTarget = new URL(location, targetUrl);
    if (
      redirectTarget.protocol !== 'https:' ||
      redirectTarget.username ||
      redirectTarget.password
    ) {
      throw new Error('Invalid redirect target');
    }
  } catch {
    await response.body?.cancel();
    return createErrorResponse('Invalid upstream redirect target', 502);
  }

  // Keep the browser's redirect chain on the proxy origin, including relative redirects.
  const proxyUrl = new URL('/', request.url);
  proxyUrl.searchParams.set('target', redirectTarget.toString());
  proxyUrl.hash = redirectTarget.hash;
  response.headers.set('Location', proxyUrl.toString());
  response.headers.delete('Refresh');
  return response;
}
