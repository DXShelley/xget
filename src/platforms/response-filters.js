/**
 * Platform-specific text response filters and cache isolation policies.
 */

const FLATHUB_REPO_BASE_URL_PATTERN = /https:\/\/(?:dl\.)?flathub\.org\/repo\//g;
const FLATPAK_REFERENCE_FILE_PATTERN = /\.(flatpakrepo|flatpakref)$/i;
const NPM_REGISTRY_ORIGIN = 'https://registry.npmjs.org/';

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
 * Rewrites npm tarball origins without buffering the full registry metadata.
 * @param {ReadableStream<Uint8Array>} body
 * @param {string} origin
 * @returns {ReadableStream<Uint8Array>} Stream with rewritten registry origins.
 */
export function rewriteNpmRegistryStream(body, origin) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const replacement = `${origin}/npm/`;
  let remainder = '';

  /**
   * Rewrites complete origins and retains only the suffix that can span chunks.
   * @param {string} text Decoded response text.
   * @param {{ enqueue: (chunk: Uint8Array) => void }} controller Stream controller.
   * @returns {void}
   */
  const emitRewritten = (text, controller) => {
    let cursor = 0;
    let matchIndex = text.indexOf(NPM_REGISTRY_ORIGIN, cursor);

    while (matchIndex !== -1) {
      controller.enqueue(encoder.encode(text.slice(cursor, matchIndex)));
      controller.enqueue(encoder.encode(replacement));
      cursor = matchIndex + NPM_REGISTRY_ORIGIN.length;
      matchIndex = text.indexOf(NPM_REGISTRY_ORIGIN, cursor);
    }

    const unmatched = text.slice(cursor);
    const emitLength = Math.max(0, unmatched.length - NPM_REGISTRY_ORIGIN.length + 1);
    if (emitLength) {
      controller.enqueue(encoder.encode(unmatched.slice(0, emitLength)));
    }
    remainder = unmatched.slice(emitLength);
  };

  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        emitRewritten(remainder + decoder.decode(chunk, { stream: true }), controller);
      },
      flush(controller) {
        const text = remainder + decoder.decode();
        controller.enqueue(encoder.encode(text.replaceAll(NPM_REGISTRY_ORIGIN, replacement)));
      }
    })
  );
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
