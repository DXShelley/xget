/**
 * Xget - High-performance acceleration engine for developer resources
 * Copyright (C) Xi Xu
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { createErrorResponse } from '../utils/security.js';

const MEDIA_FILE_PATTERN =
  /\.(mp4|avi|mkv|mov|wmv|flv|webm|mp3|wav|flac|aac|ogg|jpg|jpeg|png|gif|bmp|svg|pdf|zip|rar|7z|tar|gz|bz2|xz)$/i;

/**
 * Creates upstream fetch options for the current request.
 * @param {{
 *   authorization: string | null,
 *   canUseCache: boolean,
 *   config: import('../config/index.js').ApplicationConfig,
 *   request: Request,
 *   requestContext: {
 *     adapter: any,
 *     isAI: boolean,
 *     isDocker: boolean,
 *     isGit: boolean,
 *     isGitLFS: boolean,
 *     isHF: boolean,
 *     principal?: { id: string, authMethod: string, expiresAt: string } | null,
 *     url: URL
 *   },
 *   shouldPassthroughRequest: boolean,
 *   targetUrl: string
 * }} options
 * @returns {{ fetchOptions: RequestInit, requestHeaders: Headers }} Fetch options and mutable headers.
 */
function createFetchOptions({
  authorization,
  canUseCache,
  config,
  request,
  requestContext,
  shouldPassthroughRequest,
  targetUrl
}) {
  /** @type {RequestInit} */
  const fetchOptions = {
    method: request.method,
    headers: new Headers(),
    redirect: 'follow'
  };

  if (request.body !== null && !canUseCache) {
    fetchOptions.body = request.body;
  }

  const requestHeaders = /** @type {Headers} */ (fetchOptions.headers);

  if (shouldPassthroughRequest) {
    for (const [key, value] of request.headers.entries()) {
      if (!['host', 'connection', 'upgrade', 'proxy-connection'].includes(key.toLowerCase())) {
        requestHeaders.set(key, value);
      }
    }

    requestContext.adapter.prepareUpstreamHeaders({
      headers: requestHeaders,
      isGitLFS: requestContext.isGitLFS,
      principal: requestContext.principal,
      request,
      url: requestContext.url
    });

    return { fetchOptions, requestHeaders };
  }

  Object.assign(fetchOptions, {
    cf: {
      http3: true,
      cacheTtl: config.CACHE_DURATION,
      cacheEverything: true,
      preconnect: true
    }
  });

  requestHeaders.set('Accept-Encoding', 'gzip, deflate, br');
  requestHeaders.set('Connection', 'keep-alive');
  requestHeaders.set('User-Agent', 'Wget/1.21.3');

  const origin = request.headers.get('Origin');
  if (origin) {
    requestHeaders.set('Origin', origin);
  }

  if (authorization) {
    requestHeaders.set('Authorization', authorization);
  }

  const rangeHeader = request.headers.get('Range');
  if (MEDIA_FILE_PATTERN.test(targetUrl) || rangeHeader) {
    requestHeaders.set('Accept-Encoding', 'identity');
  }

  if (rangeHeader) {
    requestHeaders.set('Range', rangeHeader);
  }

  return { fetchOptions, requestHeaders };
}

/**
 * Executes the upstream fetch, including HEAD fallback probing and Docker redirect handling.
 * @param {{
 *   fetchOptions: RequestInit,
 *   request: Request,
 *   requestContext: {
 *     adapter: any,
 *     isDocker: boolean
 *   },
 *   requestHeaders: Headers,
 *   targetUrl: string
 * }} options
 * @returns {Promise<Response>} Upstream response.
 */
async function executeFetch({ fetchOptions, request, requestContext, requestHeaders, targetUrl }) {
  const finalFetchOptions = /** @type {RequestInit} */ ({
    ...fetchOptions,
    signal: /** @type {AbortSignal} */ (fetchOptions.signal)
  });

  const configuredFetchOptions = requestContext.adapter.configureFetchOptions(finalFetchOptions);

  let response;
  if (request.method === 'HEAD') {
    response = await fetch(targetUrl, configuredFetchOptions);

    if (response.ok && !response.headers.get('Content-Length')) {
      const rangeHeaders = new Headers(requestHeaders);
      rangeHeaders.set('Range', 'bytes=0-0');

      const rangeResponse = await fetch(targetUrl, {
        ...configuredFetchOptions,
        method: 'GET',
        headers: rangeHeaders
      });

      let contentLength = null;

      if (rangeResponse.status === 206) {
        const contentRange = rangeResponse.headers.get('Content-Range');
        if (contentRange) {
          const match = contentRange.match(/bytes\s+\d+-\d+\/(\d+)/);
          if (match) {
            [, contentLength] = match;
          }
        }
      } else if (rangeResponse.ok) {
        contentLength = rangeResponse.headers.get('Content-Length');
      }

      if (contentLength) {
        const headHeaders = new Headers(response.headers);
        headHeaders.set('Content-Length', contentLength);
        response = new Response(null, {
          status: response.status,
          statusText: response.statusText,
          headers: headHeaders
        });
      }
    }
  } else {
    response = await fetch(targetUrl, configuredFetchOptions);
  }

  response = await requestContext.adapter.transformFetchedResponse(response, {
    fetchOptions: configuredFetchOptions,
    targetUrl
  });

  return response;
}

/**
 * Fetches an upstream resource with retries and protocol-specific handling.
 * @param {{
 *   authorization: string | null,
 *   canUseCache: boolean,
 *   config: import('../config/index.js').ApplicationConfig,
 *   effectivePath: string,
 *   monitor: import('../utils/performance.js').PerformanceMonitor,
 *   platform: string,
 *   request: Request,
 *   requestContext: {
 *     adapter: any,
 *     isAI: boolean,
 *     isDocker: boolean,
 *     isGit: boolean,
 *     isGitLFS: boolean,
 *     isHF: boolean,
 *     principal?: { id: string, authMethod: string, expiresAt: string } | null,
 *     url: URL
 *   },
 *   shouldPassthroughRequest: boolean,
 *   targetUrl: string
 * }} options
 * @returns {Promise<{ response: Response, responseGeneratedLocally: boolean }>} Upstream or synthesized response.
 */
export async function fetchUpstreamResponse({
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
}) {
  let response;
  let responseGeneratedLocally = false;
  const deadline = Date.now() + config.TIMEOUT_SECONDS * 1000;
  const { fetchOptions, requestHeaders } = createFetchOptions({
    authorization,
    canUseCache,
    config,
    request,
    requestContext,
    shouldPassthroughRequest,
    targetUrl
  });

  let attempts = 0;
  while (attempts < config.MAX_RETRIES) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timeoutId;

    try {
      const remainingTime = deadline - Date.now();
      if (remainingTime <= 0) {
        response = createErrorResponse('Request timeout', 408);
        responseGeneratedLocally = true;
        break;
      }

      monitor.mark(`attempt_${attempts}`);

      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), remainingTime);

      fetchOptions.signal = controller.signal;
      response = await executeFetch({
        fetchOptions,
        request,
        requestContext,
        requestHeaders,
        targetUrl
      });

      if (response.ok || response.status === 206) {
        monitor.mark('success');
        break;
      }

      if (response.status === 401) {
        const retryResponse = await requestContext.adapter.retryUnauthorized({
          effectivePath,
          fetchOptions,
          platform,
          requestContext,
          requestHeaders,
          response,
          signal: controller.signal,
          targetUrl
        });
        if (retryResponse) {
          monitor.mark('protocol_auth_challenge');
          response = retryResponse;
          if (response.ok) {
            monitor.mark('success');
          }
          break;
        }
      }

      if (response.status >= 400 && response.status < 500) {
        monitor.mark('client_error');
        break;
      }

      attempts++;
      if (attempts < config.MAX_RETRIES) {
        const retryRemainingTime = deadline - Date.now();
        if (retryRemainingTime <= 0) {
          response = createErrorResponse('Request timeout', 408);
          responseGeneratedLocally = true;
          break;
        }

        const retryDelay = Math.min(config.RETRY_DELAY_MS * attempts, retryRemainingTime);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    } catch (error) {
      attempts++;
      if (error instanceof Error && error.name === 'AbortError') {
        response = createErrorResponse('Request timeout', 408);
        responseGeneratedLocally = true;
        break;
      }

      if (attempts >= config.MAX_RETRIES) {
        response = createErrorResponse('Upstream request failed', 502);
        responseGeneratedLocally = true;
        break;
      }

      const remainingTime = deadline - Date.now();
      if (remainingTime <= 0) {
        response = createErrorResponse('Request timeout', 408);
        responseGeneratedLocally = true;
        break;
      }

      const retryDelay = Math.min(config.RETRY_DELAY_MS * attempts, remainingTime);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  if (!response) {
    response = createErrorResponse('No response received after all retry attempts', 500);
    responseGeneratedLocally = true;
  }

  return { response, responseGeneratedLocally };
}
