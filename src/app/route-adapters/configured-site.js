import { handleConfiguredSiteRequest } from '../../proxy/handle-configured-site.js';
import { createRouteAdapter, routeResponse } from './base.js';

/** Configuration-backed browser site strategy. */
export const CONFIGURED_SITE_ROUTE_ADAPTER = createRouteAdapter(
  'configured-site',
  async ({ request }) => routeResponse(await handleConfiguredSiteRequest(request))
);
