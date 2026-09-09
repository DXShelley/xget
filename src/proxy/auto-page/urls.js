import { resolveSite } from '../site-registry.js';

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
  const label = hostname.slice(0, -PAGE_SUFFIX.length);
  return (
    hostname.endsWith(PAGE_SUFFIX) &&
    !resolveSite(hostname) &&
    label.includes('-') &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  );
}

/**
 * Converts an upstream hostname into its readable generated DNS label.
 * @param {URL} target
 * @returns {Promise<string>} DNS label.
 */
export async function pageLabel(target) {
  const raw = target.hostname.toLowerCase().replaceAll('.', '-');
  const label = raw.slice(0, 63).replace(/-+$/, '');
  if (label.includes('-')) return label;
  const next = raw.slice(63).replace(/^-+/, '').slice(0, 1) || 'x';
  return `${raw.slice(0, 61)}-${next}`;
}

/**
 * Reproduces the former readable prefix for legacy hash-label migration.
 * @param {URL} target
 * @returns {string} Legacy label prefix.
 */
function legacySlug(target) {
  return (
    target.hostname
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30)
      .replace(/-$/g, '') || 'page'
  );
}

/**
 * Verifies a legacy per-path label so existing bookmarked page hosts can redirect safely.
 * @param {URL} target
 * @param {string} label
 * @returns {Promise<boolean>} Whether the label matches the old mapping format.
 */
export async function matchesLegacyLabel(target, label) {
  const slug = legacySlug(target);
  if (/^[a-z2-7]{8}$/.test(label.slice(slug.length + 1))) {
    const bytes = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(target.origin))
    );
    const value = BigInt(
      `0x${[...bytes.slice(0, 5)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
    );
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    const hash = Array.from(
      { length: 8 },
      (_, index) => alphabet[Number((value >> BigInt(35 - index * 5)) & 31n)]
    ).join('');
    return label === `${slug}-${hash}`;
  }
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(target.origin + target.pathname))
  );
  const hash = [...bytes]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
  return label === `${slug}-${hash}`;
}

/**
 * Preserves upstream paths on their site's generated proxy host.
 * @param {URL} target
 * @param {string} mirrorOrigin
 * @returns {string} Same-site browser URL.
 */
export function siteUrl(target, mirrorOrigin) {
  return target.pathname.startsWith('/__xget/')
    ? resourceUrl(target.href, target, mirrorOrigin)
    : `${mirrorOrigin}${target.pathname}${target.search}${target.hash}`;
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
 * Creates an entry navigation, directly retaining same-site navigation when possible.
 * @param {string} value
 * @param {URL} base
 * @param {string} [mirrorOrigin]
 * @param {string} [siteOrigin]
 * @returns {string} Entry URL.
 */
export function navigationUrl(value, base, mirrorOrigin, siteOrigin = base.origin) {
  if (!value || value.startsWith('#') || /^(mailto:|tel:)/i.test(value)) return value;
  const target = publicTarget(new URL(value, base));
  if (mirrorOrigin && target.origin === siteOrigin) return siteUrl(target, mirrorOrigin);
  return `https://fast.dxshelley.fun/?target=${encodeURIComponent(target.href)}`;
}
