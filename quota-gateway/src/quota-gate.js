import { loadPolicy, utcClock } from './config.js';
import { fetchCloudflareUsage } from './cloudflare-analytics.js';
import {
  createState,
  recordReconciliationFailure,
  releaseReservation,
  reconcileUsage,
  releaseStorage,
  reserve,
  setKillSwitch
} from './quota-engine.js';

/**
 * Globally serializes quota reservations before the gateway reaches a metered binding.
 */
export class QuotaGate {
  /**
   * @param {DurableObjectState} ctx
   * @param {Record<string, string>} env
   */
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  /**
   * Handles private requests issued only through the QUOTA_GATE service binding.
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/reserve') {
        const reservation = await request.json();
        const result = await this.update(
          async state => reserve(state, reservation),
          quotaProfile(reservation)
        );
        return json(result, result.status);
      }

      if (request.method === 'POST' && url.pathname === '/release-storage') {
        const body = await request.json();
        if (!Number.isSafeInteger(body.amount) || body.amount <= 0) {
          return json({ error: 'amount must be a positive integer.' }, 400);
        }
        const state = await this.update(async current => ({
          allowed: true,
          state: releaseStorage(current, body.amount),
          status: 200
        }));
        return json({ usage: state.state.usage }, 200);
      }

      if (request.method === 'POST' && url.pathname === '/release') {
        const body = await request.json();
        if (typeof body.id !== 'string' || !body.id) {
          return json({ error: 'id is required.' }, 400);
        }
        const state = await this.update(async current => ({
          allowed: true,
          state: releaseReservation(current, body.id),
          status: 200
        }));
        return json({ usage: state.state.usage }, 200);
      }

      if (request.method === 'POST' && url.pathname === '/kill-switch') {
        const body = await request.json();
        if (typeof body.enabled !== 'boolean') {
          return json({ error: 'enabled must be a boolean.' }, 400);
        }
        const result = await this.update(async state => ({
          allowed: true,
          state: setKillSwitch(state, body.enabled),
          status: 200
        }));
        return json({ killSwitch: result.state.killSwitch }, 200);
      }

      if (request.method === 'POST' && url.pathname === '/reconcile') {
        return this.reconcile();
      }

      if (request.method === 'GET' && url.pathname === '/status') {
        const state = await this.getState();
        return json({
          day: state.day,
          killSwitch: state.killSwitch,
          period: state.period,
          platformExceeded: state.platformExceeded || [],
          reconciliation: state.reconciliation || null,
          usage: state.usage
        });
      }

      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      console.error('Quota gate error:', error);
      return json({ error: 'Quota gate rejected the request.' }, 503);
    }
  }

  /**
   * @returns {Promise<import('./quota-engine.js').QuotaState>}
   */
  async getState(profile = this.env.QUOTA_PROFILE || 'default') {
    const policy = loadPolicy(this.env.FREE_ONLY_POLICIES || this.env.FREE_ONLY_POLICY, profile);
    const clock = utcClock();
    const stored = await this.ctx.storage.get('state');
    // Preserve accumulated usage while making policy-only deployments take effect immediately.
    return stored
      ? {
          platformExceeded: [],
          reconciliation: {
            lastAttemptHour: null,
            lastAttemptAt: null,
            lastSuccessAt: null,
            source: 'local'
          },
          ...stored,
          policy
        }
      : createState(policy, clock.period, clock.day);
  }

  /** Performs at most one delayed platform-usage reconciliation per UTC hour. */
  async reconcile() {
    const now = new Date();
    const clock = utcClock(now);
    const hour = now.toISOString().slice(0, 13);
    const attemptedAt = now.toISOString();
    const state = await this.getState();
    if (state.reconciliation?.lastAttemptHour === hour) {
      return json({ attempted: false, reconciliation: state.reconciliation }, 200);
    }

    try {
      const actualUsage = await fetchCloudflareUsage(this.env, now);
      const reconciled = reconcileUsage(state, actualUsage, { ...clock, attemptedAt, hour });
      await this.ctx.storage.put('state', reconciled);
      return json(
        {
          attempted: true,
          platformExceeded: reconciled.platformExceeded,
          reconciliation: reconciled.reconciliation
        },
        200
      );
    } catch (error) {
      const failed = recordReconciliationFailure(state, {
        attemptedAt,
        error: error instanceof Error ? error.message : 'Unknown Cloudflare Analytics error.',
        hour
      });
      await this.ctx.storage.put('state', failed);
      return json({ attempted: true, reconciliation: failed.reconciliation }, 200);
    }
  }

  /**
   * Persists a state transition in the Durable Object's serialized event handler.
   * @param {(state: import('./quota-engine.js').QuotaState) => Promise<{ state: import('./quota-engine.js').QuotaState, status: number, allowed: boolean, reason?: string }>} mutate
   * @returns {Promise<{ state: import('./quota-engine.js').QuotaState, status: number, allowed: boolean, reason?: string }>}
   */
  async update(mutate, profile) {
    const result = await mutate(await this.getState(profile));
    await this.ctx.storage.put('state', result.state);
    return result;
  }
}

/**
 * @param {unknown} reservation
 * @returns {string}
 */
function quotaProfile(reservation) {
  const profile =
    reservation !== null && typeof reservation === 'object'
      ? /** @type {{ profile?: unknown }} */ (reservation).profile
      : undefined;
  return typeof profile === 'string' && profile ? profile : 'default';
}

/**
 * @param {unknown} value
 * @param {number} [status]
 * @returns {Response}
 */
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    status
  });
}
