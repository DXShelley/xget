/**
 * Creates persistent quota state for one global admission gate.
 * @param {{ resources: Record<string, { scope: 'current' | 'daily' | 'monthly', limit: number }> }} policy
 * @param {string} period
 * @param {string} day
 * @returns {QuotaState}
 */
export function createState(policy, period, day) {
  return {
    day,
    killSwitch: false,
    period,
    platformExceeded: [],
    policy,
    reconciliation: {
      lastAttemptHour: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      source: 'local'
    },
    reservations: {},
    usage: { current: {}, daily: {}, monthly: {} },
    version: 1
  };
}

/**
 * Reserves a resource vector without mutating the supplied state.
 * @param {QuotaState} previousState
 * @param {{ id: string, period: string, day: string, deltas: Array<{ resource: string, amount: number }> }} request
 * @returns {{ allowed: boolean, status: number, reason?: string, state: QuotaState }}
 */
export function reserve(previousState, request) {
  const state = rollover(previousState, request.period, request.day);

  if (state.killSwitch) {
    return denied(state, 503, 'kill-switch-enabled');
  }

  if (state.platformExceeded.length > 0) {
    return denied(state, 429, 'platform-quota-exhausted', state.platformExceeded[0]);
  }

  if (!isReservationRequest(request)) {
    return denied(state, 400, 'invalid-reservation');
  }

  if (state.reservations[request.id]) {
    return { allowed: true, state, status: 200 };
  }

  const deltas = aggregateDeltas(request.deltas);
  for (const delta of deltas) {
    const rule = state.policy.resources[delta.resource];
    if (!rule) {
      return denied(state, 503, 'unknown-resource', delta.resource);
    }

    const used = state.usage[rule.scope][delta.resource] || 0;
    if (used + delta.amount > rule.limit) {
      return denied(state, 429, 'quota-exhausted', delta.resource);
    }
  }

  const nextState = structuredClone(state);
  for (const delta of deltas) {
    const rule = nextState.policy.resources[delta.resource];
    const usage = nextState.usage[rule.scope];
    usage[delta.resource] = (usage[delta.resource] || 0) + delta.amount;
  }
  nextState.reservations[request.id] = {
    createdAt: new Date().toISOString(),
    deltas
  };

  return { allowed: true, state: nextState, status: 201 };
}

/**
 * Releases storage only after an R2 delete has completed successfully.
 * @param {QuotaState} previousState
 * @param {number} amount
 * @returns {QuotaState}
 */
export function releaseStorage(previousState, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('Storage release amount must be a positive integer.');
  }

  const state = structuredClone(previousState);
  const resource = 'r2.storage.bytes';
  const used = state.usage.current[resource] || 0;
  state.usage.current[resource] = Math.max(0, used - amount);
  return state;
}

/**
 * Updates the explicit account-wide emergency stop.
 * @param {QuotaState} previousState
 * @param {boolean} enabled
 * @returns {QuotaState}
 */
export function setKillSwitch(previousState, enabled) {
  const state = structuredClone(previousState);
  state.killSwitch = Boolean(enabled);
  return state;
}

/**
 * Replaces tracked resources with Cloudflare's delayed account-level aggregates.
 * A successful under-limit sample clears the platform block; a failed sample must not.
 * @param {QuotaState} previousState
 * @param {Record<string, number>} actualUsage
 * @param {{ day: string, period: string, attemptedAt: string, hour: string }} clock
 * @returns {QuotaState}
 */
export function reconcileUsage(previousState, actualUsage, clock) {
  const state = rollover(previousState, clock.period, clock.day);
  const nextState = structuredClone(state);
  for (const [resource, amount] of Object.entries(actualUsage)) {
    const rule = nextState.policy.resources[resource];
    if (!rule || !Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(`Invalid reconciled usage for ${resource}.`);
    }
    nextState.usage[rule.scope][resource] = amount;
  }
  nextState.platformExceeded = Object.entries(nextState.policy.resources)
    .filter(([resource, rule]) => (nextState.usage[rule.scope][resource] || 0) > rule.limit)
    .map(([resource]) => resource);
  nextState.reconciliation = {
    error: undefined,
    lastAttemptAt: clock.attemptedAt,
    lastAttemptHour: clock.hour,
    lastSuccessAt: clock.attemptedAt,
    source: 'cloudflare-graphql'
  };
  return nextState;
}

/**
 * Records a failed reconciliation without weakening the current local or platform blocks.
 * @param {QuotaState} previousState
 * @param {{ attemptedAt: string, error: string, hour: string }} details
 * @returns {QuotaState}
 */
export function recordReconciliationFailure(previousState, details) {
  const state = structuredClone(previousState);
  state.reconciliation = {
    ...state.reconciliation,
    error: details.error,
    lastAttemptAt: details.attemptedAt,
    lastAttemptHour: details.hour,
    source: 'local'
  };
  return state;
}

/**
 * Moves daily and monthly counters to the requested clock period.
 * Current storage remains reserved until a confirmed deletion releases it.
 * @param {QuotaState} previousState
 * @param {string} period
 * @param {string} day
 * @returns {QuotaState}
 */
function rollover(previousState, period, day) {
  const state = structuredClone(previousState);
  state.platformExceeded ||= [];
  state.reconciliation ||= {
    lastAttemptHour: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    source: 'local'
  };
  if (state.period !== period) {
    state.period = period;
    state.usage.monthly = {};
    state.reservations = {};
  }
  if (state.day !== day) {
    state.day = day;
    state.usage.daily = {};
  }
  return state;
}

/**
 * Aggregates repeated resources so validation evaluates the full request vector.
 * @param {Array<{ resource: string, amount: number }>} deltas
 * @returns {Array<{ resource: string, amount: number }>}
 */
function aggregateDeltas(deltas) {
  const totals = new Map();
  for (const delta of deltas) {
    totals.set(delta.resource, (totals.get(delta.resource) || 0) + delta.amount);
  }
  return [...totals].map(([resource, amount]) => ({ amount, resource }));
}

/**
 * Validates a positive, known resource vector before it reaches a service binding.
 * @param {unknown} request
 * @returns {request is { id: string, period: string, day: string, deltas: Array<{ resource: string, amount: number }> }}
 */
function isReservationRequest(request) {
  if (!request || typeof request !== 'object') {
    return false;
  }
  const candidate =
    /** @type {{ id?: unknown, period?: unknown, day?: unknown, deltas?: unknown }} */ (request);
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.period === 'string' &&
    typeof candidate.day === 'string' &&
    Array.isArray(candidate.deltas) &&
    candidate.deltas.length > 0 &&
    candidate.deltas.every(
      delta =>
        delta &&
        typeof delta.resource === 'string' &&
        Number.isSafeInteger(delta.amount) &&
        delta.amount > 0
    )
  );
}

/**
 * @param {QuotaState} state
 * @param {number} status
 * @param {string} reason
 * @param {string} [resource]
 * @returns {{ allowed: false, status: number, reason: string, resource?: string, state: QuotaState }}
 */
function denied(state, status, reason, resource) {
  return { allowed: false, reason, resource, state, status };
}

/**
 * @typedef {object} QuotaState
 * @property {string} day
 * @property {boolean} killSwitch
 * @property {string} period
 * @property {string[]} platformExceeded
 * @property {{ resources: Record<string, { scope: 'current' | 'daily' | 'monthly', limit: number }> }} policy
 * @property {{ error?: string, lastAttemptAt: string | null, lastAttemptHour: string | null, lastSuccessAt: string | null, source: 'cloudflare-graphql' | 'local' }} reconciliation
 * @property {Record<string, { createdAt: string, deltas: Array<{ resource: string, amount: number }> }>} reservations
 * @property {{ current: Record<string, number>, daily: Record<string, number>, monthly: Record<string, number> }} usage
 * @property {number} version
 */
