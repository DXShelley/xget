import { PACKAGE_MANAGER_PLATFORM_KEYS } from '../config/platform-catalog.js';
import {
  gitAuthenticationChallenge,
  handleBrowserAuth,
  validateBrowserSession,
  validateDockerCredential,
  validateGitCredential
} from './browser.js';

const ANONYMOUS_AUTHORIZATION = Object.freeze({ principal: null, response: null });
const PACKAGE_MANAGER_PATH_PREFIXES = Object.freeze(
  PACKAGE_MANAGER_PLATFORM_KEYS.map(key => `/${key.replaceAll('-', '/')}`)
);
const AUTHORIZATION_HANDLERS = Object.freeze([
  authorizeAuthenticationEndpoint,
  authorizeGitRequest,
  authorizeDockerRequest,
  authorizePublicProtocolRequest,
  authorizeBrowserProxyRequest
]);

/**
 * Applies the first matching authorization adapter for an incoming request.
 * @param {Request} request The incoming request.
 * @param {{ env: Record<string, unknown>, isAI: boolean, isDocker: boolean, isGit: boolean, isGitLFS: boolean, isHF: boolean, url: URL }} requestContext Parsed protocol traits and runtime configuration.
 * @returns {Promise<{ principal: { id: string, authMethod: string, expiresAt: string } | null, response: Response | null }>} The authenticated principal or a terminal protocol response.
 */
export async function authorizeRequest(request, requestContext) {
  for (const authorize of AUTHORIZATION_HANDLERS) {
    const result = await authorize(request, requestContext);
    if (result) return result;
  }
  return ANONYMOUS_AUTHORIZATION;
}

/**
 * Handles Xget's browser authentication endpoints.
 * @param {Request} request The incoming request.
 * @param {{ env: Record<string, unknown> }} requestContext Runtime configuration.
 * @returns {Promise<{ principal: null, response: Response } | null>} A terminal endpoint response when the path is an authentication endpoint.
 */
async function authorizeAuthenticationEndpoint(request, requestContext) {
  const response = await handleBrowserAuth(request, requestContext.env);
  return response ? { principal: null, response } : null;
}

/**
 * Applies Basic authentication to Git Smart HTTP and Git LFS requests.
 * @param {Request} request The incoming request.
 * @param {{ env: Record<string, unknown>, isGit: boolean, isGitLFS: boolean }} requestContext Runtime configuration and Git protocol traits.
 * @returns {Promise<{ principal: { id: string, authMethod: string, expiresAt: string } | null, response: Response | null } | null>} An authorization result for Git traffic, or null when it does not apply.
 */
async function authorizeGitRequest(request, requestContext) {
  if (!requestContext.isGit && !requestContext.isGitLFS) return null;
  const principal = await validateGitCredential(request, requestContext.env);
  return principal
    ? { principal, response: null }
    : isAuthRequired(requestContext.env)
      ? { principal: null, response: gitAuthenticationChallenge() }
      : ANONYMOUS_AUTHORIZATION;
}

/**
 * Applies Registry Bearer authentication to Docker and OCI requests.
 * @param {Request} request The incoming request.
 * @param {{ env: Record<string, unknown>, isDocker: boolean, url: URL }} requestContext Runtime configuration, Docker trait, and URL.
 * @returns {Promise<{ principal: { id: string, authMethod: string, expiresAt: string } | null, response: Response | null } | null>} An authorization result for registry traffic, or null when it does not apply.
 */
async function authorizeDockerRequest(request, requestContext) {
  if (!requestContext.isDocker || requestContext.url.pathname.includes('/v2/auth')) return null;
  const principal = await validateDockerCredential(request, requestContext.env);
  return principal
    ? { principal, response: null }
    : isAuthRequired(requestContext.env)
      ? { principal: null, response: dockerAuthenticationChallenge(requestContext.url) }
      : ANONYMOUS_AUTHORIZATION;
}

/**
 * Leaves protocols whose client credentials belong to the upstream anonymous.
 * @param {Request} request The incoming request.
 * @param {{ isAI: boolean, isHF: boolean, url: URL }} requestContext AI, Hugging Face, and path traits.
 * @returns {{ principal: null, response: null } | null} An anonymous result for a public protocol, or null when it does not apply.
 */
function authorizePublicProtocolRequest(request, requestContext) {
  void request;
  return requestContext.isAI || requestContext.isHF || isPackageManagerRequest(requestContext.url)
    ? ANONYMOUS_AUTHORIZATION
    : null;
}

/**
 * Applies cookie authentication to browser-facing proxy requests.
 * @param {Request} request The incoming request.
 * @param {{ env: Record<string, unknown>, url: URL }} requestContext Runtime configuration and URL.
 * @returns {Promise<{ principal: { id: string, authMethod: string, expiresAt: string } | null, response: Response | null }>} A browser principal or login redirect response.
 */
async function authorizeBrowserProxyRequest(request, requestContext) {
  if (request.method === 'OPTIONS') return ANONYMOUS_AUTHORIZATION;
  const principal = await validateBrowserSession(request, requestContext.env);
  if (principal || !isAuthRequired(requestContext.env)) return { principal, response: null };
  return {
    principal: null,
    response: new Response('Authentication required', {
      headers: {
        Location: `/__xget/auth/login?return_to=${encodeURIComponent(
          requestContext.url.pathname + requestContext.url.search
        )}`
      },
      status: 302
    })
  };
}

/**
 * Checks whether the route belongs to a package manager.
 * @param {URL} url The request URL.
 * @returns {boolean} Whether the route belongs to a package manager.
 */
function isPackageManagerRequest(url) {
  return PACKAGE_MANAGER_PATH_PREFIXES.some(
    prefix => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Checks whether Xget authentication is enabled.
 * @param {Record<string, unknown>} env Runtime configuration.
 * @returns {boolean} Whether Xget authentication is enabled.
 */
function isAuthRequired(env) {
  return String(env.XGET_AUTH_REQUIRED || '').toLowerCase() === 'true';
}

/**
 * Creates a Docker Registry Bearer authentication challenge.
 * @param {URL} url The request URL.
 * @returns {Response} The registry authentication challenge.
 */
function dockerAuthenticationChallenge(url) {
  const realmPath = url.pathname.startsWith('/cr/')
    ? `/cr/${url.pathname.split('/')[2]}/v2/auth`
    : '/v2/auth';
  return new Response('Docker authentication required', {
    headers: {
      'Cache-Control': 'no-store',
      'Docker-Distribution-Api-Version': 'registry/2.0',
      'WWW-Authenticate': `Bearer realm="${url.origin}${realmPath}",service="xget"`
    },
    status: 401
  });
}
