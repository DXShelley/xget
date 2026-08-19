import { SORTED_PLATFORMS } from '../routing/platform-index.js';
import {
  GITHUB_WEB_PREFIX,
  GITHUB_WEB_UPSTREAM,
  getGithubProxyTarget,
  getGithubWebShortcuts
} from './config.js';

const GITHUB_TOP_LEVEL_READ_PATHS = new Set([
  '/collections',
  '/explore',
  '/features',
  '/manifest.json',
  '/marketplace',
  '/search',
  '/security',
  '/topics',
  '/trending'
]);

const GITHUB_GLOBAL_WRITE_PATH_PATTERN =
  /^\/(?:account|login|notifications|oauth|organizations|sessions|settings|signup)(?:\/|$)/i;
const GITHUB_REPOSITORY_PATH_PATTERN = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/.*)?$/;
const GITHUB_PROFILE_PATH_PATTERN = /^\/[A-Za-z0-9_.-]+$/;
const GITHUB_REPOSITORY_WRITE_PATH_PATTERN =
  /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:compare(?:\/|$)|discussions\/new(?:\/|$)|edit(?:\/|$)|fork(?:\/|$)|issues\/new(?:\/|$)|milestones\/new(?:\/|$)|pulls?\/new(?:\/|$)|security(?:\/|$)|settings(?:\/|$))/i;
const GITHUB_MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const GITHUB_READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * Checks for ASCII control characters without embedding control escapes in a regex.
 * @param {string} value
 * @returns {boolean} True when the value contains an ASCII control character.
 */
function hasAsciiControlChars(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether a path belongs to an existing Xget platform route.
 * @param {string} pathname
 * @returns {boolean} True when the path belongs to an existing platform.
 */
function isLegacyPlatformPath(pathname) {
  return SORTED_PLATFORMS.some(platform => {
    const prefix = `/${platform.replace(/-/g, '/')}`;
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

/**
 * Checks whether a request is a browser navigation eligible for GitHub Web handling.
 * Git and generic file clients must remain on the legacy proxy path.
 * @param {Request} request
 * @returns {boolean} True when the request is a browser navigation.
 */
function isBrowserNavigationRequest(request) {
  const accept = request.headers.get('Accept') || '';
  const userAgent = request.headers.get('User-Agent') || '';
  return (
    (accept.includes('text/html') ||
      accept.includes('application/xhtml+xml') ||
      request.headers.get('Sec-Fetch-Mode') === 'navigate') &&
    !/^git\//i.test(userAgent)
  );
}

/**
 * Checks whether a request carries browser Fetch Metadata or GitHub Web Fetch headers.
 * @param {Request} request
 * @returns {boolean} True when the request originated from browser code or GitHub Web code.
 */
function isBrowserFetchRequest(request) {
  return (
    request.headers.has('Sec-Fetch-Mode') ||
    request.headers.has('Sec-Fetch-Site') ||
    request.headers.has('X-GitHub-Client-Version') ||
    request.headers.get('X-Requested-With')?.toLowerCase() === 'xmlhttprequest'
  );
}

/**
 * Checks whether the legacy Git or Git LFS pipeline owns this request.
 * @param {Request} request
 * @param {string} pathname
 * @returns {boolean} True when the request must remain on the legacy route.
 */
function isLegacyGitProtocolRequest(request, pathname) {
  const userAgent = request.headers.get('User-Agent') || '';
  const contentType = request.headers.get('Content-Type') || '';
  return (
    /^git(?:-lfs)?\//i.test(userAgent) ||
    /^application\/(?:x-git-|vnd\.git-lfs)/i.test(contentType) ||
    /\.git(?:\/|$)/i.test(pathname)
  );
}

/**
 * Checks whether a path is a repository-shaped GitHub Web path.
 * @param {string} pathname
 * @returns {boolean} True when the path resembles a repository path.
 */
export function isGithubRepositoryPath(pathname) {
  return GITHUB_REPOSITORY_PATH_PATTERN.test(pathname) && !pathname.startsWith('/_github/');
}

/**
 * Checks whether a path resembles a public user or organization page.
 * @param {string} pathname
 * @returns {boolean} True when the path has one GitHub account segment.
 */
export function isGithubProfilePath(pathname) {
  return GITHUB_PROFILE_PATH_PATTERN.test(pathname) && !pathname.startsWith('/_github/');
}

/**
 * Determines whether a request must be handed to the canonical GitHub host.
 * @param {string} pathname
 * @param {string} [method]
 * @returns {boolean} True when the request must leave the read-only proxy.
 */
export function isGithubWritePath(pathname, method = 'GET') {
  if (GITHUB_MUTATION_METHODS.has(method.toUpperCase())) {
    return true;
  }

  return (
    GITHUB_GLOBAL_WRITE_PATH_PATTERN.test(pathname) ||
    GITHUB_REPOSITORY_WRITE_PATH_PATTERN.test(pathname)
  );
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
 * Builds a GitHub Web upstream URL from a local path.
 * @param {string} pathname
 * @param {string} [search]
 * @returns {string | null} GitHub upstream URL, or null for an unsafe path.
 */
export function getGithubUpstreamUrl(pathname, search = '') {
  if (!pathname.startsWith('/') || pathname.startsWith('/_github/')) {
    return null;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (/(^|\/)\.\.(\/|$)/.test(decodedPath) || hasAsciiControlChars(decodedPath)) {
    return null;
  }

  return getGithubCanonicalUrl(pathname, search);
}

/**
 * Classifies a browser request before the legacy Xget router handles it.
 * @param {Request} request
 * @param {URL} url
 * @param {Record<string, unknown>} [env]
 * @returns {{ kind: 'proxy'; upstreamUrl: string } | { kind: 'redirect'; targetUrl: string } | { kind: 'reject' } | null} Route decision.
 */
export function classifyGithubWebRequest(request, url, env = {}) {
  const { pathname, search } = url;

  const githubWebPath = pathname.startsWith(`${GITHUB_WEB_PREFIX}/`)
    ? pathname.slice(GITHUB_WEB_PREFIX.length)
    : null;

  if (githubWebPath && !isLegacyGitProtocolRequest(request, githubWebPath)) {
    const isBrowserRequest = isBrowserNavigationRequest(request) || isBrowserFetchRequest(request);

    if (isBrowserRequest && isGithubWritePath(githubWebPath, request.method)) {
      return { kind: 'redirect', targetUrl: getGithubCanonicalUrl(githubWebPath, search) };
    }

    if (
      isBrowserRequest &&
      (githubWebPath === '/search' ||
        GITHUB_TOP_LEVEL_READ_PATHS.has(githubWebPath) ||
        isGithubProfilePath(githubWebPath) ||
        isGithubRepositoryPath(githubWebPath))
    ) {
      const upstreamUrl = getGithubUpstreamUrl(githubWebPath, search);
      if (!upstreamUrl) {
        return null;
      }

      return upstreamUrl
        ? {
            kind: 'proxy',
            upstreamUrl
          }
        : null;
    }
  }

  if (
    pathname === '/' ||
    pathname.startsWith('/v2') ||
    pathname.startsWith('/cr/') ||
    isLegacyPlatformPath(pathname)
  ) {
    return null;
  }

  if (pathname.startsWith('/_github/proxy/')) {
    if (!GITHUB_READ_METHODS.has(request.method.toUpperCase())) {
      return { kind: 'reject' };
    }

    const [, , , host, ...pathParts] = pathname.split('/');
    const upstreamUrl = getGithubProxyTarget(host, `/${pathParts.join('/')}`);
    return upstreamUrl ? { kind: 'proxy', upstreamUrl: `${upstreamUrl}${search}` } : null;
  }

  if (isGithubWritePath(pathname, request.method)) {
    return { kind: 'redirect', targetUrl: getGithubCanonicalUrl(pathname, search) };
  }

  if (
    isBrowserNavigationRequest(request) &&
    (isGithubProfilePath(pathname) || isGithubRepositoryPath(pathname))
  ) {
    return { kind: 'redirect', targetUrl: `${url.origin}${GITHUB_WEB_PREFIX}${pathname}${search}` };
  }

  if (pathname === '/search') {
    const keyword = (url.searchParams.get('q') || '').trim().toLowerCase();
    const shortcut = getGithubWebShortcuts(env)[keyword];
    if (shortcut) {
      if (shortcut === '/search') {
        const searchUrl = new URL(`${url.origin}${GITHUB_WEB_PREFIX}/search`);
        searchUrl.searchParams.set('q', keyword);
        searchUrl.searchParams.set('type', 'repositories');
        return { kind: 'redirect', targetUrl: searchUrl.toString() };
      }

      return { kind: 'redirect', targetUrl: `${url.origin}${GITHUB_WEB_PREFIX}${shortcut}` };
    }

    const upstreamUrl = getGithubUpstreamUrl(pathname, search);
    return upstreamUrl ? { kind: 'proxy', upstreamUrl } : null;
  }

  if (GITHUB_TOP_LEVEL_READ_PATHS.has(pathname)) {
    const upstreamUrl = getGithubUpstreamUrl(pathname, search);
    return upstreamUrl ? { kind: 'proxy', upstreamUrl } : null;
  }

  return null;
}
