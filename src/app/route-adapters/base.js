/**
 * Creates an immutable application-route strategy.
 * @template T
 * @template {string} K
 * @param {K} kind Stable route feature name.
 * @param {(context: T) => Promise<{ response: Response, isProxiedResponse: boolean } | null>} handle Route implementation.
 * @returns {{ kind: K, handle: (context: T) => Promise<{ response: Response, isProxiedResponse: boolean } | null> }} Immutable route strategy.
 */
export function createRouteAdapter(kind, handle) {
  return Object.freeze({ handle, kind });
}

/**
 * Marks a response as produced by an application route.
 * @param {Response | null} response
 * @param {boolean} [isProxiedResponse]
 * @returns {{ response: Response, isProxiedResponse: boolean } | null} Route result, when a route produced a response.
 */
export function routeResponse(response, isProxiedResponse = true) {
  return response ? { response, isProxiedResponse } : null;
}
