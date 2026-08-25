import { describe, expect, it, vi } from 'vitest';

import { reserveWorkerRequest } from '../../src/quota/reserve-worker-request.js';

describe('Shared quota gate', () => {
  const now = new Date('2026-08-24T12:34:56.000Z');

  it('keeps non-Cloudflare runtimes compatible when the binding is absent', async () => {
    await expect(reserveWorkerRequest({}, now)).resolves.toBeNull();
  });

  it('reserves one Worker request through the shared global Durable Object', async () => {
    const fetch = vi.fn(
      /**
       * Records the Durable Object reservation call.
       * @param {string} _input
       * @param {RequestInit} _init
       */
      async (_input, _init) => new Response(JSON.stringify({ allowed: true, status: 201 }))
    );
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => 'global-id');

    const result = await reserveWorkerRequest(
      { QUOTA_ENFORCEMENT_MODE: 'request', QUOTA_GATE: { get, idFromName } },
      now
    );

    expect(result).toBeNull();
    expect(idFromName).toHaveBeenCalledWith('global');
    expect(get).toHaveBeenCalledWith('global-id');
    expect(fetch).toHaveBeenCalledOnce();
    const [call] = fetch.mock.calls;
    const [url, init] = call;
    const requestInit = init || {};
    expect(url).toBe('https://quota-gate/reserve');
    expect(requestInit.method).toBe('POST');
    const body = JSON.parse(String(requestInit.body));
    expect(body).toMatchObject({
      day: '2026-08-24',
      deltas: [{ amount: 1, resource: 'worker.requests' }],
      profile: 'default',
      period: '2026-08'
    });
    expect(body.id).toEqual(expect.any(String));
  });

  it('defaults to hourly reconciliation without calling the Durable Object', async () => {
    const fetch = vi.fn();
    const result = await reserveWorkerRequest({
      QUOTA_GATE: { get: () => ({ fetch }), idFromName: vi.fn() }
    });

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the configured Durable Object instance name when supplied', async () => {
    const idFromName = vi.fn(() => 'xget-test-id');

    const result = await reserveWorkerRequest(
      {
        QUOTA_GATE: {
          get: () => ({
            fetch: async () => new Response(JSON.stringify({ allowed: true, status: 201 }))
          }),
          idFromName
        },
        QUOTA_ENFORCEMENT_MODE: 'request',
        QUOTA_GATE_NAME: 'xget-test'
      },
      now
    );

    expect(idFromName).toHaveBeenCalledWith('xget-test');
    expect(result).toBeNull();
  });

  it('returns a retryable 429 when the shared budget is exhausted', async () => {
    const response = await reserveWorkerRequest(
      {
        QUOTA_ENFORCEMENT_MODE: 'request',
        QUOTA_GATE: {
          get: () => ({
            fetch: async () =>
              new Response(
                JSON.stringify({
                  allowed: false,
                  reason: 'quota-exhausted',
                  resource: 'worker.requests',
                  status: 429
                }),
                {
                  headers: { 'Retry-After': '120' },
                  status: 429
                }
              )
          }),
          idFromName: () => 'global-id'
        }
      },
      now
    );

    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('120');
    await expect(response?.text()).resolves.toBe('Request quota exhausted: worker.requests');
  });

  it('fails closed when the quota gate response is malformed or unavailable', async () => {
    const malformed = await reserveWorkerRequest({
      QUOTA_ENFORCEMENT_MODE: 'request',
      QUOTA_GATE: {
        get: () => ({ fetch: async () => new Response('not-json') }),
        idFromName: () => 'global-id'
      }
    });
    const unavailable = await reserveWorkerRequest({
      QUOTA_ENFORCEMENT_MODE: 'request',
      QUOTA_GATE: {
        get: () => ({
          fetch: async () => {
            throw new Error('binding unavailable');
          }
        }),
        idFromName: () => 'global-id'
      }
    });

    expect(malformed?.status).toBe(503);
    expect(await malformed?.text()).toBe('Quota service unavailable');
    expect(unavailable?.status).toBe(503);
    expect(await unavailable?.text()).toBe('Quota service unavailable');
  });
});
