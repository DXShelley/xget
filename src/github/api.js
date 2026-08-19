import { createErrorResponse } from '../utils/security.js';

const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_API_ORIGIN = 'https://api.github.com';
const GITHUB_API_USER_AGENT = 'xget-github-readonly-proxy';
const installationTokenCache = new Map();

/**
 * Encodes bytes for use in a JWT segment.
 * @param {Uint8Array} bytes
 * @returns {string} Base64url-encoded bytes.
 */
function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Encodes a JSON value as a JWT segment.
 * @param {Record<string, unknown>} value
 * @returns {string} Base64url-encoded JSON.
 */
function encodeJwtJson(value) {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * Encodes a DER length value.
 * @param {number} length
 * @returns {Uint8Array} DER length bytes.
 */
function encodeDerLength(length) {
  if (length < 128) {
    return new Uint8Array([length]);
  }

  const bytes = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }

  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

/**
 * Concatenates DER fragments.
 * @param {...Uint8Array} fragments
 * @returns {Uint8Array} Concatenated bytes.
 */
function concatDerFragments(...fragments) {
  const result = new Uint8Array(fragments.reduce((total, fragment) => total + fragment.length, 0));
  let offset = 0;
  for (const fragment of fragments) {
    result.set(fragment, offset);
    offset += fragment.length;
  }

  return result;
}

/**
 * Decodes a PEM private key and wraps GitHub's PKCS#1 RSA format as PKCS#8.
 * @param {string} pem
 * @returns {ArrayBuffer} DER key bytes.
 */
function decodePrivateKey(pem) {
  const normalized = pem.replace(/\\n/g, '\n');
  const match = normalized.match(/-----BEGIN ([^-]+)-----([\s\S]*?)-----END \1-----/);
  if (!match) {
    throw new Error('Unsupported GitHub App private key format');
  }

  const [, keyType, encodedKey] = match;
  const base64 = encodedKey.replace(/\s/g, '');
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  if (keyType === 'PRIVATE KEY') {
    return bytes.buffer;
  }
  if (keyType !== 'RSA PRIVATE KEY') {
    throw new Error('Unsupported GitHub App private key format');
  }

  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const algorithmIdentifier = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00
  ]);
  const privateKeyOctetString = concatDerFragments(
    new Uint8Array([0x04]),
    encodeDerLength(bytes.length),
    bytes
  );
  const privateKeyInfo = concatDerFragments(version, algorithmIdentifier, privateKeyOctetString);

  const wrappedKey = concatDerFragments(
    new Uint8Array([0x30]),
    encodeDerLength(privateKeyInfo.length),
    privateKeyInfo
  );
  return /** @type {ArrayBuffer} */ (wrappedKey.buffer);
}

/**
 * Reads complete GitHub App credentials from Worker secrets.
 * @param {Record<string, unknown>} env
 * @returns {{ appId: string, installationId: string, privateKey: string } | null} Credentials or null when incomplete.
 */
function getGithubAppCredentials(env) {
  const appId = typeof env.GITHUB_APP_ID === 'string' ? env.GITHUB_APP_ID.trim() : '';
  const installationId =
    typeof env.GITHUB_APP_INSTALLATION_ID === 'string' ? env.GITHUB_APP_INSTALLATION_ID.trim() : '';
  const privateKey =
    typeof env.GITHUB_APP_PRIVATE_KEY === 'string' ? env.GITHUB_APP_PRIVATE_KEY.trim() : '';

  return appId && installationId && privateKey ? { appId, installationId, privateKey } : null;
}

/**
 * Creates a short-lived GitHub App JWT.
 * @param {{ appId: string, privateKey: string }} credentials
 * @returns {Promise<string>} Signed App JWT.
 */
async function createGithubAppJwt({ appId, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJwtJson({ alg: 'RS256', typ: 'JWT' });
  const payload = encodeJwtJson({ iat: now - 60, exp: now + 540, iss: appId });
  const unsignedToken = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    decodePrivateKey(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedToken)
  );

  return `${unsignedToken}.${encodeBase64Url(new Uint8Array(signature))}`;
}

/**
 * Gets an installation token, reusing it within the Worker isolate until it is close to expiry.
 * @param {Record<string, unknown>} env
 * @param {number} timeoutSeconds
 * @returns {Promise<string | null>} Installation token or null when App auth is unavailable.
 */
async function getGithubInstallationToken(env, timeoutSeconds) {
  const credentials = getGithubAppCredentials(env);
  if (!credentials) {
    return null;
  }

  const cacheKey = `${credentials.appId}:${credentials.installationId}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = installationTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > now + 60) {
    return cached.token;
  }

  let timeoutId;
  try {
    const jwt = await createGithubAppJwt(credentials);
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    /** @type {RequestInit & { cf?: Record<string, unknown> }} */
    const tokenFetchOptions = {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': GITHUB_API_USER_AGENT,
        'Content-Type': 'application/json'
      },
      body: '{}',
      redirect: 'manual',
      signal: controller.signal,
      cf: { cacheEverything: false }
    };
    const response = await fetch(
      `${GITHUB_API_ORIGIN}/app/installations/${encodeURIComponent(credentials.installationId)}/access_tokens`,
      tokenFetchOptions
    );

    if (!response.ok) {
      return null;
    }

    const payload = /** @type {{ token?: unknown, expires_at?: unknown }} */ (
      await response.json()
    );
    if (typeof payload.token !== 'string' || !payload.token) {
      return null;
    }

    const expiresAt =
      typeof payload.expires_at === 'string'
        ? Math.floor(Date.parse(payload.expires_at) / 1000)
        : now + 3600;
    installationTokenCache.set(cacheKey, {
      token: payload.token,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : now + 3600
    });
    return payload.token;
  } catch {
    return null;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Clears the in-memory App token cache for tests and controlled runtime resets.
 */
export function clearGithubApiTokenCache() {
  installationTokenCache.clear();
}

/**
 * Builds an API cache key that never contains a user Cookie or App token.
 * @param {string} targetUrl
 * @returns {string} Stable internal cache key.
 */
function getGithubApiCacheKey(targetUrl) {
  const cacheKey = new URL(targetUrl);
  cacheKey.searchParams.set('__xget_github_api', '1');
  return cacheKey.toString();
}

/**
 * Checks whether a GitHub response represents an API rate limit.
 * @param {Response} response
 * @returns {boolean} True when retrying with another identity would amplify the limit.
 */
function isGithubRateLimited(response) {
  return response.status === 429 || response.headers.get('X-RateLimit-Remaining') === '0';
}

/**
 * Fetches a read-only GitHub REST API resource using App auth when configured.
 * @param {{ request: Request, targetUrl: string, config: { MAX_RETRIES: number, RETRY_DELAY_MS: number, TIMEOUT_SECONDS: number, GITHUB_API_CACHE_DURATION?: number }, env?: Record<string, unknown> }} options
 * @returns {Promise<{ response: Response, responseGeneratedLocally: boolean }>} Upstream result.
 */
export async function fetchGithubApi({ request, targetUrl, config, env = {} }) {
  const timeoutSeconds = Number(config.TIMEOUT_SECONDS) || 30;
  const configuredCacheDuration = Number(config.GITHUB_API_CACHE_DURATION);
  const cacheDuration = Number.isFinite(configuredCacheDuration)
    ? Math.max(0, configuredCacheDuration)
    : 60;
  let token = await getGithubInstallationToken(env, timeoutSeconds);
  const baseHeaders = new Headers({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': GITHUB_API_USER_AGENT
  });

  const maxRetries = Math.max(1, Number(config.MAX_RETRIES) || 1);
  let usedAnonymousFallback = !token;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let timeoutId;

    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
      const canUseCache = request.method === 'GET';
      const headers = new Headers(baseHeaders);
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      /** @type {RequestInit & { cf?: Record<string, unknown> }} */
      const fetchOptions = {
        method: request.method,
        headers,
        redirect: 'manual',
        signal: controller.signal,
        cf: {
          http3: true,
          cacheEverything: canUseCache,
          cacheTtl: canUseCache ? cacheDuration : 0,
          cacheTtlByStatus: {
            '200-299': cacheDuration,
            '300-399': 0,
            '400-599': 0
          },
          ...(canUseCache ? { cacheKey: getGithubApiCacheKey(targetUrl) } : {}),
          preconnect: true
        }
      };
      const response = await fetch(targetUrl, fetchOptions);

      if (
        token &&
        !usedAnonymousFallback &&
        !isGithubRateLimited(response) &&
        (response.status === 401 || response.status === 403 || response.status === 404)
      ) {
        token = null;
        usedAnonymousFallback = true;
        attempt = -1;
        continue;
      }

      if (response.status < 500 || attempt === maxRetries - 1) {
        return { response, responseGeneratedLocally: false };
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          response: createErrorResponse('Request timeout', 408),
          responseGeneratedLocally: true
        };
      }

      if (attempt === maxRetries - 1) {
        return {
          response: createErrorResponse('Upstream request failed', 502),
          responseGeneratedLocally: true
        };
      }
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }

    if (attempt < maxRetries - 1 && Number(config.RETRY_DELAY_MS) > 0) {
      await new Promise(resolve =>
        setTimeout(resolve, Number(config.RETRY_DELAY_MS) * (attempt + 1))
      );
    }
  }

  return {
    response: createErrorResponse('Upstream request failed', 502),
    responseGeneratedLocally: true
  };
}
