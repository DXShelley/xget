import { addSecurityHeaders, createErrorResponse } from '../utils/security.js';
import { getWebAdapterMirrorUrl, resolveWebAdapterRoute } from './routing.js';

/** @typedef {import('./config.js').WebAdapterSite} WebAdapterSite */

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'proxy-authorization',
  'proxy-connection',
  'upgrade'
]);
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const URL_ATTRIBUTE_PATTERN =
  /(^|[\s<])((?:href|src|srcset|action|formaction|poster)\s*=\s*)(["'])(.*?)\3/gim;

/** @param {string} host @returns {string} */
function getCookiePrefix(host) {
  return `__xget_web_${host.replace(/[^a-z0-9]/gi, '_')}__`;
}

/** @param {string | null} value @param {string} host @returns {string} */
function getScopedCookieHeader(value, host) {
  const prefix = getCookiePrefix(host);
  return (value || '')
    .split(/;\s*/)
    .filter(cookie => cookie.startsWith(prefix))
    .map(cookie => cookie.slice(prefix.length))
    .join('; ');
}

/** @param {string} value @param {string} host @returns {string} */
function rewriteSetCookie(value, host) {
  const [nameValue, ...attributes] = value.split(';');
  const separator = nameValue.indexOf('=');
  if (separator < 1) return value;
  const attributesWithoutDomain = attributes.filter(
    attribute => !/^\s*domain\s*=/i.test(attribute)
  );
  return `${getCookiePrefix(host)}${nameValue};${attributesWithoutDomain.join(';')}`;
}

/** @param {Headers} headers @param {Headers} upstreamHeaders @param {string} host */
function copySetCookies(headers, upstreamHeaders, host) {
  const source =
    /** @type {{ getSetCookie?: () => string[], getAll?: (name: string) => string[] }} */ (
      upstreamHeaders
    );
  const fallbackCookie = upstreamHeaders.get('Set-Cookie');
  const values =
    (typeof source.getSetCookie === 'function' && source.getSetCookie()) ||
    (typeof source.getAll === 'function' && source.getAll('Set-Cookie')) ||
    (fallbackCookie ? [fallbackCookie] : []);
  for (const value of values) headers.append('Set-Cookie', rewriteSetCookie(value, host));
}

/** @param {Request} request @param {URL} upstreamUrl @param {string} primaryOrigin @returns {Headers} */
function getRequestHeaders(request, upstreamUrl, primaryOrigin) {
  const headers = new Headers();
  const mirrorOrigin = new URL(request.url).origin;
  for (const [key, value] of request.headers) {
    const name = key.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(name) ||
      name === 'cookie' ||
      (name === 'authorization' && upstreamUrl.origin !== primaryOrigin)
    ) {
      continue;
    }
    if (name === 'origin') {
      headers.set(key, upstreamUrl.origin);
    } else if (name === 'referer') {
      try {
        const referer = new URL(value);
        if (referer.origin === mirrorOrigin) headers.set(key, `${upstreamUrl.origin}/`);
      } catch {
        // Drop malformed Referer values.
      }
    } else {
      headers.set(key, value);
    }
  }
  const cookies = getScopedCookieHeader(request.headers.get('Cookie'), upstreamUrl.hostname);
  if (cookies) headers.set('Cookie', cookies);
  return headers;
}

/** @param {string} value @param {WebAdapterSite} site @param {string} mirrorOrigin @param {URL} baseUrl @returns {string} */
function rewriteValue(value, site, mirrorOrigin, baseUrl) {
  if (!value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('mailto:')) {
    return value;
  }
  try {
    const parsed = new URL(value, baseUrl);
    const rewritten = getWebAdapterMirrorUrl(parsed, site, mirrorOrigin);
    return rewritten === parsed.toString() && !/^(?:https?:)?\/\//i.test(value) ? value : rewritten;
  } catch {
    return value;
  }
}

/** @param {string} text @param {WebAdapterSite} site @param {string} mirrorOrigin @param {URL} baseUrl @returns {string} */
function rewriteText(text, site, mirrorOrigin, baseUrl) {
  const rewrittenAttributes = text.replace(
    URL_ATTRIBUTE_PATTERN,
    (full, boundary, prefix, quote, value) => {
      if (prefix.toLowerCase().startsWith('srcset')) {
        const rewritten = value
          .split(',')
          .map(
            /** @param {string} part */ part => {
              const match = part.trim().match(/^(\S+)(.*)$/);
              return match
                ? `${rewriteValue(match[1], site, mirrorOrigin, baseUrl)}${match[2]}`
                : part;
            }
          )
          .join(', ');
        return `${boundary}${prefix}${quote}${rewritten}${quote}`;
      }
      return `${boundary}${prefix}${quote}${rewriteValue(value, site, mirrorOrigin, baseUrl)}${quote}`;
    }
  );

  return [site.upstreamOrigin, ...site.resourceOrigins].reduce((rewritten, origin) => {
    const mirrorUrl = getWebAdapterMirrorUrl(new URL(origin), site, mirrorOrigin).replace(
      /\/$/,
      ''
    );
    return rewritten.replaceAll(origin, mirrorUrl);
  }, rewrittenAttributes);
}

/** @param {string} policy @param {WebAdapterSite} site @param {string} mirrorOrigin @returns {string} */
function rewriteCsp(policy, site, mirrorOrigin) {
  const hosts = [
    new URL(site.upstreamOrigin).hostname,
    ...site.resourceOrigins.map(origin => new URL(origin).hostname)
  ];
  return hosts.reduce(
    (rewritten, host) =>
      rewritten.replace(
        new RegExp(`https?:\\/\\/${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'),
        mirrorOrigin
      ),
    policy
  );
}

/** @param {Request} request @param {Response} response @returns {boolean} */
function isBrowserChallengeResponse(request, response) {
  return (
    (request.method === 'GET' || request.method === 'HEAD') &&
    response.status === 403 &&
    response.headers.get('Cf-Mitigated')?.toLowerCase() === 'challenge'
  );
}

/**
 * Handles an interactive, credential-scoped Web proxy request.
 * @param {{request: Request, url: URL}} options
 * @returns {Promise<Response | null>} A handled response or null for another router.
 */
export async function handleWebAdapterRequest({ request, url }) {
  const route = resolveWebAdapterRoute(request, url);
  if (!route) return null;
  if (!ALLOWED_METHODS.has(request.method)) return createErrorResponse('Method not allowed', 405);

  const upstreamUrl = new URL(route.upstreamUrl);
  const response = await fetch(route.upstreamUrl, {
    method: request.method,
    headers: getRequestHeaders(request, upstreamUrl, route.site.upstreamOrigin),
    body: route.forwardBody && request.body !== null ? request.body : undefined,
    redirect: 'manual'
  });
  if (isBrowserChallengeResponse(request, response)) {
    const headers = addSecurityHeaders(
      new Headers({ Location: route.upstreamUrl, 'Cache-Control': 'private, no-store' })
    );
    return new Response(null, { status: 302, headers });
  }

  const headers = new Headers(response.headers);
  const mirrorOrigin = url.origin;
  const location = headers.get('Location');
  if (location)
    headers.set('Location', rewriteValue(location, route.site, mirrorOrigin, upstreamUrl));
  if (headers.has('Content-Security-Policy')) {
    headers.set(
      'Content-Security-Policy',
      rewriteCsp(headers.get('Content-Security-Policy') || '', route.site, mirrorOrigin)
    );
  }
  headers.delete('Set-Cookie');
  copySetCookies(headers, response.headers, route.upstreamHost);
  headers.set('Cache-Control', 'private, no-store');

  const contentType = headers.get('Content-Type') || '';
  const shouldRewrite =
    /(?:text\/html|application\/xhtml\+xml|application\/json|javascript|text\/css)/i.test(
      contentType
    );
  const { body: responseBody } = response;
  /** @type {ReadableStream<Uint8Array> | string | null} */
  let body = responseBody;
  if (
    shouldRewrite &&
    response.body !== null &&
    response.status !== 204 &&
    response.status !== 304
  ) {
    body = rewriteText(await response.text(), route.site, mirrorOrigin, upstreamUrl);
    headers.delete('Content-Encoding');
    headers.delete('Content-Length');
    headers.delete('ETag');
  }
  addSecurityHeaders(headers, { includeContentSecurityPolicy: false });
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
