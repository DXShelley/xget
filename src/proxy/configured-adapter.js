/**
 * Creates an immutable adapter definition for a configuration-only site.
 * @param {{ id: string, alias?: string, mirrorHost: string, upstreamOrigin: string, allowedMethods?: string[], pathProxyRules?: Array<{ pathPrefix: string, proxyOrigin: string }>, proxyPolicy?: { paths?: 'all' | string[], timeoutSeconds?: number, maxRetries?: number, stripClientIdentityHeaders?: boolean }, browserMode?: string, browserCapabilities?: { forwardCredentials?: boolean, oauth?: boolean, rewriteSameOriginRedirects?: boolean, serviceWorker?: boolean, webSocket?: boolean } }} site
 * @returns {{ adapter: 'configured', id: string, alias?: string, mirrorHost: string, upstreamOrigin: string, allowedMethods: string[], proxyPolicy: { paths: 'all' | string[], timeoutSeconds: number, maxRetries: number, stripClientIdentityHeaders: boolean }, browserMode: string, browserCapabilities: { forwardCredentials: boolean, oauth: boolean, rewriteSameOriginRedirects: boolean, serviceWorker: boolean, webSocket: boolean }, requestFilters: Array<(context: any) => any>, responseFilters: Array<(context: any) => any> }} Configured site adapter.
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
  const pathProxyRules = (site.pathProxyRules || []).map(rule => {
    if (!rule || typeof rule.pathPrefix !== 'string' || !rule.pathPrefix.startsWith('/')) {
      throw new Error(`Invalid path proxy rule for ${site.id}`);
    }
    const proxyUrl = new URL(rule.proxyOrigin);
    if (
      proxyUrl.protocol !== 'https:' ||
      proxyUrl.username ||
      proxyUrl.password ||
      proxyUrl.pathname !== '/' ||
      proxyUrl.search ||
      proxyUrl.hash
    ) {
      throw new Error(`Invalid path proxy origin for ${site.id}`);
    }
    return Object.freeze({ pathPrefix: rule.pathPrefix, proxyOrigin: proxyUrl.origin });
  });
  /**
   * Rewrites configured paths to their fixed proxy origins.
   * @param {{ targetUrl: URL } & Record<string, unknown>} context Request context.
   * @returns {{ targetUrl: URL } & Record<string, unknown>} Updated request context.
   */
  function applyPathProxyRule(context) {
    const rule = pathProxyRules.find(candidate =>
      context.targetUrl.pathname.startsWith(candidate.pathPrefix)
    );
    return rule
      ? {
          ...context,
          targetUrl: new URL(
            `${context.targetUrl.pathname}${context.targetUrl.search}`,
            rule.proxyOrigin
          )
        }
      : context;
  }
  const requestFilters = pathProxyRules.length ? [applyPathProxyRule] : [];

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
      stripClientIdentityHeaders: false,
      ...(site.proxyPolicy || {})
    }),
    browserMode: site.browserMode || 'path-proxy',
    browserCapabilities,
    requestFilters,
    responseFilters: []
  });
}
