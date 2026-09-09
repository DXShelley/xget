export const RESOURCE_PREFIX = '/__xget/page-resource/';
export const PAGE_SUFFIX = '.fast.dxshelley.fun';

/**
 * Validates anonymous public HTTPS targets.
 * @param {string | URL} value
 * @returns {URL} Valid target.
 */
export function publicTarget(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes('.') ||
    /^[\d.]+$/.test(host) ||
    host.includes(':') ||
    /(^|\.)(localhost|local|internal|invalid|test)$/.test(host) ||
    host === 'dxshelley.fun' ||
    host.endsWith('.dxshelley.fun')
  ) {
    throw new Error('Target must be a public HTTPS hostname without credentials');
  }
  return url;
}

/**
 * Tests only the allocated label format, not arbitrary zone hosts.
 * @param {string} hostname
 * @returns {boolean} Whether this is a generated page host.
 */
export function isPageHost(hostname) {
  return (
    hostname.endsWith(PAGE_SUFFIX) &&
    /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?-[a-f0-9]{32}$/.test(
      hostname.slice(0, -PAGE_SUFFIX.length)
    )
  );
}

/**
 * Names an immutable origin/path mapping, excluding query and fragment.
 * @param {URL} target
 * @returns {Promise<string>} DNS label.
 */
export async function pageLabel(target) {
  const key = target.origin + target.pathname;
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  );
  const hash = [...bytes]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
  const slug =
    target.hostname
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30)
      .replace(/-$/g, '') || 'page';
  return `${slug}-${hash}`;
}

/**
 * Encodes an origin into a path segment.
 * @param {string} origin
 * @returns {string} URL-safe encoding.
 */
export function encodeOrigin(origin) {
  return btoa(origin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Resolves a resource URL without losing its own directory for nested imports.
 * @param {string} value
 * @param {URL} base
 * @param {string} mirrorOrigin
 * @returns {string} Proxy resource URL.
 */
export function resourceUrl(value, base, mirrorOrigin) {
  if (!value || value.startsWith('#') || /^(data:|blob:)/i.test(value)) return value;
  const url = new URL(value, base);
  if (url.origin === mirrorOrigin) return url.href;
  publicTarget(url);
  return `${mirrorOrigin}${RESOURCE_PREFIX}${encodeOrigin(url.origin)}${url.pathname}${url.search}${url.hash}`;
}

/**
 * Resolves a namespaced resource back to its independent upstream.
 * @param {URL} proxy
 * @returns {URL} Target resource.
 */
export function decodeResource(proxy) {
  const rest = proxy.pathname.slice(RESOURCE_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 1) throw new Error('Invalid resource URL');
  const origin = atob(rest.slice(0, slash).replaceAll('-', '+').replaceAll('_', '/'));
  const url = publicTarget(origin);
  if (url.origin !== origin) throw new Error('Invalid resource origin');
  url.pathname = rest.slice(slash);
  url.search = proxy.search;
  return url;
}

/**
 * Creates an entry navigation without persisting query parameters.
 * @param {string} value
 * @param {URL} base
 * @returns {string} Entry URL.
 */
export function navigationUrl(value, base) {
  if (!value || value.startsWith('#') || /^(mailto:|tel:)/i.test(value)) return value;
  const target = publicTarget(new URL(value, base));
  return `https://fast.dxshelley.fun/?target=${encodeURIComponent(target.href)}`;
}
