import { createErrorResponse } from '../utils/security.js';

const HOP_BY_HOP_HEADERS = new Set(['connection', 'content-length', 'host', 'proxy-connection']);

/**
 * Builds the mirror cookie prefix for one upstream host.
 * @param {string} host
 * @returns {string} Cookie prefix.
 */
function getCookiePrefix(host) {
  return `__xget_gh_${host.replace(/[^a-z0-9]/gi, '_')}__`;
}

/**
 * Selects cookies owned by the target upstream host.
 * @param {string | null} value
 * @param {string} upstreamHost
 * @returns {string} Upstream Cookie header value.
 */
function getGithubCookieHeader(value, upstreamHost) {
  const prefix = getCookiePrefix(upstreamHost);
  return (value || '')
    .split(/;\s*/)
    .filter(/** @param {string} cookie */ cookie => cookie.startsWith(prefix))
    .map(/** @param {string} cookie */ cookie => cookie.slice(prefix.length))
    .join('; ');
}

/**
 * Converts a same-origin proxy referrer to its GitHub Web equivalent.
 * @param {string} value
 * @param {string} requestUrl
 * @param {string} upstreamHost
 * @returns {string | null} Normalized GitHub referrer, or null when unsafe.
 */
function normalizeGithubReferer(value, requestUrl, upstreamHost) {
  try {
    const referer = new URL(value);
    const requestOrigin = new URL(requestUrl).origin;
    if (referer.origin !== requestOrigin || referer.pathname.startsWith('/_github/')) {
      return null;
    }

    const pathname = referer.pathname.startsWith('/gh/')
      ? referer.pathname.slice('/gh'.length)
      : referer.pathname;
    return `https://${upstreamHost}${pathname}${referer.search}`;
  } catch {
    return null;
  }
}

/**
 * Copies GitHub Web request headers and target-host-scoped credentials.
 * @param {Request} request
 * @param {string} [upstreamHost]
 * @returns {Headers} Sanitized navigation headers.
 */
export function getGithubRequestHeaders(request, upstreamHost = 'github.com') {
  const headers = new Headers();

  for (const [key, value] of request.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (
      !HOP_BY_HOP_HEADERS.has(lowerKey) &&
      lowerKey !== 'cookie' &&
      lowerKey !== 'authorization'
    ) {
      if (lowerKey === 'referer') {
        const normalizedReferer = normalizeGithubReferer(value, request.url, upstreamHost);
        if (normalizedReferer) {
          headers.set(key, normalizedReferer);
        }
      } else {
        headers.set(key, value);
      }
    }
  }

  const cookie = getGithubCookieHeader(request.headers.get('Cookie'), upstreamHost);
  if (cookie) headers.set('Cookie', cookie);
  const authorization = request.headers.get('Authorization');
  if (authorization) headers.set('Authorization', authorization);
  const origin = request.headers.get('Origin');
  if (origin) headers.set('Origin', `https://${upstreamHost}`);

  if (!headers.has('Accept')) {
    headers.set('Accept', 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8');
  }

  // GitHub's repository metadata endpoints reject browser JSON fetches without
  // this marker (406). Some browsers/extensions omit it, so restore the
  // semantic marker from the representation requested by the client.
  if (
    !headers.has('X-Requested-With') &&
    headers.get('Accept')?.toLowerCase().includes('application/json') &&
    !headers.get('Accept')?.toLowerCase().includes('text/html')
  ) {
    headers.set('X-Requested-With', 'XMLHttpRequest');
  }

  headers.set('Accept-Encoding', 'gzip, deflate, br');
  return headers;
}

/**
 * Classifies the representation expected by a GitHub Web request.
 * @param {Request} request
 * @returns {'html' | 'json' | 'fragment' | `fragment-${string}` | 'other'} Cache representation variant.
 */
function getGithubCacheVariant(request) {
  const accept = (request.headers.get('Accept') || '').toLowerCase();
  const hasJsonOnlyAccept =
    accept.includes('application/json') &&
    !accept.includes('text/html') &&
    !accept.includes('application/xhtml+xml');
  const isFragmentRequest =
    request.headers.has('X-PJAX') ||
    request.headers.has('X-PJAX-Container') ||
    request.headers.has('X-Turbo-Frame') ||
    request.headers.get('X-Requested-With')?.toLowerCase() === 'xmlhttprequest';

  if (hasJsonOnlyAccept) {
    return 'json';
  }

  if (isFragmentRequest) {
    const target =
      request.headers.get('X-PJAX-Container') || request.headers.get('X-Turbo-Frame') || '';

    return target ? `fragment-${target.slice(0, 96)}` : 'fragment';
  }

  if (
    accept.includes('text/html') ||
    accept.includes('application/xhtml+xml') ||
    request.headers.get('Sec-Fetch-Mode') === 'navigate'
  ) {
    return 'html';
  }

  return 'other';
}

/**
 * Builds a representation-specific Cloudflare cache key without changing the upstream URL.
 * @param {string} targetUrl
 * @param {Request} request
 * @returns {string} Cache key for the upstream representation.
 */
function getGithubCacheKey(targetUrl, request) {
  const cacheKey = new URL(targetUrl);
  cacheKey.searchParams.set('__xget_github_variant', getGithubCacheVariant(request));
  return cacheKey.toString();
}

/**
 * Fetches a GitHub Web resource and forwards bodies for non-GET browser requests.
 * @param {{ request: Request, targetUrl: string, config: { MAX_RETRIES: number, RETRY_DELAY_MS: number, TIMEOUT_SECONDS: number, CACHE_DURATION?: number }, forwardBody?: boolean }} options
 * @returns {Promise<{ response: Response, responseGeneratedLocally: boolean }>} Upstream result.
 */
export async function fetchGithubWeb({ request, targetUrl, config, forwardBody = false }) {
  const upstreamHost = new URL(targetUrl).hostname;
  const headers = getGithubRequestHeaders(request, upstreamHost);
  const canUseSharedCache =
    request.method === 'GET' &&
    !request.headers.has('X-Fetch-Nonce') &&
    !request.headers.has('Authorization') &&
    !request.headers.has('Cookie');
  const shouldForwardBody =
    forwardBody && request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null;
  const maxRetries = shouldForwardBody ? 1 : Math.max(1, Number(config.MAX_RETRIES) || 1);
  let response;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let timeoutId;

    try {
      const controller = new AbortController();
      timeoutId = setTimeout(
        () => controller.abort(),
        (Number(config.TIMEOUT_SECONDS) || 30) * 1000
      );

      /** @type {RequestInit & { cf?: Record<string, unknown> }} */
      const fetchOptions = {
        method: request.method,
        headers,
        body: shouldForwardBody ? request.body : undefined,
        redirect: 'manual',
        signal: controller.signal,
        cf: {
          http3: true,
          cacheTtl: canUseSharedCache ? Number(config.CACHE_DURATION) || 0 : 0,
          cacheEverything: canUseSharedCache,
          ...(canUseSharedCache ? { cacheKey: getGithubCacheKey(targetUrl, request) } : {}),
          preconnect: true
        }
      };
      response = await fetch(targetUrl, fetchOptions);

      if (response.status < 500 || attempt === maxRetries - 1) {
        return { response, responseGeneratedLocally: false };
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          response: createErrorResponse('Request timeout', 408),
          responseGeneratedLocally: true
        };
      }

      if (attempt === maxRetries - 1) {
        return {
          response: createErrorResponse('Upstream request failed', 502),
          responseGeneratedLocally: true
        };
      }
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }

    if (attempt < maxRetries - 1 && Number(config.RETRY_DELAY_MS) > 0) {
      await new Promise(resolve =>
        setTimeout(resolve, Number(config.RETRY_DELAY_MS) * (attempt + 1))
      );
    }
  }

  return {
    response: createErrorResponse('Upstream request failed', 502),
    responseGeneratedLocally: true
  };
}
