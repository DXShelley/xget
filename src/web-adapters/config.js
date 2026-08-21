import siteDefinitions from '../../config/sites.json';

const WEB_ADAPTER_NAME = 'web-adapter';

/**
 * @typedef {{ id: string, alias: string, mirrorHost: string, upstreamOrigin: string, resourceOrigins: readonly string[] }} WebAdapterSite
 */

/**
 * Normalizes a configured HTTPS origin.
 * @param {string} value Configured URL.
 * @returns {string} Origin without a path.
 */
function normalizeOrigin(value) {
  const url = new URL(value);
  return url.origin;
}

/**
 * Configured interactive Web applications with fixed upstream and resource origins.
 * @type {ReadonlyArray<WebAdapterSite>}
 */
export const WEB_ADAPTER_SITES = Object.freeze(
  siteDefinitions
    .filter(site => site.adapter === WEB_ADAPTER_NAME)
    .map(site => {
      if (!site.alias) throw new Error(`Web adapter site ${site.id} is missing an alias`);
      return Object.freeze({
        id: site.id,
        alias: site.alias,
        mirrorHost: site.mirrorHost.toLowerCase(),
        upstreamOrigin: normalizeOrigin(site.upstreamOrigin),
        resourceOrigins: Object.freeze((site.resourceOrigins || []).map(normalizeOrigin))
      });
    })
);

const SITES_BY_MIRROR_HOST = new Map(WEB_ADAPTER_SITES.map(site => [site.mirrorHost, site]));
const SITES_BY_UPSTREAM_HOST = new Map(
  WEB_ADAPTER_SITES.map(site => [new URL(site.upstreamOrigin).hostname, site])
);

/**
 * Resolves an interactive site by its isolated mirror host.
 * @param {string} host
 * @returns {WebAdapterSite | null} Matching site or null.
 */
export function resolveWebAdapterSite(host) {
  return SITES_BY_MIRROR_HOST.get(host.toLowerCase()) || null;
}

/**
 * Resolves an interactive site whose primary origin owns the host.
 * @param {string} host
 * @returns {WebAdapterSite | null} Matching site or null.
 */
export function resolveWebAdapterSiteByUpstreamHost(host) {
  return SITES_BY_UPSTREAM_HOST.get(host.toLowerCase()) || null;
}

/**
 * Tests whether an origin is a site's primary or resource origin.
 * @param {WebAdapterSite} site
 * @param {string} origin
 * @returns {boolean} Whether the origin belongs to the site's fixed allowlist.
 */
export function isWebAdapterOrigin(site, origin) {
  return site.upstreamOrigin === origin || site.resourceOrigins.includes(origin);
}
