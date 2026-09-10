import { handleGithubWebRequest } from '../github/handle-request.js';
import { handleWebAdapterRequest } from '../web-adapters/handle-request.js';
import { handleConfiguredSiteRequest } from '../proxy/handle-configured-site.js';
import { handleFastRoute } from '../proxy/fast-route.js';
import { finalizeResponse } from '../response/finalize-response.js';
import { createHomepageRedirect, resolveTarget } from '../routing/resolve-target.js';
import { getDefaultCache, tryReadCachedResponse } from '../upstream/cache.js';
import { fetchUpstreamResponse } from '../upstream/fetch-upstream.js';
import { addPerformanceHeaders, PerformanceMonitor } from '../utils/performance.js';
import { addCorsHeaders, addSecurityHeaders, createErrorResponse } from '../utils/security.js';
import { getAllowedMethods, validateRequest } from '../utils/validation.js';
import { runPipeline } from '../filters/run-pipeline.js';
import { reserveWorkerRequest } from '../quota/reserve-worker-request.js';

/**
 * Dispatches routes that own a fixed browser-facing host before platform routing.
 * @param {{ request: Request, url: URL, env: Record<string, unknown>, config: import('../config/index.js').ApplicationConfig }} options
 * @returns {Promise<{ response: Response, isProxiedResponse: boolean } | null>}
 */
export async function handleApplicationRoute({ request, url, env, config }) {
  const webAdapterResponse = await handleWebAdapterRequest({ request, url });
  if (webAdapterResponse) return { response: webAdapterResponse, isProxiedResponse: true };

  const githubRoute = await handleGithubWebRequest({ request, url, env, config });
  if (githubRoute) return githubRoute;

  const configuredResponse = await handleConfiguredSiteRequest(request);
  if (configuredResponse) return { response: configuredResponse, isProxiedResponse: true };

  const fastRouteResponse = await handleFastRoute(request, url, config);
  return fastRouteResponse ? { response: fastRouteResponse, isProxiedResponse: true } : null;
}

/** @param {any} context @param {() => Promise<Response>} next */
async function responseBoundaryFilter(context, next) {
  let response;
  try {
    response = await next();
  } catch (error) {
    console.error('Error handling request:', error);
    response = createErrorResponse('Internal Server Error', 500);
  }

  context.monitor.mark('complete');
  const headers = addCorsHeaders(new Headers(response.headers), context.request, context.config);
  const responseWithCors = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
  return context.adapter.usesProtocolSemantics
    ? responseWithCors
    : addPerformanceHeaders(responseWithCors, context.monitor, {
        isProxiedResponse: context.isProxiedResponse
      });
}

/** @param {any} context @param {() => Promise<Response>} next */
async function authenticationFilter(context, next) {
  const authorization = await context.adapter.authenticate(context);
  if (authorization.response) return authorization.response;
  context.principal = authorization.principal;
  return await next();
}

/** @param {any} context @param {() => Promise<Response>} next */
async function quotaFilter(context, next) {
  const response = await reserveWorkerRequest(context.env);
  return response || (await next());
}

/** @param {any} context @param {() => Promise<Response>} next */
async function corsPreflightFilter(context, next) {
  if (!context.isCorsPreflight) return await next();
  const requestedMethod = context.request.headers.get('Access-Control-Request-Method') || '';
  const allowedMethods = getAllowedMethods(
    new Request(context.request.url, { method: requestedMethod || 'GET' }),
    context.url,
    context.config
  );
  if (!allowedMethods.includes(requestedMethod))
    return createErrorResponse('Method not allowed', 405);

  const headers = addCorsHeaders(new Headers(), context.request, context.config);
  if (!headers.has('Access-Control-Allow-Origin'))
    return createErrorResponse('Origin not allowed', 403);
  headers.set('Access-Control-Allow-Methods', allowedMethods.join(', '));
  headers.set('Access-Control-Max-Age', '86400');
  addSecurityHeaders(headers);
  return new Response(null, { status: 204, headers });
}

/** @param {any} context @param {() => Promise<Response>} next */
async function applicationRouteFilter(context, next) {
  const route = await handleApplicationRoute(context);
  if (!route) return await next();
  context.isProxiedResponse = route.isProxiedResponse;
  return route.response;
}

/** @param {any} context @param {() => Promise<Response>} next */
async function protocolRouteFilter(context, next) {
  const response = await context.adapter.handleProtocolRoute(context);
  return response || (await next());
}

/** @param {any} context @param {() => Promise<Response>} next */
async function validationFilter(context, next) {
  if (context.url.pathname === '/' || context.url.pathname === '') return createHomepageRedirect();
  const validation = validateRequest(context.request, context.url, context.config, context);
  if (!validation.valid) {
    return createErrorResponse(validation.error || 'Validation failed', validation.status || 400);
  }
  return await next();
}

/** @param {any} context @param {() => Promise<Response>} next */
async function routingFilter(context, next) {
  const normalizedPath = context.adapter.normalizePath(context);
  if ('response' in normalizedPath) return normalizedPath.response;
  const resolvedTarget = resolveTarget(
    context.url,
    normalizedPath.effectivePath,
    context.config.PLATFORMS
  );
  if ('response' in resolvedTarget) return resolvedTarget.response;
  context.route = { ...resolvedTarget, effectivePath: normalizedPath.effectivePath };
  context.isProxiedResponse = true;
  return await next();
}

/** @param {any} context @param {() => Promise<Response>} next */
async function cacheFilter(context, next) {
  const authorization = context.request.headers.get('Authorization');
  const hasSensitiveHeaders = Boolean(
    authorization ||
    context.request.headers.get('Cookie') ||
    context.request.headers.get('Proxy-Authorization')
  );
  const canUseCache = context.request.method === 'GET' || context.request.method === 'HEAD';
  const cache = getDefaultCache();
  const cachedResponse = await tryReadCachedResponse({
    cache,
    cacheTargetUrl: context.route.cacheTargetUrl,
    canUseCache,
    hasSensitiveHeaders,
    monitor: context.monitor,
    request: context.request,
    requestContext: context
  });
  if (cachedResponse) return cachedResponse;

  context.cacheState = { authorization, cache, canUseCache, hasSensitiveHeaders };
  return await next();
}

/** @param {any} context */
async function transportFilter(context) {
  const { authorization, cache, canUseCache, hasSensitiveHeaders } = context.cacheState;
  const shouldPassthroughRequest = context.adapter.usesProtocolSemantics || !canUseCache;
  const { response, responseGeneratedLocally } = await fetchUpstreamResponse({
    authorization,
    canUseCache,
    config: context.config,
    effectivePath: context.route.effectivePath,
    monitor: context.monitor,
    platform: context.route.platform,
    request: context.request,
    requestContext: context,
    shouldPassthroughRequest,
    targetUrl: context.route.targetUrl
  });
  return await finalizeResponse({
    cache,
    cacheTargetUrl: context.route.cacheTargetUrl,
    canUseCache,
    config: context.config,
    ctx: context.ctx,
    effectivePath: context.route.effectivePath,
    hasSensitiveHeaders,
    monitor: context.monitor,
    platform: context.route.platform,
    request: context.request,
    requestContext: context,
    response,
    responseGeneratedLocally,
    url: context.url
  });
}

const REQUEST_PIPELINE = Object.freeze([
  responseBoundaryFilter,
  authenticationFilter,
  quotaFilter,
  corsPreflightFilter,
  applicationRouteFilter,
  protocolRouteFilter,
  validationFilter,
  routingFilter,
  cacheFilter,
  transportFilter
]);

/** @param {any} requestContext @param {ExecutionContext} ctx */
export async function runRequestPipeline(requestContext, ctx) {
  return await runPipeline(
    { ...requestContext, ctx, isProxiedResponse: false, monitor: new PerformanceMonitor() },
    REQUEST_PIPELINE
  );
}
