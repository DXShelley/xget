import { createProxyEntryResponse } from './entry-page.js';
import { CONFIG } from '../config/index.js';
import {
  handleConfiguredTargetRequest,
  handleTransparentTargetRequest
} from './handle-configured-site.js';
import {
  getBrowserSites,
  resolveBrowserSiteByTargetUrl,
  resolveSiteByAlias,
  resolveSiteByProxyHost
} from './site-registry.js';
import { handleClaudeCodeDocsRequest } from '../claude-code-docs/handle-request.js';
import { createErrorResponse } from '../utils/security.js';

const FAST_PROXY_HOST = 'fast.dxshelley.fun';

/**
 * Builds a fixed configured upstream URL from a proxy path.
 * @param {{ upstreamOrigin: string }} site
 * @param {URL} requestUrl
 * @returns {URL} Fixed upstream URL.
 */
function createConfiguredTargetUrl(site, requestUrl) {
  return new URL(`${requestUrl.pathname}${requestUrl.search}`, site.upstreamOrigin);
}

/**
 * Builds a browser-facing canonical URL for an allowlisted target.
 * @param {{ alias?: string, browserMode?: string, mirrorHost: string }} site
 * @param {URL} targetUrl
 * @returns {URL} Canonical proxy URL.
 */
function createCanonicalProxyUrl(site, targetUrl) {
  const suffix = `${targetUrl.pathname}${targetUrl.search}`;
  if (!site.browserMode) return new URL(suffix, `https://${site.mirrorHost}`);
  if (!site.alias) throw new Error('Configured proxy site is missing an alias');
  return site.browserMode === 'isolated-origin'
    ? new URL(suffix, `https://${site.alias}.${FAST_PROXY_HOST}`)
    : new URL(`/_/${site.alias}${suffix}`, `https://${FAST_PROXY_HOST}`);
}

/**
 * Handles Fast entry, path-proxy, and isolated-origin routes.
 * @param {Request} request
 * @param {URL} url
 * @param {import('../config/index.js').ApplicationConfig} config
 * @returns {Promise<Response | null>} A route response, or null for another router.
 */
export async function handleFastRoute(request, url, config = CONFIG) {
  if (url.hostname === FAST_PROXY_HOST && url.pathname === '/') {
    if (!url.searchParams.has('target')) {
      return createProxyEntryResponse(getBrowserSites());
    }

    const target = url.searchParams.get('target');
    if (!target) return createErrorResponse('Invalid proxy target', 400);

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return createErrorResponse('Invalid proxy target', 400);
    }

    const site = resolveBrowserSiteByTargetUrl(targetUrl);
    if (site) return Response.redirect(createCanonicalProxyUrl(site, targetUrl), 302);
    if (config && !config.SECURITY.PROXY_TARGET_ALLOWLIST) {
      const response = await handleTransparentTargetRequest(request, targetUrl, config);
      if (response) return response;
    }
    return createErrorResponse('Invalid proxy target', 400);
  }

  if (url.hostname === FAST_PROXY_HOST && url.pathname.startsWith('/_/')) {
    const match = /^\/_\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!match) return createErrorResponse('Invalid proxy path', 400);

    const site = resolveSiteByAlias(match[1]);
    if (!site) return createErrorResponse('Unknown proxy site', 404);
    const targetUrl = new URL(`${match[2] || '/'}${url.search}`, site.upstreamOrigin);
    const claudeCodeDocsResponse = await handleClaudeCodeDocsRequest({ request, site, targetUrl });
    if (claudeCodeDocsResponse) return claudeCodeDocsResponse;
    return await handleConfiguredTargetRequest(request, targetUrl);
  }

  const isolatedSite = resolveSiteByProxyHost(url.hostname);
  if (!isolatedSite) return null;
  const targetUrl = createConfiguredTargetUrl(isolatedSite, url);
  const claudeCodeDocsResponse = await handleClaudeCodeDocsRequest({
    request,
    site: isolatedSite,
    targetUrl
  });
  return claudeCodeDocsResponse || (await handleConfiguredTargetRequest(request, targetUrl));
}
