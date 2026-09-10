import { resolveSite } from '../proxy/site-registry.js';
import { resolveProtocolFeature } from '../protocol-adapters/registry.js';

/**
 * Determines whether the request belongs to a browser-owned route before
 * protocol-path classification. A registered browser host owns every safe
 * path beneath it, including paths that happen to resemble a platform API.
 * @param {URL} url
 * @returns {boolean} Whether the request is owned by a browser route.
 */
function isWebOwnedRequest(url) {
  if (url.pathname.startsWith('/__xget/auth/')) return true;
  const site = resolveSite(url.hostname);
  return site !== null && site.adapter !== 'github';
}

/**
 * Resolves the fixed request feature from route ownership and protocol traits.
 * @param {{ isAI: boolean, isDocker: boolean, isGit: boolean, isGitLFS: boolean, isHF: boolean }} traits
 * @param {URL} url
 * @returns {'web' | 'git' | 'docker' | 'ai' | 'huggingface' | 'package'} Fixed request feature.
 */
export function resolveRequestFeature(traits, url) {
  return isWebOwnedRequest(url) ? 'web' : resolveProtocolFeature(traits, url);
}
