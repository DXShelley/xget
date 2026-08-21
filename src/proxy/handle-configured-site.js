import { runFilters } from './filter-chain.js';
import { resolveSite } from './site-registry.js';

const HOP_BY_HOP_HEADERS = new Set(['connection', 'content-length', 'host', 'proxy-connection']);

/**
 * Builds headers for a configuration-backed site without changing its credential names.
 * @param {Request} request
 * @param {URL} upstreamUrl
 * @returns {Headers} Headers safe to send upstream.
 */
function getConfiguredHeaders(request, upstreamUrl) {
  const headers = new Headers();
  const mirrorOrigin = new URL(request.url).origin;
  for (const [key, value] of request.headers) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (key.toLowerCase() === 'origin' && value === mirrorOrigin) {
      headers.set(key, upstreamUrl.origin);
    } else if (key.toLowerCase() === 'referer') {
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
 * Proxies a request handled by a configuration-only adapter.
 * @param {Request} request
 * @returns {Promise<Response | null>} The upstream response, or null when another adapter owns the host.
 */
export async function handleConfiguredSiteRequest(request) {
  const mirrorUrl = new URL(request.url);
  const site = resolveSite(mirrorUrl.hostname);
  if (!site || !site.allowedMethods) return null;
  if (!site.allowedMethods.includes(request.method)) {
    return new Response('Method not allowed', { status: 405 });
  }

  const targetUrl = new URL(`${mirrorUrl.pathname}${mirrorUrl.search}`, site.upstreamOrigin);
  const requestContext = await runFilters({ request, site, targetUrl }, site.requestFilters || []);
  const response = await fetch(requestContext.targetUrl.toString(), {
    method: request.method,
    headers: getConfiguredHeaders(request, requestContext.targetUrl),
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual'
  });
  const responseContext = await runFilters(
    { request, response, site, targetUrl: requestContext.targetUrl },
    site.responseFilters || []
  );
  return responseContext.response;
}
