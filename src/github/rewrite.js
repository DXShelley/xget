import { GITHUB_PROXY_HOSTS, GITHUB_WEB_PREFIX, GITHUB_WEB_UPSTREAM } from './config.js';
import { getGithubCanonicalUrl, isGithubWritePath } from './routing.js';

const GITHUB_HOSTS = ['github.com', ...Object.keys(GITHUB_PROXY_HOSTS)];
const ABSOLUTE_GITHUB_URL_PATTERN = new RegExp(
  `https?:\\/\\/(?:${GITHUB_HOSTS.map(escapeRegex).join('|')})[^\\s"'<>\\\\]*`,
  'gi'
);
const HTML_ATTRIBUTE_PATTERN =
  /((?:href|src|srcset|action|formaction|poster|cite|data-turbo-frame|data-url)\s*=\s*)(["'])(.*?)\2/gi;
const CSP_HOST_PATTERN = new RegExp(
  `(?:https?:\\/\\/)?(?:${GITHUB_HOSTS.map(escapeRegex).join('|')})(?=[:/\\s;]|$)`,
  'gi'
);

/**
 * Escapes a value for a regular expression.
 * @param {string} value
 * @returns {string} A regular-expression-safe value.
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrites a GitHub asset/API host to its local proxy namespace.
 * @param {string} host
 * @param {string} pathname
 * @param {string} search
 * @param {string} hash
 * @param {string} origin
 * @returns {string} A local or canonical resource URL.
 */
function rewriteProxyHost(host, pathname, search, hash, origin) {
  if (!GITHUB_PROXY_HOSTS[host]) {
    return `${origin}${pathname}${search}${hash}`;
  }

  return `${origin}/_github/proxy/${host}${pathname}${search}${hash}`;
}

/**
 * Rewrites a single URL value while preserving unrelated external URLs.
 * @param {string} value
 * @param {string} origin
 * @returns {string} The rewritten proxy URL.
 */
export function rewriteGithubUrl(value, origin) {
  if (!value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('mailto:')) {
    return value;
  }

  let parsed;
  try {
    parsed = new URL(value, GITHUB_WEB_UPSTREAM);
  } catch {
    return value;
  }

  const isExplicitAbsolute = /^https?:\/\//i.test(value) || value.startsWith('//');
  if (isExplicitAbsolute && !GITHUB_HOSTS.includes(parsed.hostname.toLowerCase())) {
    return value;
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'github.com') {
    if (isGithubWritePath(parsed.pathname, 'GET')) {
      return getGithubCanonicalUrl(parsed.pathname, parsed.search);
    }

    return `${origin}${GITHUB_WEB_PREFIX}${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  if (GITHUB_PROXY_HOSTS[host]) {
    return rewriteProxyHost(host, parsed.pathname, parsed.search, parsed.hash, origin);
  }

  return value;
}

/**
 * Rewrites URLs in an srcset attribute.
 * @param {string} value
 * @param {string} origin
 * @returns {string} The rewritten srcset value.
 */
function rewriteSrcset(value, origin) {
  return value
    .split(',')
    .map(candidate => {
      const match = candidate.trim().match(/^(\S+)(.*)$/);
      return match ? `${rewriteGithubUrl(match[1], origin)}${match[2]}` : candidate;
    })
    .join(', ');
}

/**
 * Rewrites common navigation/resource attributes in HTML.
 * @param {string} html
 * @param {string} origin
 * @returns {string} HTML with local GitHub navigation URLs.
 */
export function rewriteGithubHtml(html, origin) {
  const attributesRewritten = html.replace(HTML_ATTRIBUTE_PATTERN, (full, prefix, quote, value) => {
    const rewrittenValue = prefix.toLowerCase().startsWith('srcset')
      ? rewriteSrcset(value, origin)
      : rewriteGithubUrl(value, origin);
    return `${prefix}${quote}${rewrittenValue}${quote}`;
  });

  return rewriteGithubText(attributesRewritten, origin);
}

/**
 * Rewrites absolute GitHub URLs in embedded JSON, JavaScript, CSS, and text payloads.
 * @param {string} text
 * @param {string} origin
 * @returns {string} Text with local GitHub URLs.
 */
export function rewriteGithubText(text, origin) {
  return text.replace(ABSOLUTE_GITHUB_URL_PATTERN, value => rewriteGithubUrl(value, origin));
}

/**
 * Rewrites an upstream redirect location.
 * @param {string} location
 * @param {string} origin
 * @returns {string} A local or canonical redirect URL.
 */
export function rewriteGithubLocation(location, origin) {
  if (!location) {
    return location;
  }

  if (location.startsWith('/') && !location.startsWith('//')) {
    const rewritten = rewriteGithubUrl(location, origin);
    return rewritten;
  }

  return rewriteGithubUrl(location, origin);
}

/**
 * Rewrites GitHub hosts in a Content-Security-Policy header.
 * @param {string} policy
 * @param {string} origin
 * @returns {string} CSP with GitHub hosts mapped to local routes.
 */
export function rewriteGithubCsp(policy, origin) {
  return policy.replace(CSP_HOST_PATTERN, token => {
    const host = token.replace(/^https?:\/\//i, '').toLowerCase();
    return host === 'github.com' ? origin : `${origin}/_github/proxy/${host}`;
  });
}
