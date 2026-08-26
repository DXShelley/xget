const SESSION_COOKIE = '__Host-xget_session';
const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;
const encoder = new TextEncoder();

/** Handles browser login endpoints. @param {Request} request @param {Record<string, unknown>} env @returns {Promise<Response | null>} */
export async function handleBrowserAuth(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/__xget/auth/login') {
    if (request.method === 'GET') return loginPage();
    if (request.method === 'POST') return login(request, env);
    return new Response('Method not allowed', { status: 405 });
  }
  if (url.pathname === '/__xget/auth/logout' && request.method === 'POST') {
    return new Response(null, {
      headers: { 'Set-Cookie': clearSessionCookie(), Location: '/__xget/auth/login' },
      status: 303
    });
  }
  if (url.pathname === '/__xget/auth/session' && request.method === 'GET') {
    const principal = await validateBrowserSession(request, env);
    return json(principal ? { authenticated: true, principal } : { authenticated: false });
  }
  if (url.pathname === '/__xget/auth/git-token' && request.method === 'POST') {
    const principal = await validateBrowserSession(request, env);
    if (!principal) return new Response('Authentication required', { status: 401 });
    return issueScopedToken(env, principal.id, ['git:read', 'docker:pull'], SESSION_TTL_SECONDS);
  }
  return null;
}

/** Validates the xget browser session. @param {Request} request @param {Record<string, unknown>} env @returns {Promise<{id: string, authMethod: string, expiresAt: string} | null>} */
export async function validateBrowserSession(request, env) {
  if (!isAuthRequired(env)) return { authMethod: 'compatibility', expiresAt: '', id: 'anonymous' };
  const secret = getSecret(env);
  const value = getCookie(request.headers.get('Cookie'), SESSION_COOKIE);
  if (!secret || !value) return null;
  const [payload, suppliedSignature] = value.split('.');
  if (!payload || !suppliedSignature) return null;
  const expectedSignature = await sign(payload, secret);
  if (!(await constantTimeEqual(suppliedSignature, expectedSignature))) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (claims.exp <= Math.floor(Date.now() / 1000) || typeof claims.sub !== 'string') return null;
    return {
      authMethod: 'browser-session',
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      id: claims.sub
    };
  } catch {
    return null;
  }
}

/** Validates the Basic credential used by Git Smart HTTP. @param {Request} request @param {Record<string, unknown>} env @returns {Promise<{id: string, authMethod: string, expiresAt: string} | null>} */
export async function validateGitCredential(request, env) {
  if (String(env.XGET_AUTH_REQUIRED || '').toLowerCase() !== 'true') {
    return { authMethod: 'compatibility', expiresAt: '', id: 'anonymous' };
  }
  const value = request.headers.get('Authorization') || '';
  if (!value.startsWith('Basic ')) return null;
  try {
    const decoded = new TextDecoder().decode(fromBase64Url(value.slice(6).replace(/=/g, '')));
    const separator = decoded.indexOf(':');
    const username = separator >= 0 ? decoded.slice(0, separator) : '';
    const password = separator >= 0 ? decoded.slice(separator + 1) : '';
    if (!username || !password) return null;
    const claims = await validateScopedToken(password, env, 'git:read');
    if (claims) {
      return {
        authMethod: 'git-basic',
        expiresAt: new Date(claims.exp * 1000).toISOString(),
        id: `git:${claims.sub}`
      };
    }
    // Keep the first-use flow simple for small private deployments. Operators
    // should prefer the signed token returned by /__xget/auth/git-token.
    const loginSecret = typeof env.XGET_LOGIN_SECRET === 'string' ? env.XGET_LOGIN_SECRET : '';
    if (loginSecret && (await constantTimeEqual(password, loginSecret))) {
      return { authMethod: 'git-basic', expiresAt: '', id: `git:${username}` };
    }
    return null;
  } catch {
    return null;
  }
}

/** Issues a signed scoped credential. @param {Record<string, unknown>} env @param {string} subject @param {string[]} scopes @param {number} ttlSeconds @returns {Promise<Response>} */
export async function issueScopedToken(env, subject, scopes, ttlSeconds) {
  const secret = getSecret(env);
  if (!secret) return new Response('Authentication service unavailable', { status: 503 });
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = toBase64Url(encoder.encode(JSON.stringify({ exp, scopes, sub: subject })));
  const token = `${payload}.${await sign(payload, secret)}`;
  return json({ expiresAt: new Date(exp * 1000).toISOString(), token });
}

/** Validates a signed scoped credential. @param {string} value @param {Record<string, unknown>} env @param {string} scope @returns {Promise<{sub: string, exp: number} | null>} */
export async function validateScopedToken(value, env, scope) {
  const [payload, suppliedSignature] = value.split('.');
  if (
    !payload ||
    !suppliedSignature ||
    !(await constantTimeEqual(suppliedSignature, await sign(payload, getSecret(env))))
  )
    return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (
      claims.exp <= Math.floor(Date.now() / 1000) ||
      !claims.scopes?.includes(scope) ||
      typeof claims.sub !== 'string'
    )
      return null;
    return claims;
  } catch {
    return null;
  }
}

/** Validates a Docker Registry Bearer credential. @param {Request} request @param {Record<string, unknown>} env @returns {Promise<{id: string, authMethod: string, expiresAt: string} | null>} */
export async function validateDockerCredential(request, env) {
  const value = request.headers.get('Authorization') || '';
  let token = '';
  if (value.startsWith('Bearer ')) token = value.slice(7);
  if (value.startsWith('Basic ')) {
    try {
      const decoded = atob(value.slice(6));
      token = decoded.slice(decoded.indexOf(':') + 1);
    } catch {
      return null;
    }
  }
  if (!token) return null;
  const claims = await validateScopedToken(token, env, 'docker:pull');
  return claims
    ? {
        authMethod: 'docker-bearer',
        expiresAt: new Date(claims.exp * 1000).toISOString(),
        id: `docker:${claims.sub}`
      }
    : null;
}

/** Creates the Git Smart HTTP challenge. @returns {Response} */
export function gitAuthenticationChallenge() {
  return new Response('Git authentication required', {
    headers: { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Basic realm="xget git"' },
    status: 401
  });
}

/** @param {Request} request @param {Record<string, unknown>} env @returns {Promise<Response>} */
async function login(request, env) {
  const sessionSecret = getSecret(env);
  const supplied = await readLoginSecret(request);
  const loginSecret = typeof env.XGET_LOGIN_SECRET === 'string' ? env.XGET_LOGIN_SECRET : '';
  if (!sessionSecret || !loginSecret || !(await constantTimeEqual(supplied, loginSecret))) {
    return loginPage('Invalid credentials', 401);
  }
  const now = Math.floor(Date.now() / 1000);
  const claims = { exp: now + SESSION_TTL_SECONDS, iat: now, sub: 'browser-user' };
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const value = `${payload}.${await sign(payload, sessionSecret)}`;
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get('return_to'));
  return new Response(null, {
    headers: {
      'Cache-Control': 'no-store',
      Location: returnTo,
      'Set-Cookie': `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`
    },
    status: 303
  });
}

/** @param {Request} request @returns {Promise<string>} */
async function readLoginSecret(request) {
  if ((request.headers.get('Content-Type') || '').includes('application/json')) {
    const body = await request.json();
    return typeof body?.secret === 'string' ? body.secret : '';
  }
  const form = await request.formData();
  const value = form.get('secret');
  return typeof value === 'string' ? value : '';
}

/** @param {Record<string, unknown>} env @returns {boolean} */
function isAuthRequired(env) {
  return String(env.XGET_AUTH_REQUIRED || '').toLowerCase() === 'true';
}

/** @param {Record<string, unknown>} env @returns {string} */
function getSecret(env) {
  return typeof env.XGET_SESSION_SECRET === 'string' ? env.XGET_SESSION_SECRET : '';
}

/** @param {string} value @param {string} secret @returns {Promise<string>} */
async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

/** @param {string} left @param {string} right @returns {Promise<boolean>} */
async function constantTimeEqual(left, right) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right))
  ]);
  const first = new Uint8Array(a);
  const second = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) difference |= first[index] ^ second[index];
  return difference === 0;
}

/** @param {string | null} header @param {string} name @returns {string} */
function getCookie(header, name) {
  return (
    (header || '')
      .split(/;\s*/)
      .find(value => value.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ''
  );
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/** @param {string | null} value @returns {string} */
function safeReturnTo(value) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

/** @param {string} [message] @param {number} [status] @returns {Response} */
function loginPage(message = '', status = 200) {
  const text = message ? `<p role="alert">${message}</p>` : '';
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>xget login</title><h1>xget login</h1>${text}<form method="post"><label>Access secret <input name="secret" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form>`,
    {
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' },
      status
    }
  );
}

/** @param {unknown} value @returns {Response} */
function json(value) {
  return new Response(JSON.stringify(value), {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }
  });
}

/** @param {Uint8Array} bytes @returns {string} */
function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** @param {string} value @returns {Uint8Array} */
function fromBase64Url(value) {
  const padded =
    value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
