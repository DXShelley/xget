import siteDefinitions from '../../config/sites.json';
import { createConfiguredAdapter } from './configured-adapter.js';

const SITES = Object.freeze(
  siteDefinitions.map(site =>
    Object.freeze(
      site.adapter === 'configured'
        ? createConfiguredAdapter(site)
        : {
            id: site.id,
            mirrorHost: site.mirrorHost.toLowerCase(),
            upstreamOrigin: site.upstreamOrigin,
            adapter: site.adapter
          }
    )
  )
);

const SITES_BY_HOST = new Map(SITES.map(site => [site.mirrorHost, site]));

/**
 * Resolves a configured mirror host without allowing arbitrary upstream targets.
 * @param {string} host
 * @returns {{ id: string, mirrorHost: string, upstreamOrigin: string, adapter?: string, allowedMethods?: string[], requestFilters?: Array<(context: any) => any>, responseFilters?: Array<(context: any) => any> } | null} Site definition, or null for an unconfigured host.
 */
export function resolveSite(host) {
  return SITES_BY_HOST.get(host.toLowerCase()) || null;
}
