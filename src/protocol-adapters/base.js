/**
 * Default protocol behavior used when a request has no protocol-specific override.
 * @type {{ kind: string, allowsSharedCache: () => boolean, authenticate: () => Promise<{ principal: null, response: null }>, configureFetchOptions: (options: RequestInit) => RequestInit, handleProtocolRoute: () => Promise<Response | null>, normalizePath: (context: { url: URL }) => { effectivePath: string }, prepareUpstreamHeaders: () => void, preserveUpstreamAuthenticationChallenge: boolean, retryUnauthorized: () => Promise<Response | null>, transformFetchedResponse: (response: Response) => Promise<Response>, usesProtocolSemantics: boolean }}
 */
export const BASE_PROTOCOL_ADAPTER = Object.freeze({
  kind: 'web',
  allowsSharedCache: () => true,
  authenticate: async () => ({ principal: null, response: null }),
  configureFetchOptions: options => options,
  handleProtocolRoute: async () => null,
  normalizePath: context => ({ effectivePath: context.url.pathname }),
  prepareUpstreamHeaders: () => {},
  preserveUpstreamAuthenticationChallenge: false,
  retryUnauthorized: async () => null,
  transformFetchedResponse: async response => response,
  usesProtocolSemantics: false
});

/**
 * Creates an immutable protocol strategy by overriding the shared adapter contract.
 * @param {Record<string, unknown>} overrides Protocol-specific behavior.
 * @returns {typeof BASE_PROTOCOL_ADAPTER & Record<string, unknown>} Immutable protocol strategy.
 */
export function createProtocolAdapter(overrides) {
  return Object.freeze({ ...BASE_PROTOCOL_ADAPTER, ...overrides });
}

/** @param {Record<string, unknown>} env @returns {boolean} */
export function isAuthenticationRequired(env) {
  return String(env.XGET_AUTH_REQUIRED || '').toLowerCase() === 'true';
}

/** @returns {{ principal: null, response: null }} */
export function allowAnonymous() {
  return { principal: null, response: null };
}

/**
 * Removes credentials consumed by Xget before a protocol adapter calls its upstream.
 * @param {Headers} headers Mutable upstream request headers.
 * @returns {void}
 */
export function stripProxyAuthentication(headers) {
  headers.delete('Authorization');
  headers.delete('Cookie');
  headers.delete('Proxy-Authorization');
}
