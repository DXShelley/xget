import { handleGithubWebRequest } from '../github/handle-request.js';
import { handleWebAdapterRequest } from '../web-adapters/handle-request.js';
import { handleConfiguredSiteRequest } from '../proxy/handle-configured-site.js';
import { handleFastRoute } from '../proxy/fast-route.js';
import { handleAutoPage } from '../proxy/auto-page/handle.js';

/**
 * Dispatches routes that own a fixed browser-facing host before platform routing.
 * @param {{ request: Request, url: URL, env: Record<string, unknown>, config: import('../config/index.js').ApplicationConfig, principal?: { id: string, authMethod: string, expiresAt: string } | null, protocolFeature?: string }} options
 * @returns {Promise<{ response: Response, isProxiedResponse: boolean } | null>}
 */
export async function handleApplicationRoute({
  request,
  url,
  env,
  config,
  principal,
  protocolFeature
}) {
  if (protocolFeature === 'public-page') {
    const autoPageResponse = await handleAutoPage(request, env);
    if (autoPageResponse) return { response: autoPageResponse, isProxiedResponse: true };
  }

  const webAdapterResponse = await handleWebAdapterRequest({ request, url });
  if (webAdapterResponse) return { response: webAdapterResponse, isProxiedResponse: true };

  const githubRoute = await handleGithubWebRequest({ request, url, env, config });
  if (githubRoute) return githubRoute;

  const configuredResponse = await handleConfiguredSiteRequest(request);
  if (configuredResponse) return { response: configuredResponse, isProxiedResponse: true };

  const fastRouteResponse = await handleFastRoute(request, url, config, {
    automaticPages: Boolean(env.PAGE_MAP),
    principal
  });
  if (fastRouteResponse) return { response: fastRouteResponse, isProxiedResponse: true };

  if (env.PAGE_MAP && url.hostname === 'fast.dxshelley.fun' && url.pathname !== '/') {
    const knownPlatform = Object.keys(config.PLATFORMS).some(key => {
      const prefix = `/${key.replace(/-/g, '/')}`;
      return url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
    });
    if (!knownPlatform)
      return {
        response: new Response('Unknown resource: open the page through ?target= first', {
          status: 404
        }),
        isProxiedResponse: false
      };
  }
  return null;
}
