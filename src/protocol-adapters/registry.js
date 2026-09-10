import { AI_ADAPTER } from './ai.js';
import { BASE_PROTOCOL_ADAPTER } from './base.js';
import { DOCKER_ADAPTER } from './docker.js';
import { GIT_ADAPTER } from './git.js';
import { HUGGING_FACE_ADAPTER } from './huggingface.js';
import { PACKAGE_ADAPTER, isPackageManagerRequest } from './package.js';
import { WEB_ADAPTER } from './web.js';

const PROTOCOL_ADAPTERS = Object.freeze({
  ai: AI_ADAPTER,
  docker: DOCKER_ADAPTER,
  git: GIT_ADAPTER,
  huggingface: HUGGING_FACE_ADAPTER,
  package: PACKAGE_ADAPTER,
  web: WEB_ADAPTER
});

/**
 * Resolves the protocol strategy for a request whose route ownership is not Web.
 * @param {{ isAI: boolean, isDocker: boolean, isGit: boolean, isGitLFS: boolean, isHF: boolean }} traits
 * @param {URL} url
 * @returns {'web' | 'git' | 'docker' | 'ai' | 'huggingface' | 'package'} Fixed protocol feature.
 */
export function resolveProtocolFeature(traits, url) {
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
