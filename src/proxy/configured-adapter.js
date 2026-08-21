/**
 * Creates an immutable adapter definition for a configuration-only site.
 * @param {{ id: string, mirrorHost: string, upstreamOrigin: string, allowedMethods?: string[] }} site
 * @returns {{ id: string, mirrorHost: string, upstreamOrigin: string, allowedMethods: string[], requestFilters: Array<(context: any) => any>, responseFilters: Array<(context: any) => any> }} Configured site adapter.
 */
export function createConfiguredAdapter(site) {
  return Object.freeze({
    id: site.id,
    mirrorHost: site.mirrorHost.toLowerCase(),
    upstreamOrigin: site.upstreamOrigin,
    allowedMethods: site.allowedMethods || ['GET', 'HEAD'],
    requestFilters: [],
    responseFilters: []
  });
}
