import { fetchGithubWeb } from './fetch.js';
import { classifyGithubWebRequest } from './routing.js';
import { finalizeGithubWebResponse } from './response.js';
import { createErrorResponse } from '../utils/security.js';
import { validateRequest } from '../utils/validation.js';
import { isGitRequest } from '../protocols/git.js';

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

  const { response } = await fetchGithubWeb({
    request,
    targetUrl: route.upstreamUrl,
    config,
    forwardBody: route.forwardBody,
    stripAuthorization: isGitRequest(request, url)
  });

  return {
    response: await finalizeGithubWebResponse({
      response,
      origin: url.origin,
      upstreamHost: new URL(route.upstreamUrl).hostname
    }),
    isProxiedResponse: true
  };
}
