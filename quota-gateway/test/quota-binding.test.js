import { describe, expect, it, vi } from 'vitest';

import worker, { quotaRequest, reconcileQuota } from '../src/index.js';

describe('QuotaGate binding', () => {
  it('routes every quota operation through the one named Durable Object instance', async () => {
    const response = new Response('{}');
    const fetch = vi.fn().mockResolvedValue(response);
    const id = { toString: () => 'global-id' };
    const get = vi.fn().mockReturnValue({ fetch });
    const idFromName = vi.fn().mockReturnValue(id);
    const env = { QUOTA_GATE: { get, idFromName } };

    const result = await quotaRequest(env, '/status');

    expect(idFromName).toHaveBeenCalledWith('global');
    expect(get).toHaveBeenCalledWith(id);
    expect(fetch).toHaveBeenCalledWith('https://quota-gate/status', {
      body: undefined,
      headers: undefined,
      method: 'GET'
    });
    expect(result).toBe(response);
  });

  it('allows an authenticated administrative caller to inspect a named instance', async () => {
    const response = new Response('{}');
    const fetch = vi.fn().mockResolvedValue(response);
    const id = { toString: () => 'xget-test-id' };
    const get = vi.fn().mockReturnValue({ fetch });
    const idFromName = vi.fn().mockReturnValue(id);

    await quotaRequest(
      { QUOTA_GATE: { get, idFromName } },
      '/status',
      undefined,
      'xget-test-20260824c'
    );

    expect(idFromName).toHaveBeenCalledWith('xget-test-20260824c');
    expect(get).toHaveBeenCalledWith(id);
  });

  it('uses the configured account-wide instance for normal quota operations', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    const id = { toString: () => 'account-id' };
    const get = vi.fn().mockReturnValue({ fetch });
    const idFromName = vi.fn().mockReturnValue(id);

    await quotaRequest(
      { QUOTA_GATE: { get, idFromName }, QUOTA_GATE_NAME: 'account-free-20260824' },
      '/reserve',
      { id: 'reservation' }
    );

    expect(idFromName).toHaveBeenCalledWith('account-free-20260824');
  });

  it('sends the hourly scheduled reconciliation to the shared instance', async () => {
    const response = new Response('{}');
    const fetch = vi.fn().mockResolvedValue(response);
    const id = { toString: () => 'account-id' };
    const get = vi.fn().mockReturnValue({ fetch });
    const idFromName = vi.fn().mockReturnValue(id);

    await reconcileQuota({
      QUOTA_GATE: { get, idFromName },
      QUOTA_GATE_NAME: 'account-free-20260824'
    });
    expect(idFromName).toHaveBeenCalledWith('account-free-20260824');
    expect(fetch).toHaveBeenCalledWith('https://quota-gate/reconcile', { method: 'POST' });

    const waitUntil = vi.fn();
    await worker.scheduled(
      {},
      { QUOTA_GATE: { get, idFromName }, QUOTA_GATE_NAME: 'account-free-20260824' },
      { waitUntil }
    );
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it('charges replacement uploads only for net new storage', async () => {
    const calls = [];
    const quotaGateFetch = vi.fn(async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ allowed: true, status: 201 }), { status: 201 });
    });
    const put = vi.fn().mockResolvedValue(undefined);
    const env = {
      QUOTA_GATE: { get: () => ({ fetch: quotaGateFetch }), idFromName: () => 'quota-id' },
      QUOTA_GATEWAY_API_TOKEN: 'test-token',
      QUOTA_PROFILE: 'account',
      REQUEST_RATE_LIMITER: { limit: async () => ({ success: true }) },
      SHOTS_BUCKET: { head: async () => ({ size: 64 }), put }
    };

    const response = await worker.fetch(
      new Request('https://quota.example/v1/objects/screenshots/a.png', {
        body: 'x'.repeat(80),
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Length': '80',
          'Content-Type': 'image/png'
        },
        method: 'PUT'
      }),
      env
    );

    expect(response.status).toBe(201);
    expect(put).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0].init.body).deltas).toEqual([
      { amount: 1, resource: 'r2.class_b' },
      { amount: 1, resource: 'worker.requests' }
    ]);
    expect(JSON.parse(calls[1].init.body).deltas).toEqual([
      { amount: 16, resource: 'r2.storage.bytes' },
      { amount: 1, resource: 'r2.class_a' }
    ]);
  });
});
