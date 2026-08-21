const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);
const REWRITABLE_CONTENT_TYPES =
  /(?:text\/html|application\/xhtml\+xml|application\/json|javascript|text\/css|manifest)/i;

/**
 * Finalizes a configured-site response for its proxy origin.
 * @param {{ request: Request, response: Response, site: { browserCapabilities?: { rewriteSameOriginRedirects?: boolean }, upstreamOrigin: string }, targetUrl: URL }} options
 * @returns {Promise<Response>} Response scoped to the proxy origin.
 */
export async function finalizeConfiguredResponse({ request, response, site, targetUrl }) {
  const headers = new Headers(response.headers);
  const mirrorOrigin = new URL(request.url).origin;
  for (const header of HOP_BY_HOP_RESPONSE_HEADERS) headers.delete(header);
  headers.delete('Set-Cookie');

  const location = headers.get('Location');
  if (location && site.browserCapabilities?.rewriteSameOriginRedirects) {
    try {
      const upstreamLocation = new URL(location, targetUrl);
      if (upstreamLocation.origin === site.upstreamOrigin) {
        headers.set(
          'Location',
          `${mirrorOrigin}${upstreamLocation.pathname}${upstreamLocation.search}${upstreamLocation.hash}`
        );
      }
    } catch {
      headers.delete('Location');
    }
  }

  if (site.browserCapabilities?.rewriteSameOriginRedirects) {
    const contentSecurityPolicy = headers.get('Content-Security-Policy');
    if (contentSecurityPolicy) {
      headers.set(
        'Content-Security-Policy',
        contentSecurityPolicy.split(site.upstreamOrigin).join(mirrorOrigin)
      );
    }
  }

  const { body: responseBody } = response;
  /** @type {ReadableStream<Uint8Array> | string | null} */
  let body = responseBody;
  const contentType = headers.get('Content-Type') || '';
  if (
    site.browserCapabilities?.rewriteSameOriginRedirects &&
    response.body !== null &&
    response.status !== 204 &&
    response.status !== 304 &&
    REWRITABLE_CONTENT_TYPES.test(contentType)
  ) {
    const originalText = await response.text();
    const rewrittenText = originalText.split(site.upstreamOrigin).join(mirrorOrigin);
    body = rewrittenText;
    if (rewrittenText !== originalText) {
      headers.delete('Content-Encoding');
      headers.delete('Content-Length');
      headers.delete('ETag');
    }
  }

  headers.set('Cache-Control', 'private, no-store');
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
