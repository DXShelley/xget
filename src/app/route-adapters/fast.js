import { handleFastRoute } from '../../proxy/fast-route.js';
import { createRouteAdapter, routeResponse } from './base.js';

/**
 * Tests whether a Fast path belongs to a configured platform prefix.
 * @param {URL} url
 * @param {import('../../config/index.js').ApplicationConfig} config
 */
function isKnownPlatformPath(url, config) {
  return Object.keys(config.PLATFORMS).some(key => {
    const prefix = `/${key.replace(/-/g, '/')}`;
    return url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
  });
}

/** Fast entry-page and alias-path strategy. */
export const FAST_ROUTE_ADAPTER = createRouteAdapter(
  'fast',
  async ({ request, url, config, env, principal }) => {
    const response = await handleFastRoute(request, url, config, {
      automaticPages: Boolean(env.PAGE_MAP),
      principal
    });
    if (response) return routeResponse(response);
    if (env.PAGE_MAP && url.pathname !== '/' && !isKnownPlatformPath(url, config)) {
      return routeResponse(
        new Response('Unknown resource: open the page through ?target= first', { status: 404 }),
        false
      );
    }
    return null;
  }
);
