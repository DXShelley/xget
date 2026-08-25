import { afterEach, describe, expect, it, vi } from 'vitest';

import { createState, reserve } from '../src/quota-engine.js';
import { QuotaGate } from '../src/quota-gate.js';

function reservation(id, amount) {
  return {
    day: '2026-08-24',
    deltas: [{ amount, resource: 'worker.requests' }],
    id,
    period: '2026-08',
    profile: 'account'
  };
}

describe('QuotaGate state policy', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('applies the deployed policy to existing persistent usage', async () => {
    const previousPolicy = {
      resources: { 'worker.requests': { limit: 80_000, scope: 'daily' } }
    };
    const existing = reserve(
      createState(previousPolicy, '2026-08', '2026-08-24'),
      reservation('old', 49_500)
    ).state;
    const storage = {
      get: async () => existing,
      put: async (_key, value) => {
        storage.value = value;
      }
    };
    const gate = new QuotaGate(
      { storage },
      {
        FREE_ONLY_POLICIES: JSON.stringify({
          profiles: {
            account: {
              resources: { 'worker.requests': { limit: 50_000, scope: 'daily' } }
            }
          }
        }),
        QUOTA_PROFILE: 'account'
      }
    );

    const response = await gate.fetch(
      new Request('https://quota-gate/reserve', {
        body: JSON.stringify(reservation('new', 1_000)),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      })
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      allowed: false,
      resource: 'worker.requests'
    });
  });

  it('persists a platform overage and denies later reservations with its resource', async () => {
    const storage = {
      get: async () => storage.value,
      put: async (_key, value) => {
        storage.value = value;
      }
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: {
                viewer: {
                  accounts: [
                    {
                      workersInvocationsAdaptive: [{ sum: { requests: 6 } }]
                    }
                  ]
                }
              }
            })
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: {
                viewer: {
                  accounts: [
                    {
                      r2OperationsAdaptiveGroups: [],
                      r2StorageAdaptiveGroups: [{ max: { metadataSize: 0, payloadSize: 0 } }]
                    }
                  ]
                }
              }
            })
          )
        )
    );
    const gate = new QuotaGate(
      { storage },
      {
        CLOUDFLARE_ACCOUNT_ID: 'account',
        CLOUDFLARE_ANALYTICS_API_TOKEN: 'token',
        FREE_ONLY_POLICIES: JSON.stringify({
          profiles: {
            account: {
              resources: {
                'r2.class_a': { limit: 10, scope: 'monthly' },
                'r2.class_b': { limit: 10, scope: 'monthly' },
                'r2.storage.bytes': { limit: 100, scope: 'current' },
                'worker.requests': { limit: 5, scope: 'daily' }
              }
            }
          }
        }),
        QUOTA_PROFILE: 'account',
        R2_BUCKET_NAME: 'shotsync'
      }
    );

    const reconciliation = await gate.fetch(
      new Request('https://quota-gate/reconcile', { method: 'POST' })
    );
    expect(reconciliation.status).toBe(200);
    await expect(reconciliation.json()).resolves.toMatchObject({
      platformExceeded: ['worker.requests'],
      reconciliation: { source: 'cloudflare-graphql' }
    });

    const result = await gate.fetch(
      new Request('https://quota-gate/reserve', {
        body: JSON.stringify(reservation('after-platform-overage', 1)),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      })
    );
    expect(result.status).toBe(429);
    await expect(result.json()).resolves.toMatchObject({
      reason: 'platform-quota-exhausted',
      resource: 'worker.requests'
    });
  });

  it('records Analytics failure and continues to enforce the local ledger', async () => {
    const storage = {
      get: async () => storage.value,
      put: async (_key, value) => {
        storage.value = value;
      }
    };
    const gate = new QuotaGate(
      { storage },
      {
        FREE_ONLY_POLICIES: JSON.stringify({
          profiles: { account: { resources: { 'worker.requests': { limit: 2, scope: 'daily' } } } }
        }),
        QUOTA_PROFILE: 'account'
      }
    );

    const reconciliation = await gate.fetch(
      new Request('https://quota-gate/reconcile', { method: 'POST' })
    );
    await expect(reconciliation.json()).resolves.toMatchObject({
      reconciliation: { source: 'local', error: expect.stringContaining('not configured') }
    });

    const first = await gate.fetch(
      new Request('https://quota-gate/reserve', {
        body: JSON.stringify(reservation('local-1', 1)),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      })
    );
    expect(first.status).toBe(201);
  });

  it('does not call GraphQL twice in the same UTC hour', async () => {
    const now = new Date();
    const existing = createState(
      { resources: { 'worker.requests': { limit: 2, scope: 'daily' } } },
      now.toISOString().slice(0, 7),
      now.toISOString().slice(0, 10)
    );
    existing.reconciliation.lastAttemptHour = now.toISOString().slice(0, 13);
    const storage = { get: async () => existing, put: vi.fn() };
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const gate = new QuotaGate(
      { storage },
      {
        CLOUDFLARE_ACCOUNT_ID: 'account',
        CLOUDFLARE_ANALYTICS_API_TOKEN: 'token',
        FREE_ONLY_POLICIES: JSON.stringify({
          profiles: { account: { resources: { 'worker.requests': { limit: 2, scope: 'daily' } } } }
        }),
        QUOTA_PROFILE: 'account',
        R2_BUCKET_NAME: 'shotsync'
      }
    );

    const response = await gate.fetch(
      new Request('https://quota-gate/reconcile', { method: 'POST' })
    );
    await expect(response.json()).resolves.toMatchObject({ attempted: false });
    expect(request).not.toHaveBeenCalled();
  });
});
