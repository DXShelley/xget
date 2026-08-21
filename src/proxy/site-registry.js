import siteDefinitions from '../../config/sites.json';
import { createConfiguredAdapter } from './configured-adapter.js';
import { WEB_ADAPTER_SITES } from '../web-adapters/config.js';

/** @typedef {ReturnType<typeof createConfiguredAdapter>} ConfiguredSite */
/** @typedef {ConfiguredSite | { id: string, mirrorHost: string, upstreamOrigin: string, adapter: string }} RegisteredSite */
/** @typedef {ConfiguredSite | import('../web-adapters/config.js').WebAdapterSite} BrowserSite */

const UNIQUE_SITE_KEYS = ['id', 'alias', 'mirrorHost', 'upstreamOrigin'];

/**
 * Rejects duplicate public routing keys before site maps are constructed.
 * @param {Array<Record<string, unknown>>} definitions Raw site definitions.
 * @returns {void}
 */
export function validateSiteDefinitions(definitions) {
  for (const key of UNIQUE_SITE_KEYS) {
    const values = new Set();
    for (const definition of definitions) {
      const value = definition[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !value) {
        throw new Error(`Invalid site ${key}`);
      }
      const normalized = key === 'upstreamOrigin' ? new URL(value).origin : value.toLowerCase();
      if (values.has(normalized)) {
        throw new Error(`Duplicate site ${key}: ${value}`);
      }
      values.add(normalized);
    }
  }
}

validateSiteDefinitions(siteDefinitions);

/** @type {ReadonlyArray<RegisteredSite>} */
const SITES = Object.freeze(
  siteDefinitions.map(site =>
    Object.freeze(
      site.adapter === 'configured'
        ? createConfiguredAdapter(
            /** @type {Parameters<typeof createConfiguredAdapter>[0]} */ (
              /** @type {unknown} */ (site)
            )
          )
        : {
            id: site.id,
            mirrorHost: site.mirrorHost.toLowerCase(),
            upstreamOrigin: site.upstreamOrigin,
            adapter: site.adapter
          }
    )
  )
);

const CONFIGURED_SITES = SITES.filter(
  /** @param {RegisteredSite} site @returns {site is ConfiguredSite} */ site =>
    site.adapter === 'configured'
);
const SITES_BY_HOST = new Map(SITES.map(site => [site.mirrorHost, site]));
const SITES_BY_ALIAS = new Map(
  CONFIGURED_SITES.filter(site => typeof site.alias === 'string').map(site => [
    /** @type {string} */ (site.alias).toLowerCase(),
    site
  ])
);
const SITES_BY_UPSTREAM_ORIGIN = new Map(CONFIGURED_SITES.map(site => [site.upstreamOrigin, site]));
const BROWSER_SITES = Object.freeze([...CONFIGURED_SITES, ...WEB_ADAPTER_SITES]);
const BROWSER_SITES_BY_UPSTREAM_ORIGIN = new Map(
  BROWSER_SITES.map(site => [site.upstreamOrigin, site])
);
const ISOLATED_PROXY_HOST_SUFFIX = '.fast.dxshelley.fun';

/**
 * Returns the configured sites that may be presented in the browser entry UI.
 * @returns {ReadonlyArray<BrowserSite>} Configured and dedicated browser sites.
 */
export function getBrowserSites() {
  return BROWSER_SITES;
}

/**
 * Resolves a configured mirror host without allowing arbitrary upstream targets.
 * @param {string} host
 * @returns {RegisteredSite | null} Site definition, or null for an unconfigured host.
 */
export function resolveSite(host) {
  return SITES_BY_HOST.get(host.toLowerCase()) || null;
}

/**
 * Resolves a configured site by its stable proxy alias.
 * @param {string} alias
 * @returns {ConfiguredSite | null} Configured site, or null for an unknown alias.
 */
export function resolveSiteByAlias(alias) {
  return SITES_BY_ALIAS.get(alias.toLowerCase()) || null;
}

/**
 * Resolves a configured site from its isolated proxy host.
 * @param {string} host
 * @returns {ConfiguredSite | null} Configured site, or null for an unknown host.
 */
export function resolveSiteByProxyHost(host) {
  const normalizedHost = host.toLowerCase();
  if (!normalizedHost.endsWith(ISOLATED_PROXY_HOST_SUFFIX)) {
    return null;
  }

  const alias = normalizedHost.slice(0, -ISOLATED_PROXY_HOST_SUFFIX.length);
  return alias && !alias.includes('.') ? resolveSiteByAlias(alias) : null;
}

/**
 * Resolves a fixed HTTPS upstream URL without allowing arbitrary proxy targets.
 * @param {URL} targetUrl
 * @returns {ConfiguredSite | null} Configured site, or null for a rejected target.
 */
export function resolveSiteByTargetUrl(targetUrl) {
  return targetUrl.protocol === 'https:' && !targetUrl.username && !targetUrl.password
    ? SITES_BY_UPSTREAM_ORIGIN.get(targetUrl.origin) || null
    : null;
}

/**
 * Resolves a fixed HTTPS browser target, including dedicated Web adapters.
 * @param {URL} targetUrl
 * @returns {BrowserSite | null} Browser site, or null for a rejected target.
 */
export function resolveBrowserSiteByTargetUrl(targetUrl) {
  return targetUrl.protocol === 'https:' && !targetUrl.username && !targetUrl.password
    ? BROWSER_SITES_BY_UPSTREAM_ORIGIN.get(targetUrl.origin) || null
    : null;
}
