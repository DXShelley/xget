import { resolveBrowserSiteByTargetUrl, resolveSite } from '../proxy/site-registry.js';
import { isPageHost } from '../proxy/auto-page/urls.js';
import { resolveProtocolFeature } from '../protocol-adapters/registry.js';

const FAST_PROXY_HOST = 'fast.dxshelley.fun';

/**
 * Determines whether the request belongs to a browser-owned route before
 * protocol-path classification. A registered browser host owns every safe
 * path beneath it, including paths that happen to resemble a platform API.
 * @param {URL} url
 * @returns {boolean} Whether the request is owned by a browser route.
 */
function isWebOwnedRequest(url) {
  if (url.pathname.startsWith('/__xget/auth/')) return true;
  const site = resolveSite(url.hostname);
  return site !== null && site.adapter !== 'github';
}

/**
 * Determines whether a Fast entry URL belongs to the anonymous public-page
 * strategy. Registered browser origins retain their configured route owner.
 * @param {URL} url
 * @param {import('../config/index.js').ApplicationConfig} config
 * @param {Record<string, unknown>} env
 * @returns {boolean} Whether the entry creates an automatic public page.
 */
function isAutomaticPublicPageEntry(url, config, env) {
  if (
    !env.PAGE_MAP ||
    config.SECURITY.PROXY_TARGET_ALLOWLIST ||
    url.hostname !== FAST_PROXY_HOST ||
    url.pathname !== '/' ||
    !url.searchParams.has('target')
  )
    return false;

  try {
    return resolveBrowserSiteByTargetUrl(new URL(url.searchParams.get('target') || '')) === null;
  } catch {
    // The public-page route returns the canonical target-validation error.
    return true;
  }
}

/**
 * Resolves the fixed request feature from route ownership and protocol traits.
 * @param {{ isAI: boolean, isDocker: boolean, isGit: boolean, isGitLFS: boolean, isHF: boolean }} traits
 * @param {URL} url
 * @param {import('../config/index.js').ApplicationConfig} config
 * @param {Record<string, unknown>} env
 * @returns {'public-page' | 'web' | 'git' | 'docker' | 'ai' | 'huggingface' | 'package'} Fixed request feature.
 */
export function resolveRequestFeature(traits, url, config, env) {
  if (isPageHost(url.hostname) || isAutomaticPublicPageEntry(url, config, env))
    return 'public-page';
  return isWebOwnedRequest(url) ? 'web' : resolveProtocolFeature(traits, url);
}
