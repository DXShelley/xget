/**
 * Xget - High-performance acceleration engine for developer resources
 * Copyright (C) Xi Xu
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { handleDockerAuth } from '../protocols/docker.js';
import { handleGithubWebRequest } from '../github/handle-request.js';
import { handleWebAdapterRequest } from '../web-adapters/handle-request.js';
import { handleConfiguredSiteRequest } from '../proxy/handle-configured-site.js';
import { handleFastRoute } from '../proxy/fast-route.js';
import { finalizeResponse } from '../response/finalize-response.js';
import {
  createHomepageRedirect,
  normalizeEffectivePath,
  resolveTarget
} from '../routing/resolve-target.js';
import { getDefaultCache, tryReadCachedResponse } from '../upstream/cache.js';
import { fetchUpstreamResponse } from '../upstream/fetch-upstream.js';
import { PerformanceMonitor, addPerformanceHeaders } from '../utils/performance.js';
import { addCorsHeaders, addSecurityHeaders, createErrorResponse } from '../utils/security.js';
import { getAllowedMethods, isProtocolRequest, validateRequest } from '../utils/validation.js';
import { createRequestContext } from './request-context.js';
import { reserveWorkerRequest } from '../quota/reserve-worker-request.js';
import {
  gitAuthenticationChallenge,
  handleBrowserAuth,
  validateBrowserSession,
  validateGitCredential
} from '../auth/browser.js';

/**
 * Dispatches routes that own a fixed browser-facing host before platform routing.
 * @param {{ request: Request, url: URL, env: Record<string, unknown>, config: import('../config/index.js').ApplicationConfig }} options
 * @returns {Promise<{ response: Response, isProxiedResponse: boolean } | null>} A handled application route, or null.
 */
export async function handleApplicationRoute({ request, url, env, config }) {
  const webAdapterResponse = await handleWebAdapterRequest({ request, url });
  if (webAdapterResponse) return { response: webAdapterResponse, isProxiedResponse: true };

  const githubRoute = await handleGithubWebRequest({ request, url, env, config });
  if (githubRoute) return githubRoute;

  const configuredResponse = await handleConfiguredSiteRequest(request);
  if (configuredResponse) return { response: configuredResponse, isProxiedResponse: true };

  const fastRouteResponse = await handleFastRoute(request, url);
  return fastRouteResponse ? { response: fastRouteResponse, isProxiedResponse: true } : null;
}

/**
 * Main request handler with comprehensive caching, retry logic, and security measures.
 * @param {Request} request - The incoming HTTP request
 * @param {Record<string, unknown>} env - Cloudflare Workers environment variables for runtime config overrides
 * @param {ExecutionContext} ctx - Cloudflare Workers execution context for background tasks
 * @returns {Promise<Response>} The HTTP response with appropriate headers and body
 */
export async function handleRequest(request, env, ctx) {
  let response;
  let isProxiedResponse = false;
  const monitor = new PerformanceMonitor();
  const requestContext = createRequestContext(request, env);
  const { config, isCorsPreflight, isDocker, url } = requestContext;

  try {
    const authEndpoint = new URL(request.url).pathname.startsWith('/__xget/auth/');
    const authResponse = await handleBrowserAuth(request, requestContext.env);
    const browserPrincipal = await validateBrowserSession(request, requestContext.env);
    const gitPrincipal = requestContext.isGit
      ? await validateGitCredential(request, requestContext.env)
      : null;
    const principal = requestContext.isGit ? gitPrincipal : browserPrincipal;
    const loginRedirect =
      !authResponse &&
      !principal &&
      !authEndpoint &&
      request.method !== 'OPTIONS' &&
      !isProtocolRequest(requestContext) &&
      String(requestContext.env.XGET_AUTH_REQUIRED || '').toLowerCase() === 'true'
        ? new Response('Authentication required', {
            headers: {
              Location: `/__xget/auth/login?return_to=${encodeURIComponent(url.pathname + url.search)}`
            },
            status: 302
          })
        : null;

    const gitAuthResponse =
      requestContext.isGit &&
      !gitPrincipal &&
      String(requestContext.env.XGET_AUTH_REQUIRED || '').toLowerCase() === 'true'
        ? gitAuthenticationChallenge()
        : null;
    const terminalAuthResponse = authResponse || loginRedirect || gitAuthResponse;
    if (terminalAuthResponse) {
      response = terminalAuthResponse;
    } else {
      requestContext.principal = principal;
      const quotaResponse = await reserveWorkerRequest(requestContext.env);
      if (quotaResponse) {
        response = quotaResponse;
      } else if (isCorsPreflight) {
        const requestedMethod = request.headers.get('Access-Control-Request-Method') || '';
        const allowedMethods = getAllowedMethods(
          new Request(request.url, { method: requestedMethod || 'GET' }),
          url,
          config
        );

        if (!allowedMethods.includes(requestedMethod)) {
          response = createErrorResponse('Method not allowed', 405);
        } else {
          const headers = addCorsHeaders(new Headers(), request, config);
          if (!headers.has('Access-Control-Allow-Origin')) {
            response = createErrorResponse('Origin not allowed', 403);
          } else {
            headers.set('Access-Control-Allow-Methods', allowedMethods.join(', '));
            headers.set('Access-Control-Max-Age', '86400');
            addSecurityHeaders(headers);
            response = new Response(null, { status: 204, headers });
          }
        }
      } else {
        const applicationRoute = await handleApplicationRoute({
          request,
          url,
          env: requestContext.env,
          config
        });
        if (applicationRoute) {
          const { response: applicationResponse, isProxiedResponse: applicationResponseIsProxied } =
            applicationRoute;
          response = applicationResponse;
          isProxiedResponse = applicationResponseIsProxied;
        } else {
          // Handle Docker API version check
          if (isDocker && (url.pathname === '/v2/' || url.pathname === '/v2')) {
            const headers = new Headers({
              'Docker-Distribution-Api-Version': 'registry/2.0',
              'Content-Type': 'application/json'
            });
            addSecurityHeaders(headers);
            response = new Response('{}', { status: 200, headers });
          }
          // Redirect root path or invalid platforms to GitHub repository
          else if (url.pathname === '/' || url.pathname === '') {
            response = createHomepageRedirect();
          } else {
            const validation = validateRequest(request, url, config, requestContext);
            if (!validation.valid) {
              response = createErrorResponse(
                validation.error || 'Validation failed',
                validation.status || 400
              );
            } else {
              const normalizedPath = normalizeEffectivePath(url, isDocker);
              let effectivePath = url.pathname;

              if ('response' in normalizedPath) {
                const { response: normalizedResponse } = normalizedPath;
                response = normalizedResponse;
              } else {
                const { effectivePath: normalizedEffectivePath } = normalizedPath;
                effectivePath = normalizedEffectivePath;
              }

              if (!response) {
                // Handle Docker authentication explicitly
                if (
                  isDocker &&
                  (url.pathname === '/v2/auth' || /^\/cr\/[^/]+\/v2\/auth\/?$/.test(url.pathname))
                ) {
                  response = await handleDockerAuth(request, url, config);
                } else {
                  const resolvedTarget = resolveTarget(url, effectivePath, config.PLATFORMS);

                  if ('response' in resolvedTarget) {
                    const { response: targetResponse } = resolvedTarget;
                    response = targetResponse;
                  } else {
                    isProxiedResponse = true;
                    const { cacheTargetUrl, platform, targetUrl } = resolvedTarget;
                    const authorization = request.headers.get('Authorization');
                    const hasSensitiveHeaders = Boolean(
                      authorization ||
                      request.headers.get('Cookie') ||
                      request.headers.get('Proxy-Authorization')
                    );
                    const canUseCache = request.method === 'GET' || request.method === 'HEAD';
                    const shouldPassthroughRequest =
                      isProtocolRequest(requestContext) || !canUseCache;
                    const cache = getDefaultCache();

                    response = await tryReadCachedResponse({
                      cache,
                      cacheTargetUrl,
                      canUseCache,
                      hasSensitiveHeaders,
                      monitor,
                      request,
                      requestContext
                    });

                    if (!response) {
                      const {
                        response: upstreamResponse,
                        responseGeneratedLocally: upstreamResponseGeneratedLocally
                      } = await fetchUpstreamResponse({
                        authorization,
                        canUseCache,
                        config,
                        effectivePath,
                        monitor,
                        platform,
                        request,
                        requestContext,
                        shouldPassthroughRequest,
                        targetUrl
                      });
                      response = await finalizeResponse({
                        cache,
                        cacheTargetUrl,
                        canUseCache,
                        config,
                        ctx,
                        effectivePath,
                        hasSensitiveHeaders,
                        monitor,
                        platform,
                        request,
                        requestContext,
                        response: upstreamResponse,
                        responseGeneratedLocally: upstreamResponseGeneratedLocally,
                        url
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error handling request:', error);
    response = createErrorResponse('Internal Server Error', 500);
  }

  // Ensure performance headers are added to the final response
  monitor.mark('complete');

  const responseWithCors = (() => {
    const headers = addCorsHeaders(new Headers(response.headers), request, config);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  })();

  return isProtocolRequest(requestContext)
    ? responseWithCors
    : addPerformanceHeaders(responseWithCors, monitor, { isProxiedResponse });
}
