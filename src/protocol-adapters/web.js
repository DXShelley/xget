import { handleBrowserAuth, validateBrowserSession } from '../auth/browser.js';
import { BASE_PROTOCOL_ADAPTER, allowAnonymous, isAuthenticationRequired } from './base.js';

export const WEB_ADAPTER = Object.freeze({
  ...BASE_PROTOCOL_ADAPTER,
  kind: 'web',
  /** @param {{ env: Record<string, unknown>, request: Request, url: URL }} context */
  authenticate: async context => {
    const endpointResponse = await handleBrowserAuth(context.request, context.env);
    if (endpointResponse) return { principal: null, response: endpointResponse };
    if (context.request.method === 'OPTIONS') return allowAnonymous();

    const principal = await validateBrowserSession(context.request, context.env);
    if (principal || !isAuthenticationRequired(context.env)) return { principal, response: null };

    return {
      principal: null,
      response: new Response('Authentication required', {
        headers: {
          Location: `/__xget/auth/login?return_to=${encodeURIComponent(
            context.url.pathname + context.url.search
          )}`
        },
        status: 302
      })
    };
  }
});
