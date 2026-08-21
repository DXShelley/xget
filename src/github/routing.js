import {
  GITHUB_WEB_UPSTREAM,
  getGithubProxyTarget,
  isGithubWebHost,
  isTrustedGithubHost
} from './config.js';

/**
 * Checks for ASCII control characters without embedding control escapes in a regex.
 * @param {string} value
 * @returns {boolean} True when the value contains an ASCII control character.
 */
function hasAsciiControlChars(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

/**
 * Builds the canonical GitHub URL for the same path and query.
 * @param {string} pathname
 * @param {string} [search]
 * @returns {string} Canonical GitHub URL.
 */
export function getGithubCanonicalUrl(pathname, search = '') {
  return `${GITHUB_WEB_UPSTREAM}${pathname}${search}`;
}

/**
 * Builds a GitHub Web upstream URL from a mirror-root path.
 * @param {string} pathname
 * @param {string} [search]
 * @returns {string | null} GitHub upstream URL, or null for an unsafe path.
 */
export function getGithubUpstreamUrl(pathname, search = '') {
  if (!pathname.startsWith('/') || pathname.startsWith('/_github/')) return null;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (/(^|\/)\.\.(\/|$)/.test(decodedPath) || hasAsciiControlChars(decodedPath)) return null;
  return getGithubCanonicalUrl(pathname, search);
}

/**
 * Identifies GitHub mutation paths for callers that need request policy metadata.
 * Routing itself is host-first and does not use this classification.
 * @param {string} pathname
 * @param {string} [method]
 * @returns {boolean} True for a mutation method or a GitHub write entry point.
 */
export function isGithubWritePath(pathname, method = 'GET') {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) return true;
  return (
    /^\/(?:account|login|notifications|oauth|organizations|sessions|settings|signup)(?:\/|$)/i.test(
      pathname
    ) ||
    /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:compare|discussions\/new|edit|fork|issues\/new|milestones\/new|pulls?\/new|security\/(?:advisories\/new|analysis|settings)|settings)(?:\/|$)/i.test(
      pathname
    )
  );
}

/**
 * Classifies every request on the dedicated GitHub mirror host.
 * @param {Request} request
 * @param {URL} url
 * @param {Record<string, unknown>} [env]
 * @returns {{ kind: 'proxy', upstreamUrl: string, forwardBody?: boolean } | null} Route decision.
 */
export function classifyGithubWebRequest(request, url, env = {}) {
  if (!isGithubWebHost(url.hostname, env)) return null;

  const isWrite = request.method !== 'GET' && request.method !== 'HEAD';
  if (url.pathname.startsWith('/_github/proxy/')) {
    const [, , , host, ...pathParts] = url.pathname.split('/');
    const upstreamUrl = getGithubProxyTarget(host, `/${pathParts.join('/')}`);
    if (!upstreamUrl || !isTrustedGithubHost(host)) return null;
    return {
      kind: 'proxy',
      upstreamUrl: `${upstreamUrl}${url.search}`,
      ...(isWrite && { forwardBody: true })
    };
  }

  const upstreamUrl = getGithubUpstreamUrl(url.pathname, url.search);
  return upstreamUrl ? { kind: 'proxy', upstreamUrl, ...(isWrite && { forwardBody: true }) } : null;
}
