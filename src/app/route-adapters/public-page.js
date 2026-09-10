import { handleAutoPage } from '../../proxy/auto-page/handle.js';
import { createRouteAdapter, routeResponse } from './base.js';

/** Anonymous automatic public-page strategy. */
export const PUBLIC_PAGE_ROUTE_ADAPTER = createRouteAdapter(
  'public-page',
  async ({ request, env }) => routeResponse(await handleAutoPage(request, env))
);
