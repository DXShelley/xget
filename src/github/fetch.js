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
 * Copies only navigation headers that do not carry user credentials.
 * @param {Request} request
 * @returns {Headers} Sanitized navigation headers.
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

  headers.set('Accept-Encoding', 'gzip, deflate, br');
  return headers;
}

/**
 * Fetches a public GitHub Web resource without forwarding credentials. Bodies are only forwarded for an explicitly allowlisted endpoint.
 * @param {{ request: Request, targetUrl: string, config: { MAX_RETRIES: number, RETRY_DELAY_MS: number, TIMEOUT_SECONDS: number, CACHE_DURATION?: number }, forwardBody?: boolean }} options
 * @returns {Promise<{ response: Response, responseGeneratedLocally: boolean }>} Upstream result.
 */
export async function fetchGithubWeb({ request, targetUrl, config, forwardBody = false }) {
  const headers = getGithubRequestHeaders(request);
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
          cacheTtl: Number(config.CACHE_DURATION) || 0,
          cacheEverything: request.method === 'GET',
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
