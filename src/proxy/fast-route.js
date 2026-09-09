import { createProxyEntryResponse } from './entry-page.js';
import { PAGE_SUFFIX } from './auto-page/urls.js';
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
 * @param {{ pathname: string, search: string }} requestUrl
 * @returns {URL} Fixed upstream URL.
 */
function createConfiguredTargetUrl(site, requestUrl) {
  const target = new URL(site.upstreamOrigin);
  target.pathname = requestUrl.pathname;
  target.search = requestUrl.search;
  return target;
}

/**
 * Builds a browser-facing canonical URL for an allowlisted target.
 * @param {{ alias?: string, browserMode?: string, mirrorHost: string }} site
 * @param {URL} targetUrl
 * @returns {URL} Canonical proxy URL.
 */
function createCanonicalProxyUrl(site, targetUrl) {
  if (site.browserMode && !site.alias) throw new Error('Configured proxy site is missing an alias');
  const origin = !site.browserMode
    ? `https://${site.mirrorHost}`
    : site.browserMode === 'isolated-origin'
      ? `https://${site.alias}.${FAST_PROXY_HOST}`
      : `https://${FAST_PROXY_HOST}`;
  const result = new URL(origin);
  result.pathname =
    site.browserMode && site.browserMode !== 'isolated-origin'
      ? `/_/${site.alias}${targetUrl.pathname}`
      : targetUrl.pathname;
  result.search = targetUrl.search;
  result.hash = targetUrl.hash;
  return result;
}

/**
 * Handles Fast entry, path-proxy, and isolated-origin routes.
 * @param {Request} request
 * @param {URL} url
 * @param {import('../config/index.js').ApplicationConfig} config
 * @param {boolean} automaticPages Whether automatic public page storage is configured.
 * @returns {Promise<Response | null>} A route response, or null for another router.
 */
export async function handleFastRoute(request, url, config = CONFIG, automaticPages = false) {
  if (url.hostname === FAST_PROXY_HOST && url.pathname === '/favicon.ico') {
    return new Response(null, { status: 204 });
  }

  if (url.hostname === FAST_PROXY_HOST && url.pathname === '/') {
    if (!url.searchParams.has('target')) {
      const sites = getBrowserSites();
      const formActionOrigins = sites.map(
        site => createCanonicalProxyUrl(site, new URL(site.upstreamOrigin)).origin
      );
      // Browsers also apply form-action to the generated host after an entry redirect.
      if (automaticPages && !config.SECURITY.PROXY_TARGET_ALLOWLIST) {
        formActionOrigins.push(`https://*${PAGE_SUFFIX}`);
      }
      return createProxyEntryResponse(sites, formActionOrigins);
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
    if (site) {
      const status = request.method === 'GET' || request.method === 'HEAD' ? 302 : 307;
      return Response.redirect(createCanonicalProxyUrl(site, targetUrl), status);
    }
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
    const targetUrl = createConfiguredTargetUrl(site, {
      pathname: match[2] || '/',
      search: url.search
    });
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
