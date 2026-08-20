import { createErrorResponse } from '../utils/security.js';

const SAFE_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-type',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'user-agent',
  'x-github-client-version',
  'x-pjax',
  'x-pjax-container',
  'x-requested-with',
  'x-turbo-frame'
]);

/**
 * Copies navigation headers and forwards the incoming Cookie header verbatim.
 * @param {Request} request
 * @returns {Headers} Sanitized navigation headers with the request Cookie header.
 */
export function getGithubRequestHeaders(request) {
  const headers = new Headers();

  for (const [key, value] of request.headers.entries()) {
    if (SAFE_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  if (!headers.has('Accept')) {
    headers.set('Accept', 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8');
  }

  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader !== null) {
    headers.set('Cookie', cookieHeader);
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
 * Fetches a GitHub Web resource. Bodies are only forwarded for an explicitly allowlisted endpoint.
 * @param {{ request: Request, targetUrl: string, config: { MAX_RETRIES: number, RETRY_DELAY_MS: number, TIMEOUT_SECONDS: number, CACHE_DURATION?: number }, forwardBody?: boolean }} options
 * @returns {Promise<{ response: Response, responseGeneratedLocally: boolean }>} Upstream result.
 */
export async function fetchGithubWeb({ request, targetUrl, config, forwardBody = false }) {
  const headers = getGithubRequestHeaders(request);
  const hasCookieHeader = request.headers.has('Cookie');
  const canUseSharedCache = request.method === 'GET' && !hasCookieHeader;
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
