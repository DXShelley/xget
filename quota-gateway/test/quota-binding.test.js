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
});
