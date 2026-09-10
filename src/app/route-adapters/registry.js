import { isGithubWebHost } from '../../github/config.js';
import { resolveSite } from '../../proxy/site-registry.js';
import { resolveWebAdapterSite } from '../../web-adapters/config.js';
import { CONFIGURED_SITE_ROUTE_ADAPTER } from './configured-site.js';
import { FAST_ROUTE_ADAPTER } from './fast.js';
import { GITHUB_ROUTE_ADAPTER } from './github.js';
import { PUBLIC_PAGE_ROUTE_ADAPTER } from './public-page.js';
import { WEB_ROUTE_ADAPTER } from './web.js';

const FAST_PROXY_HOST = 'fast.dxshelley.fun';

/**
 * @typedef {{ response: Response, isProxiedResponse: boolean }} ApplicationRouteResult
 */

/**
 * @typedef {{
 *   env: Record<string, unknown>,
 *   protocolFeature: string,
 *   request: Request,
 *   routeAdapter?: { handle: (context: ApplicationRouteContext) => Promise<ApplicationRouteResult | null> } | null,
 *   url: URL
 * }} ApplicationRouteContext
 */

/**
 * Resolves one application-route strategy at request entry. This is a strategy
 * selection, not a chain: application routing never probes another adapter.
 * @param {{ protocolFeature: string, url: URL, env: Record<string, unknown> }} context
 * @returns {'public-page' | 'web-site' | 'github' | 'configured-site' | 'fast' | null} Fixed route feature.
 */
export function resolveRouteFeature({ protocolFeature, url, env }) {
  if (protocolFeature === 'public-page') return 'public-page';
  if (isGithubWebHost(url.hostname, env)) return 'github';
  if (resolveWebAdapterSite(url.hostname)) return 'web-site';
  if (resolveSite(url.hostname)?.adapter === 'configured') return 'configured-site';
  return url.hostname === FAST_PROXY_HOST ? 'fast' : null;
}

const ROUTE_ADAPTERS = Object.freeze({
  'configured-site': CONFIGURED_SITE_ROUTE_ADAPTER,
  fast: FAST_ROUTE_ADAPTER,
  github: GITHUB_ROUTE_ADAPTER,
  'public-page': PUBLIC_PAGE_ROUTE_ADAPTER,
  'web-site': WEB_ROUTE_ADAPTER
});

/**
 * Returns the strategy for an already resolved route feature.
 * @param {ReturnType<typeof resolveRouteFeature>} feature
 * @returns {typeof ROUTE_ADAPTERS[keyof typeof ROUTE_ADAPTERS] | null} Matching route strategy.
 */
export function resolveRouteAdapterForFeature(feature) {
  return feature ? ROUTE_ADAPTERS[feature] : null;
}

/**
 * Executes only the application-route strategy fixed in the request context.
 * @param {ApplicationRouteContext} context Request context with a strategy fixed at entry.
 * @returns {Promise<ApplicationRouteResult | null>} Selected route result.
 */
export async function handleApplicationRoute(context) {
  return context.routeAdapter ? await context.routeAdapter.handle(context) : null;
}
