/**
 * GitHub Web proxy configuration.
 */

export const GITHUB_WEB_UPSTREAM = 'https://github.com';
export const GITHUB_WEB_PREFIX = '/gh';

/** @type {Readonly<Record<string, string>>} */
export const DEFAULT_GITHUB_WEB_SHORTCUTS = Object.freeze({
  hermes: '/DXShelley/xget'
});

/** @type {Readonly<Record<string, string>>} */
export const GITHUB_PROXY_HOSTS = Object.freeze({
  'api.github.com': 'https://api.github.com',
  'avatars.githubusercontent.com': 'https://avatars.githubusercontent.com',
  'codeload.github.com': 'https://codeload.github.com',
  'github.githubassets.com': 'https://github.githubassets.com',
  'objects.githubusercontent.com': 'https://objects.githubusercontent.com',
  'opengraph.githubassets.com': 'https://opengraph.githubassets.com',
  'raw.githubusercontent.com': 'https://raw.githubusercontent.com',
  'repository-images.githubusercontent.com': 'https://repository-images.githubusercontent.com',
  'user-images.githubusercontent.com': 'https://user-images.githubusercontent.com'
});

const SHORTCUT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const REPOSITORY_PATH_PATTERN = /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/.*)?$/;

/**
 * Checks for ASCII control characters without embedding control escapes in a regex.
 * @param {string} value
 * @returns {boolean} True when the value contains an ASCII control character.
 */
function hasAsciiControlChars(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

/**
 * Validates a local repository path used by a shortcut.
 * @param {string} value
 * @returns {boolean} True when the value is a safe repository path.
 */
function isSafeRepositoryPath(value) {
  return (
    REPOSITORY_PATH_PATTERN.test(value) && !value.includes('..') && !hasAsciiControlChars(value)
  );
}

/**
 * Reads shortcut configuration from the environment while retaining defaults.
 * Format: `keyword=/owner/repository,other=/owner/other`.
 * @param {Record<string, unknown>} [env]
 * @returns {{ [keyword: string]: string }} Normalized shortcut map.
 */
export function getGithubWebShortcuts(env = {}) {
  const shortcuts = { ...DEFAULT_GITHUB_WEB_SHORTCUTS };
  const raw = env && typeof env.GITHUB_WEB_SHORTCUTS === 'string' ? env.GITHUB_WEB_SHORTCUTS : '';

  for (const item of raw.split(',')) {
    const separator = item.indexOf('=');
    if (separator < 1) {
      continue;
    }

    const keyword = item.slice(0, separator).trim().toLowerCase();
    const path = item.slice(separator + 1).trim();
    if (SHORTCUT_KEY_PATTERN.test(keyword) && isSafeRepositoryPath(path)) {
      shortcuts[keyword] = path;
    }
  }

  return shortcuts;
}

/**
 * Resolves a resource host from the fixed GitHub proxy allowlist.
 * @param {unknown} host
 * @param {string} path
 * @returns {string | null} The allowlisted upstream URL, or null when rejected.
 */
export function getGithubProxyTarget(host, path) {
  if (typeof host !== 'string' || typeof path !== 'string' || !path.startsWith('/')) {
    return null;
  }

  const upstream = GITHUB_PROXY_HOSTS[host.toLowerCase()];
  if (!upstream) {
    return null;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    return null;
  }

  if (/(^|\/)\.\.(\/|$)/.test(decodedPath) || hasAsciiControlChars(decodedPath)) {
    return null;
  }

  return `${upstream}${path}`;
}
