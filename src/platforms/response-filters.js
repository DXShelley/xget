/**
 * Platform-specific text response filters and cache isolation policies.
 */

const FLATHUB_REPO_BASE_URL_PATTERN = /https:\/\/(?:dl\.)?flathub\.org\/repo\//g;
const FLATPAK_REFERENCE_FILE_PATTERN = /\.(flatpakrepo|flatpakref)$/i;

/**
 * Checks whether a path names a Flatpak descriptor.
 * @param {string} requestPath
 * @returns {boolean} Whether the path is a Flatpak descriptor.
 */
export function isFlatpakReferenceFilePath(requestPath) {
  return FLATPAK_REFERENCE_FILE_PATTERN.test(requestPath);
}

/**
 * Checks whether an upstream text response has a platform-specific filter.
 * @param {string} platform
 * @param {string} requestPath
 * @param {string} contentType
 * @returns {boolean} Whether the response body must be filtered.
 */
export function shouldFilterPlatformTextResponse(platform, requestPath, contentType = '') {
  if (platform === 'pypi') return contentType.includes('text/html');
  if (platform === 'npm') return contentType.includes('application/json');
  return platform === 'flathub' && isFlatpakReferenceFilePath(requestPath);
}

/**
 * Rewrites platform-origin URLs so follow-up requests remain on this proxy.
 * @param {string} platform
 * @param {string} requestPath
 * @param {string} originalText
 * @param {string} origin
 * @returns {string} Filtered response body.
 */
export function filterPlatformTextResponse(platform, requestPath, originalText, origin) {
  if (platform === 'pypi') {
    return originalText.replace(/https:\/\/files\.pythonhosted\.org/g, `${origin}/pypi/files`);
  }
  if (platform === 'npm') {
    return originalText.replace(/https:\/\/registry\.npmjs\.org\/([^/]+)/g, `${origin}/npm/$1`);
  }
  if (platform === 'flathub' && isFlatpakReferenceFilePath(requestPath)) {
    return originalText.replace(FLATHUB_REPO_BASE_URL_PATTERN, `${origin}/flathub/repo/`);
  }
  return originalText;
}

/**
 * Identifies responses whose cache key must include the requesting proxy origin.
 * @param {string} platform
 * @param {string} requestPath
 * @returns {boolean} Whether the cache key must vary by origin.
 */
export function shouldVaryPlatformCacheByOrigin(platform, requestPath) {
  return platform === 'flathub' && isFlatpakReferenceFilePath(requestPath);
}

/**
 * Identifies filtered response types that cannot use the shared cache.
 * @param {string} platform
 * @returns {boolean} Whether a filtered response requires private cache handling.
 */
export function isOriginBoundPlatformResponse(platform) {
  return platform === 'pypi';
}
