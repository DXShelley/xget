import { fetchGithubWeb } from './fetch.js';
import { classifyGithubWebRequest } from './routing.js';
import { finalizeGithubWebResponse } from './response.js';
import { createErrorResponse } from '../utils/security.js';
import { validateRequest } from '../utils/validation.js';

/**
 * Handles a public, anonymous GitHub Web request.
 * @param {{ request: Request, url: URL, env: Record<string, unknown>, config: import('../config/index.js').ApplicationConfig }} options
 * @returns {Promise<{ response: Response, isProxiedResponse: boolean } | null>} Handled result.
 */
export async function handleGithubWebRequest({ request, url, env, config }) {
  const route = classifyGithubWebRequest(request, url, env);
  if (!route) {
    return null;
  }

  const validation = validateRequest(request, url, config, {
    isAI: false,
    isDocker: false,
    isGit: true,
    isGitLFS: false,
    isHF: false
  });
  if (!validation.valid) {
    return {
      response: createErrorResponse(
        validation.error || 'Invalid request',
        validation.status || 400
      ),
      isProxiedResponse: false
    };
  }

  if (route.kind === 'reject') {
    return {
      response: new Response('GitHub Web proxy is read-only', { status: 405 }),
      isProxiedResponse: false
    };
  }

  if (route.kind === 'redirect') {
    return {
      response: Response.redirect(
        route.targetUrl,
        request.method === 'GET' || request.method === 'HEAD' ? 302 : 303
      ),
      isProxiedResponse: false
    };
  }

  const { response } = await fetchGithubWeb({
    request,
    targetUrl: route.upstreamUrl,
    config,
    forwardBody: route.forwardBody
  });

  return {
    response: await finalizeGithubWebResponse({ response, origin: url.origin }),
    isProxiedResponse: true
  };
}
