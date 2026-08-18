import { addSecurityHeaders } from '../utils/security.js';
import {
  rewriteGithubCsp,
  rewriteGithubHtml,
  rewriteGithubLocation,
  rewriteGithubText
} from './rewrite.js';

/**
 * Finalizes a public GitHub Web response for the local origin.
 * @param {{ response: Response, origin: string }} options
 * @returns {Promise<Response>} Rewritten response.
 */
export async function finalizeGithubWebResponse({ response, origin }) {
  const { body: responseBody, headers: responseHeaders, status, statusText } = response;
  const headers = new Headers(responseHeaders);
  const contentType = headers.get('content-type') || '';
  const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
  const isTextPayload =
    isHtml ||
    contentType.includes('application/json') ||
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

  if (isTextPayload && responseBody !== null && status !== 204 && status !== 304) {
    const originalText = await response.text();
    body = isHtml
      ? rewriteGithubHtml(originalText, origin)
      : rewriteGithubText(originalText, origin);
    headers.delete('Content-Encoding');
    headers.delete('Content-Length');
    headers.delete('Content-MD5');
    headers.delete('ETag');
  }

  if (isHtml || contentType.includes('application/json')) {
    headers.set('Cache-Control', 'no-store');
  }

  addSecurityHeaders(headers, { includeContentSecurityPolicy: false });

  return new Response(body, {
    status,
    statusText,
    headers
  });
}
