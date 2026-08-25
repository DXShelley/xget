const MAX_OBJECT_KEY_LENGTH = 512;

/**
 * Validates a decoded R2 key before it reaches the storage binding.
 * @param {string} rawKey
 * @returns {{ valid: true } | { valid: false, reason: string }}
 */
export function validateObjectKey(rawKey) {
  let key;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    return { reason: 'Object key is not valid percent-encoding.', valid: false };
  }

  if (
    !key ||
    key.length > MAX_OBJECT_KEY_LENGTH ||
    key.startsWith('/') ||
    key.includes('..') ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key)
  ) {
    return { reason: 'Object key is invalid.', valid: false };
  }

  return { valid: true };
}

/**
 * Requires an exact byte count so an upload can be reserved before it is streamed.
 * @param {string | null} header
 * @param {number} maximum
 * @returns {{ valid: true, value: number } | { valid: false, reason: string }}
 */
export function parseContentLength(header, maximum) {
  if (!header || !/^\d+$/.test(header)) {
    return { reason: 'Content-Length is required.', valid: false };
  }

  const value = Number(header);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    return { reason: `Content-Length must be between 1 and ${maximum}.`, valid: false };
  }

  return { valid: true, value };
}

/**
 * Compares bearer tokens without exposing individual character matches.
 * @param {string} supplied
 * @param {string | undefined} expected
 * @returns {Promise<boolean>}
 */
export async function tokensMatch(supplied, expected) {
  if (!expected || !supplied) {
    return false;
  }

  const encoder = new TextEncoder();
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected))
  ]);
  const suppliedBytes = new Uint8Array(suppliedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < suppliedBytes.length; index += 1) {
    difference |= suppliedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

/**
 * Extracts a bearer token from an Authorization header.
 * @param {Request} request
 * @returns {string}
 */
export function getBearerToken(request) {
  const value = request.headers.get('Authorization') || '';
  return value.startsWith('Bearer ') ? value.slice('Bearer '.length) : '';
}
