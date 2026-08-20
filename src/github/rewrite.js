import { GITHUB_PROXY_HOSTS, GITHUB_WEB_PREFIX, GITHUB_WEB_UPSTREAM } from './config.js';

const GITHUB_HOSTS = ['github.com', ...Object.keys(GITHUB_PROXY_HOSTS)];
const ABSOLUTE_GITHUB_URL_PATTERN = new RegExp(
  `https?:\\/\\/(?:${GITHUB_HOSTS.map(escapeRegex).join('|')})[^\\s"'<>\\\\$\\x60]*`,
  'gi'
);
const HTML_ATTRIBUTE_PATTERN =
  /(^|[\s<])((?:href|src|srcset|action|formaction|poster|cite|data-hovercard-url|data-turbo-frame-src|data-url)\s*=\s*)(["'])(.*?)\3/gim;
const EMBEDDED_RELATIVE_URL_PATTERN = /(["'](?:url|api|href)["']\s*:\s*)(["'])(\/(?!\/)[^"']*)\2/gi;
const CSP_HOST_PATTERN = new RegExp(
  `(^|[\\s;,])(?:https?:\\/\\/)?(${GITHUB_HOSTS.map(escapeRegex).join('|')})(?::\\d+)?(?=([/\\s;,]|$))`,
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

  const isExplicitAbsolute = /^(?:https?|wss?):\/\//i.test(value) || value.startsWith('//');
  if (isExplicitAbsolute && !GITHUB_HOSTS.includes(parsed.hostname.toLowerCase())) {
    return value;
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'github.com') {
    return `${origin}${GITHUB_WEB_PREFIX}${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  if (GITHUB_PROXY_HOSTS[host]) {
    const rewritten = rewriteProxyHost(host, parsed.pathname, parsed.search, parsed.hash, origin);
    return parsed.protocol === 'wss:'
      ? rewritten.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
      : rewritten;
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
 * Rewrites relative GitHub paths stored in embedded navigation data.
 * @param {string} text
 * @param {string} origin
 * @returns {string} Text with local GitHub navigation URLs.
 */
function rewriteEmbeddedGithubPaths(text, origin) {
  return text.replace(EMBEDDED_RELATIVE_URL_PATTERN, (full, prefix, quote, value) => {
    if (value.startsWith(`${GITHUB_WEB_PREFIX}/`) || value.startsWith('/_github/')) {
      return full;
    }

    return `${prefix}${quote}${rewriteGithubUrl(value, origin)}${quote}`;
  });
}

/**
 * Rewrites common navigation/resource attributes in HTML.
 * @param {string} html
 * @param {string} origin
 * @returns {string} HTML with local GitHub navigation URLs.
 */
export function rewriteGithubHtml(html, origin) {
  const attributesRewritten = html.replace(
    HTML_ATTRIBUTE_PATTERN,
    (full, boundary, prefix, quote, value) => {
      const rewrittenValue = prefix.toLowerCase().startsWith('srcset')
        ? rewriteSrcset(value, origin)
        : rewriteGithubUrl(value, origin);
      return `${boundary}${prefix}${quote}${rewrittenValue}${quote}`;
    }
  );

  return rewriteGithubText(rewriteEmbeddedGithubPaths(attributesRewritten, origin), origin);
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
 * Recursively rewrites GitHub URLs in a decoded JSON value.
 * @param {unknown} value
 * @param {string} origin
 * @returns {unknown} Rewritten JSON value.
 */
function rewriteGithubJsonValue(value, origin) {
  if (typeof value === 'string') {
    if (value.startsWith('/')) {
      return rewriteGithubUrl(value, origin);
    }

    if (value.includes('<')) {
      return rewriteGithubHtml(value, origin);
    }

    return rewriteGithubText(value, origin);
  }

  if (Array.isArray(value)) {
    return value.map(item => rewriteGithubJsonValue(item, origin));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewriteGithubJsonValue(item, origin)])
    );
  }

  return value;
}

/**
 * Rewrites relative and absolute GitHub URLs in JSON payloads used by repository metadata.
 * @param {string} text
 * @param {string} origin
 * @returns {string} Rewritten JSON, or the safely rewritten text when invalid JSON is received.
 */
export function rewriteGithubJson(text, origin) {
  try {
    return JSON.stringify(rewriteGithubJsonValue(JSON.parse(text), origin));
  } catch {
    return rewriteGithubText(text, origin);
  }
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
  return policy.replace(CSP_HOST_PATTERN, (match, separator, host, nextCharacter) => {
    const normalizedHost = host.toLowerCase();
    if (normalizedHost === 'github.com') {
      return `${separator}${origin}`;
    }

    const pathSuffix = nextCharacter === '/' ? '' : '/';
    return `${separator}${origin}/_github/proxy/${normalizedHost}${pathSuffix}`;
  });
}
