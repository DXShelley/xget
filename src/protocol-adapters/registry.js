import { AI_ADAPTER } from './ai.js';
import { BASE_PROTOCOL_ADAPTER } from './base.js';
import { DOCKER_ADAPTER } from './docker.js';
import { GIT_ADAPTER } from './git.js';
import { HUGGING_FACE_ADAPTER } from './huggingface.js';
import { PACKAGE_ADAPTER, isPackageManagerRequest } from './package.js';
import { WEB_ADAPTER } from './web.js';
import { resolveSite } from '../proxy/site-registry.js';

const PROTOCOL_ADAPTERS = Object.freeze({
  ai: AI_ADAPTER,
  docker: DOCKER_ADAPTER,
  git: GIT_ADAPTER,
  huggingface: HUGGING_FACE_ADAPTER,
  package: PACKAGE_ADAPTER,
  web: WEB_ADAPTER
});

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
 * Resolves the single protocol feature that owns the request for its full lifetime.
 * @param {{ isAI: boolean, isDocker: boolean, isGit: boolean, isGitLFS: boolean, isHF: boolean }} traits
 * @param {URL} url
 * @returns {'web' | 'git' | 'docker' | 'ai' | 'huggingface' | 'package'} Fixed protocol feature.
 */
export function resolveProtocolFeature(traits, url) {
  if (isWebOwnedRequest(url)) return 'web';
  if (traits.isGit || traits.isGitLFS) return 'git';
  if (traits.isDocker) return 'docker';
  if (traits.isAI) return 'ai';
  if (traits.isHF) return 'huggingface';
  if (isPackageManagerRequest(url)) return 'package';
  return 'web';
}

/**
 * Returns the adapter selected at request entry.
 * @param {ReturnType<typeof resolveProtocolFeature>} feature
 */
export function resolveProtocolAdapter(feature) {
  return PROTOCOL_ADAPTERS[feature] || BASE_PROTOCOL_ADAPTER;
}
