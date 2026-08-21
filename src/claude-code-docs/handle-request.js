import { handleConfiguredTargetRequest } from '../proxy/handle-configured-site.js';
import { getDefaultCache } from '../upstream/cache.js';
import { createErrorResponse } from '../utils/security.js';

const STALE_FALLBACK_STATUSES = new Set([500, 502, 503, 504]);

/**
 * Builds a GET-only cache key for a browser-facing documentation URL.
 * @param {Request} request Browser request.
 * @returns {Request} Cache key.
 */
function createCacheKey(request) {
  return new Request(request.url, { method: 'GET' });
}

/**
 * Creates the internal cache entry without changing the browser response.
 * @param {Response} response Successful browser response.
 * @returns {Response} Cacheable response copy.
 */
function createCacheEntry(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'public, max-age=300');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/**
 * Reads a previous public document and marks it as a stale fallback.
 * @param {Cache | null} cache Workers cache when available.
 * @param {Request} cacheKey Documentation cache key.
 * @returns {Promise<Response | null>} Stale response when present.
 */
async function getStaleResponse(cache, cacheKey) {
  if (!cache) return null;
  try {
    const cached = await cache.match(cacheKey);
    if (!cached) return null;
    const headers = new Headers(cached.headers);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Xget-Cache', 'stale');
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers
    });
  } catch (error) {
    console.warn('Claude Code documentation cache read failed:', error);
    return null;
  }
}

/**
 * Proxies public Claude Code documentation with a bounded stale fallback.
 * @param {{ request: Request, site: { id: string }, targetUrl: URL }} options
 * @returns {Promise<Response | null>} A handled response, or null for another site/path.
 */
export async function handleClaudeCodeDocsRequest({ request, site, targetUrl }) {
  if (site.id !== 'claude-code' || !targetUrl.pathname.startsWith('/docs')) return null;

  const cache = request.method === 'GET' ? getDefaultCache() : null;
  const cacheKey = cache ? createCacheKey(request) : null;
  let response;
  try {
    response = await handleConfiguredTargetRequest(request, targetUrl);
  } catch (error) {
    const cached = await getStaleResponse(cache, /** @type {Request} */ (cacheKey));
    if (cached) return cached;
    console.warn('Claude Code documentation upstream request failed:', error);
    return createErrorResponse('Claude Code documentation is temporarily unavailable', 502);
  }

  if (!response || !STALE_FALLBACK_STATUSES.has(response.status)) {
    if (cache && cacheKey && response?.ok) {
      try {
        await cache.put(cacheKey, createCacheEntry(response.clone()));
      } catch (error) {
        console.warn('Claude Code documentation cache write failed:', error);
      }
    }
    return response;
  }

  return (await getStaleResponse(cache, /** @type {Request} */ (cacheKey))) || response;
}
