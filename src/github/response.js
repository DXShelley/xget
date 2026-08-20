import { addSecurityHeaders } from '../utils/security.js';
import {
  rewriteGithubCsp,
  rewriteGithubHtml,
  rewriteGithubJson,
  rewriteGithubLocation,
  rewriteGithubText
} from './rewrite.js';

/**
 * Rewrites one upstream cookie for the mirror origin.
 * @param {string} value
 * @param {string} upstreamHost
 * @returns {string} Mirror cookie.
 */
function rewriteGithubSetCookie(value, upstreamHost) {
  const [nameValue, ...attributes] = value.split(';');
  const separator = nameValue.indexOf('=');
  if (separator < 1) return value;
  const prefix = `__xget_gh_${upstreamHost.replace(/[^a-z0-9]/gi, '_')}__`;
  const name = nameValue.slice(0, separator);
  const rewrittenAttributes = attributes.filter(
    /** @param {string} attribute */ attribute => !/^\s*domain\s*=/i.test(attribute)
  );
  return `${prefix}${name}${nameValue.slice(separator)};${rewrittenAttributes.join(';')}`;
}

/**
 * Copies rewritten upstream cookies to a response.
 * @param {Headers} headers
 * @param {Headers} upstreamHeaders
 * @param {string} upstreamHost
 */
function copyGithubSetCookies(headers, upstreamHeaders, upstreamHost) {
  const { getSetCookie } = /** @type {{ getSetCookie?: () => string[] }} */ (upstreamHeaders);
  const values = typeof getSetCookie === 'function' ? getSetCookie.call(upstreamHeaders) : [];
  const fallbackValue = upstreamHeaders.get('Set-Cookie');
  for (const value of values.length ? values : fallbackValue ? [fallbackValue] : []) {
    headers.append('Set-Cookie', rewriteGithubSetCookie(value, upstreamHost));
  }
}

/**
 * Finalizes a public GitHub Web response for the local origin.
 * @param {{ response: Response, origin: string, upstreamHost?: string }} options
 * @returns {Promise<Response>} Rewritten response.
 */
export async function finalizeGithubWebResponse({ response, origin, upstreamHost = 'github.com' }) {
  const { body: responseBody, headers: responseHeaders, status, statusText } = response;
  const headers = new Headers(responseHeaders);
  const contentType = headers.get('content-type') || '';
  const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
  const isTextPayload =
    isHtml ||
    contentType.includes('application/json') ||
    contentType.includes('application/manifest+json') ||
    contentType.includes('javascript') ||
    contentType.includes('text/css');
  /** @type {string | ReadableStream<Uint8Array> | null} */
  let body = responseBody;

  if (headers.has('Location')) {
    headers.set('Location', rewriteGithubLocation(headers.get('Location') || '', origin));
  }

  if (headers.has('Content-Security-Policy')) {
    headers.set(
      'Content-Security-Policy',
      rewriteGithubCsp(headers.get('Content-Security-Policy') || '', origin)
    );
  }

  headers.delete('Set-Cookie');
  copyGithubSetCookies(headers, responseHeaders, upstreamHost);

  if (isTextPayload && responseBody !== null && status !== 204 && status !== 304) {
    const originalText = await response.text();
    body = isHtml
      ? rewriteGithubHtml(originalText, origin)
      : contentType.includes('application/json')
        ? rewriteGithubJson(originalText, origin)
        : rewriteGithubText(originalText, origin);
    headers.delete('Content-Encoding');
    headers.delete('Content-Length');
    headers.delete('Content-MD5');
    headers.delete('ETag');
  }

  if (
    isHtml ||
    contentType.includes('application/json') ||
    contentType.includes('application/manifest+json')
  ) {
    headers.set('Cache-Control', 'no-store');
  }

  addSecurityHeaders(headers, { includeContentSecurityPolicy: false });

  return new Response(body, {
    status,
    statusText,
    headers
  });
}
