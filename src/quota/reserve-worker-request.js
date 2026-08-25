/**
 * Reserves one Cloudflare Worker request from the shared quota gate.
 * A missing binding is the intentional compatibility path for non-Cloudflare runtimes.
 * @param {Record<string, unknown>} env
 * @param {Date} [now]
 * @returns {Promise<Response | null>} A terminal response, or null when processing can continue.
 */
export async function reserveWorkerRequest(env, now = new Date()) {
  if (quotaEnforcementMode(env?.QUOTA_ENFORCEMENT_MODE) !== 'request') {
    return null;
  }
  const quotaGate = env?.QUOTA_GATE;
  if (!quotaGate || typeof quotaGate !== 'object') {
    return null;
  }

  try {
    const binding =
      /** @type {{ idFromName: (name: string) => unknown, get: (id: unknown) => { fetch: (input: string, init: RequestInit) => Promise<Response> } }} */ (
        quotaGate
      );
    const id = binding.idFromName(quotaGateName(env.QUOTA_GATE_NAME));
    const stub = binding.get(id);
    const response = await stub.fetch('https://quota-gate/reserve', {
      body: JSON.stringify({
        day: now.toISOString().slice(0, 10),
        deltas: [{ amount: 1, resource: 'worker.requests' }],
        id: crypto.randomUUID(),
        period: now.toISOString().slice(0, 7),
        profile: quotaProfile(env.QUOTA_PROFILE)
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    });
    const result = await response.json();

    if (isQuotaExhausted(response, result)) {
      return quotaExhaustedResponse(response.headers.get('Retry-After'), quotaResource(result));
    }

    return response.ok && isAllowedReservation(result) ? null : quotaUnavailableResponse();
  } catch (error) {
    console.error('Quota reservation failed:', error);
    return quotaUnavailableResponse();
  }
}

/**
 * Defaults to hourly reconciliation to avoid a Durable Object round trip on every proxy request.
 * @param {unknown} value
 * @returns {'hourly' | 'request'}
 */
function quotaEnforcementMode(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'request'
    ? 'request'
    : 'hourly';
}

/**
 * Selects the Durable Object instance while preserving the original global default.
 * @param {unknown} value - Optional binding variable value.
 * @returns {string} A non-empty Durable Object instance name.
 */
function quotaGateName(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'global';
}

/**
 * @param {unknown} value - Optional quota profile binding value.
 * @returns {string} A non-empty quota profile name.
 */
function quotaProfile(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

/**
 * Determines whether a rejection represents an exhausted request budget.
 * @param {Response} response - Durable Object response.
 * @param {unknown} result - Parsed response body.
 * @returns {boolean} Whether the response is a quota denial.
 */
function isQuotaExhausted(response, result) {
  return (
    (response.status === 429 || getReservationStatus(result) === 429) &&
    result !== null &&
    typeof result === 'object' &&
    /** @type {{ allowed?: unknown }} */ (result).allowed === false
  );
}

/**
 * Determines whether the Durable Object accepted the reservation.
 * @param {unknown} result - Parsed response body.
 * @returns {boolean} Whether the response is an accepted reservation.
 */
function isAllowedReservation(result) {
  return (
    result !== null &&
    typeof result === 'object' &&
    /** @type {{ allowed?: unknown }} */ (result).allowed === true
  );
}

/**
 * Reads the status field from the Durable Object response body.
 * @param {unknown} result - Parsed response body.
 * @returns {number | null} A valid numeric status, when present.
 */
function getReservationStatus(result) {
  const status =
    result !== null && typeof result === 'object'
      ? /** @type {{ status?: unknown }} */ (result).status
      : undefined;
  return typeof status === 'number' && Number.isInteger(status) ? status : null;
}

/**
 * Builds the local response returned for an exhausted budget.
 * @param {string | null} value - Optional Retry-After value supplied by the gate.
 * @param {string} resource - Resource identifier supplied by the gate.
 * @returns {Response} A retryable quota exhaustion response.
 */
function quotaExhaustedResponse(value, resource) {
  return new Response(`Request quota exhausted: ${resource}`, {
    headers: { 'Retry-After': positiveRetryAfter(value) },
    status: 429
  });
}

/**
 * Reads a resource name from the trusted Durable Object response.
 * @param {unknown} result - Parsed response body.
 * @returns {string} A resource identifier suitable for a client error message.
 */
function quotaResource(result) {
  const resource =
    result !== null && typeof result === 'object'
      ? /** @type {{ resource?: unknown }} */ (result).resource
      : undefined;
  return typeof resource === 'string' && resource ? resource : 'worker.requests';
}

/**
 * Builds the local response returned when the gate cannot be trusted.
 * @returns {Response} A generic service-unavailable response.
 */
function quotaUnavailableResponse() {
  return new Response('Quota service unavailable', { status: 503 });
}

/**
 * Validates a Retry-After delta-seconds value.
 * @param {string | null} value - Header value supplied by the gate.
 * @returns {string} A positive delta-seconds value.
 */
function positiveRetryAfter(value) {
  if (!value || !/^\d+$/.test(value)) {
    return '60';
  }

  return Number.parseInt(value, 10) > 0 ? value : '60';
}
