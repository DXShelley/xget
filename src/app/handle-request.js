/**
 * Xget - High-performance acceleration engine for developer resources
 * Copyright (C) Xi Xu
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { createRequestContext } from './request-context.js';
import { runRequestPipeline } from './request-pipeline.js';

export { handleApplicationRoute } from './application-route.js';

/**
 * Builds the immutable protocol context and delegates request/response handling to the pipeline.
 * @param {Request} request The incoming HTTP request.
 * @param {Record<string, unknown>} env Cloudflare Workers environment overrides.
 * @param {ExecutionContext} ctx Cloudflare Workers execution context.
 * @returns {Promise<Response>} The response after the request pipeline has unwound.
 */
export async function handleRequest(request, env, ctx) {
  return await runRequestPipeline(createRequestContext(request, env), ctx);
}
