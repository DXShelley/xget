import { utcClock } from './config.js';
import { getBearerToken, parseContentLength, tokensMatch, validateObjectKey } from './security.js';

export { QuotaGate } from './quota-gate.js';

const MAX_OBJECT_BYTES = 20_000_000;
const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export default {
  /**
   * Handles a private screenshot API backed by R2.
   * @param {Request} request
   * @param {GatewayEnv} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    try {
      if (!(await isAuthorized(request, env))) {
        return json({ error: 'Unauthorized.' }, 401);
      }

      const url = new URL(request.url);
      if (url.pathname.startsWith('/v1/admin/')) {
        return handleAdmin(request, url, env);
      }
      if (!url.pathname.startsWith('/v1/objects/')) {
        return json({ error: 'Not found.' }, 404);
      }

      const key = url.pathname.slice('/v1/objects/'.length);
      const keyResult = validateObjectKey(key);
      if (!keyResult.valid) {
        return json({ error: keyResult.reason }, 400);
      }

      const clientKey = request.headers.get('CF-Access-Authenticated-User-Email') || 'api-token';
      const rateLimit = await env.REQUEST_RATE_LIMITER.limit({ key: clientKey });
      if (!rateLimit.success) {
        return json({ error: 'Rate limit exceeded.' }, 429);
      }

      if (request.method === 'PUT') {
        return putObject(request, env, key);
      }
      if (request.method === 'GET') {
        return getObject(env, key);
      }
      if (request.method === 'DELETE') {
        return deleteObject(env, key);
      }
      return json({ error: 'Method not allowed.' }, 405, { Allow: 'DELETE, GET, PUT' });
    } catch (error) {
      console.error('Quota gateway request failed:', error);
      return json({ error: 'Service temporarily unavailable.' }, 503, { 'Retry-After': '86400' });
    }
  },

  /** Runs from the configured hourly cron; never from the public request path. */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(reconcileQuota(env));
  }
};

/** @param {GatewayEnv} env */
export async function reconcileQuota(env) {
  const id = env.QUOTA_GATE.idFromName(env.QUOTA_GATE_NAME || 'global');
  return env.QUOTA_GATE.get(id).fetch('https://quota-gate/reconcile', { method: 'POST' });
}

/**
 * @param {Request} request
 * @param {GatewayEnv} env
 * @param {string} key
 * @returns {Promise<Response>}
 */
async function putObject(request, env, key) {
  const contentLength = parseContentLength(request.headers.get('Content-Length'), MAX_OBJECT_BYTES);
  if (!contentLength.valid) {
    return json({ error: contentLength.reason }, 413);
  }
  const contentType = request.headers.get('Content-Type') || '';
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return json({ error: 'Unsupported content type.' }, 415);
  }

  const reservation = await reserve(env, [
    { amount: contentLength.value, resource: 'r2.storage.bytes' },
    { amount: 1, resource: 'r2.class_a' },
    { amount: 1, resource: 'worker.requests' }
  ]);
  if (!reservation.allowed) {
    return quotaDenied(reservation);
  }

  await env.SHOTS_BUCKET.put(key, request.body, { httpMetadata: { contentType } });
  return json({ key, stored: true }, 201);
}

/**
 * @param {GatewayEnv} env
 * @param {string} key
 * @returns {Promise<Response>}
 */
async function getObject(env, key) {
  const reservation = await reserve(env, [
    { amount: 1, resource: 'r2.class_b' },
    { amount: 1, resource: 'worker.requests' }
  ]);
  if (!reservation.allowed) {
    return quotaDenied(reservation);
  }

  const object = await env.SHOTS_BUCKET.get(key);
  if (!object) {
    return json({ error: 'Object not found.' }, 404);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
}

/**
 * @param {GatewayEnv} env
 * @param {string} key
 * @returns {Promise<Response>}
 */
async function deleteObject(env, key) {
  const reservation = await reserve(env, [
    { amount: 1, resource: 'r2.class_b' },
    { amount: 1, resource: 'worker.requests' }
  ]);
  if (!reservation.allowed) {
    return quotaDenied(reservation);
  }

  const object = await env.SHOTS_BUCKET.head(key);
  if (!object) {
    return json({ error: 'Object not found.' }, 404);
  }
  await env.SHOTS_BUCKET.delete(key);
  await quotaRequest(env, '/release-storage', { amount: object.size });
  return new Response(null, { status: 204 });
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {GatewayEnv} env
 * @returns {Promise<Response>}
 */
async function handleAdmin(request, url, env) {
  if (request.method === 'GET' && url.pathname === '/v1/admin/status') {
    const instance = quotaInstanceName(url.searchParams.get('instance') || env.QUOTA_GATE_NAME);
    if (!instance) {
      return json({ error: 'Invalid quota instance name.' }, 400);
    }
    return quotaRequest(env, '/status', undefined, instance);
  }
  if (request.method === 'POST' && url.pathname === '/v1/admin/kill-switch') {
    const body = await request.json();
    if (typeof body.enabled !== 'boolean') {
      return json({ error: 'enabled must be a boolean.' }, 400);
    }
    return quotaRequest(env, '/kill-switch', { enabled: body.enabled });
  }
  return json({ error: 'Not found.' }, 404);
}

/**
 * @param {GatewayEnv} env
 * @param {Array<{ resource: string, amount: number }>} deltas
 * @returns {Promise<{ allowed: boolean, status: number, reason?: string, resource?: string }>}
 */
async function reserve(env, deltas) {
  const clock = utcClock();
  const response = await quotaRequest(env, '/reserve', {
    day: clock.day,
    deltas,
    id: crypto.randomUUID(),
    period: clock.period,
    profile: env.QUOTA_PROFILE || 'default'
  });
  return response.json();
}

/**
 * @param {GatewayEnv} env
 * @param {string} path
 * @param {unknown} [body]
 * @returns {Promise<Response>}
 */
export async function quotaRequest(env, path, body, instance) {
  const id = env.QUOTA_GATE.idFromName(instance || env.QUOTA_GATE_NAME || 'global');
  const quotaGate = env.QUOTA_GATE.get(id);
  return quotaGate.fetch(`https://quota-gate${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    method: body === undefined ? 'GET' : 'POST'
  });
}

/**
 * Limits administrative instance selection to explicit Durable Object names.
 * @param {string | null} value
 * @returns {string | null}
 */
function quotaInstanceName(value) {
  const instance = value || 'global';
  return /^[A-Za-z0-9._-]{1,128}$/.test(instance) ? instance : null;
}

/**
 * @param {{ allowed: boolean, status: number, reason?: string, resource?: string }} reservation
 * @returns {Response}
 */
function quotaDenied(reservation) {
  return json(
    {
      error: 'Free quota is unavailable.',
      reason: reservation.reason || 'quota-gate-rejected',
      resource: reservation.resource || 'unknown'
    },
    reservation.status,
    { 'Retry-After': '86400' }
  );
}

/**
 * @param {Request} request
 * @param {GatewayEnv} env
 * @returns {Promise<boolean>}
 */
async function isAuthorized(request, env) {
  return tokensMatch(getBearerToken(request), env.QUOTA_GATEWAY_API_TOKEN);
}

/**
 * @param {unknown} value
 * @param {number} status
 * @param {Record<string, string>} [extraHeaders]
 * @returns {Response}
 */
function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
    status
  });
}

/**
 * @typedef {object} GatewayEnv
 * @property {{ idFromName(name: string): DurableObjectId, get(id: DurableObjectId): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } }} QUOTA_GATE
 * @property {{ limit(options: { key: string }): Promise<{ success: boolean }> }} REQUEST_RATE_LIMITER
 * @property {R2Bucket} SHOTS_BUCKET
 * @property {string} [QUOTA_GATE_NAME]
 * @property {string} [QUOTA_PROFILE]
 * @property {string} [CLOUDFLARE_ACCOUNT_ID]
 * @property {string} [CLOUDFLARE_ANALYTICS_API_TOKEN]
 * @property {string} [R2_BUCKET_NAME]
 * @property {string} QUOTA_GATEWAY_API_TOKEN
 */
