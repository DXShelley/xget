import {
  isWebAdapterOrigin,
  resolveWebAdapterSite,
  resolveWebAdapterSiteByUpstreamHost
} from './config.js';

/** @typedef {import('./config.js').WebAdapterSite} WebAdapterSite */

const RESOURCE_PATH_PREFIX = '/_site/resource/';

/**
 * Rejects encoded traversal and malformed adapter paths.
 * @param {string} pathname Request path.
 * @returns {boolean} Whether the path is safe.
 */
function isSafePath(pathname) {
  if (!pathname.startsWith('/')) return false;
  try {
    return !/(^|\/)\.\.(\/|$)/.test(decodeURIComponent(pathname));
  } catch {
    return false;
  }
}

/**
 * Classifies a request belonging to one fixed interactive Web adapter.
 * @param {Request} request
 * @param {URL} url
 * @returns {{site: WebAdapterSite, upstreamHost: string, upstreamUrl: string, forwardBody: boolean} | null} Route or null.
 */
export function resolveWebAdapterRoute(request, url) {
  const site = resolveWebAdapterSite(url.hostname);
  if (!site || !isSafePath(url.pathname)) return null;

  let targetUrl;
  if (url.pathname.startsWith(RESOURCE_PATH_PREFIX)) {
    const [, , , host, ...pathParts] = url.pathname.split('/');
    if (!host || !pathParts.length) return null;
    targetUrl = new URL(`/${pathParts.join('/')}${url.search}`, `https://${host}`);
    if (!isWebAdapterOrigin(site, targetUrl.origin)) return null;
  } else {
    targetUrl = new URL(`${url.pathname}${url.search}`, site.upstreamOrigin);
  }

  return {
    site,
    upstreamHost: targetUrl.hostname,
    upstreamUrl: targetUrl.toString(),
    forwardBody: request.method !== 'GET' && request.method !== 'HEAD'
  };
}

/**
 * Returns the mirror URL for a trusted upstream URL, retaining unrelated URLs unchanged.
 * @param {URL} upstreamUrl
 * @param {WebAdapterSite} currentSite
 * @param {string} mirrorOrigin
 * @returns {string} Browser-facing URL.
 */
export function getWebAdapterMirrorUrl(upstreamUrl, currentSite, mirrorOrigin) {
  const primarySite = resolveWebAdapterSiteByUpstreamHost(upstreamUrl.hostname);
  if (primarySite) {
    return `${new URL(`https://${primarySite.mirrorHost}`).origin}${upstreamUrl.pathname}${upstreamUrl.search}${upstreamUrl.hash}`;
  }

  if (isWebAdapterOrigin(currentSite, upstreamUrl.origin)) {
    if (upstreamUrl.origin === currentSite.upstreamOrigin) {
      return `${mirrorOrigin}${upstreamUrl.pathname}${upstreamUrl.search}${upstreamUrl.hash}`;
    }
    return `${mirrorOrigin}${RESOURCE_PATH_PREFIX}${upstreamUrl.hostname}${upstreamUrl.pathname}${upstreamUrl.search}${upstreamUrl.hash}`;
  }

  return upstreamUrl.toString();
}
