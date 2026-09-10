import { handleWebAdapterRequest } from '../../web-adapters/handle-request.js';
import { createRouteAdapter, routeResponse } from './base.js';

/** Multi-origin interactive Web site strategy. */
export const WEB_ROUTE_ADAPTER = createRouteAdapter('web-site', async ({ request, url }) =>
  routeResponse(await handleWebAdapterRequest({ request, url }))
);
