/**
 * Creates an immutable adapter definition for a configuration-only site.
 * @param {{ id: string, alias?: string, mirrorHost: string, upstreamOrigin: string, allowedMethods?: string[], proxyPolicy?: { paths?: 'all' | string[], timeoutSeconds?: number, maxRetries?: number }, browserMode?: string, browserCapabilities?: { forwardCredentials?: boolean, oauth?: boolean, rewriteSameOriginRedirects?: boolean, serviceWorker?: boolean, webSocket?: boolean } }} site
 * @returns {{ adapter: 'configured', id: string, alias?: string, mirrorHost: string, upstreamOrigin: string, allowedMethods: string[], proxyPolicy: { paths: 'all' | string[], timeoutSeconds: number, maxRetries: number }, browserMode: string, browserCapabilities: { forwardCredentials: boolean, oauth: boolean, rewriteSameOriginRedirects: boolean, serviceWorker: boolean, webSocket: boolean }, requestFilters: Array<(context: any) => any>, responseFilters: Array<(context: any) => any> }} Configured site adapter.
 */
export function createConfiguredAdapter(site) {
  const browserCapabilities = Object.freeze({
    forwardCredentials: false,
    oauth: false,
    rewriteSameOriginRedirects: true,
    serviceWorker: false,
    webSocket: false,
    ...(site.browserCapabilities || {})
  });

  return Object.freeze({
    adapter: 'configured',
    id: site.id,
    alias: site.alias,
    mirrorHost: site.mirrorHost.toLowerCase(),
    upstreamOrigin: site.upstreamOrigin,
    allowedMethods: site.allowedMethods || ['GET', 'HEAD'],
    proxyPolicy: Object.freeze({
      paths: 'all',
      timeoutSeconds: 20,
      maxRetries: 1,
      ...(site.proxyPolicy || {})
    }),
    browserMode: site.browserMode || 'path-proxy',
    browserCapabilities,
    requestFilters: [],
    responseFilters: []
  });
}
