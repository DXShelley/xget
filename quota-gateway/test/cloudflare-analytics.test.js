import { describe, expect, it, vi } from 'vitest';

import { fetchCloudflareUsage, parseUsage } from '../src/cloudflare-analytics.js';

const account = {
  r2OperationsAdaptiveGroups: [
    { dimensions: { actionType: 'PutObject' }, sum: { requests: 3 } },
    { dimensions: { actionType: 'GetObject' }, sum: { requests: 7 } },
    { dimensions: { actionType: 'FutureOperation' }, sum: { requests: 2 } }
  ],
  r2StorageAdaptiveGroups: [
    { max: { metadataSize: 5, payloadSize: 100 } },
    { max: { metadataSize: 9, payloadSize: 90 } }
  ],
  workersInvocationsAdaptive: [{ sum: { requests: 11 } }]
};

const workerAccount = { workersInvocationsAdaptive: account.workersInvocationsAdaptive };
const r2Account = {
  r2OperationsAdaptiveGroups: account.r2OperationsAdaptiveGroups,
  r2StorageAdaptiveGroups: account.r2StorageAdaptiveGroups
};

describe('Cloudflare Analytics reconciliation client', () => {
  it('maps delayed Dashboard aggregates to tracked quota resources', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { viewer: { accounts: [workerAccount] } } }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { viewer: { accounts: [r2Account] } } }), {
          status: 200
        })
      );

    await expect(
      fetchCloudflareUsage(
        {
          CLOUDFLARE_ACCOUNT_ID: 'account-id',
          CLOUDFLARE_ANALYTICS_API_TOKEN: 'secret',
          R2_BUCKET_NAME: 'shotsync'
        },
        new Date('2026-08-24T12:34:00.000Z'),
        request
      )
    ).resolves.toEqual({
      'r2.class_a': 5,
      'r2.class_b': 7,
      'r2.storage.bytes': 105,
      'worker.requests': 11
    });
    expect(request.mock.calls[0][0]).toBe('https://api.cloudflare.com/client/v4/graphql');
    expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer secret');
    expect(JSON.parse(request.mock.calls[0][1].body).query).toContain(
      'workersInvocationsAdaptive('
    );
    expect(JSON.parse(request.mock.calls[0][1].body).query).toContain('$start: string!');
    expect(JSON.parse(request.mock.calls[0][1].body).query).toContain(
      'workersInvocationsAdaptive(limit: 100'
    );
    expect(JSON.parse(request.mock.calls[1][1].body).query).toContain(
      'r2OperationsAdaptiveGroups('
    );
    expect(JSON.parse(request.mock.calls[1][1].body).query).toContain('$dayStart: Time!');
    expect(JSON.parse(request.mock.calls[1][1].body).query).toContain('orderBy: [datetime_DESC]');
    expect(JSON.parse(request.mock.calls[1][1].body).query).toContain('dimensions { datetime }');
  });

  it('fails closed for GraphQL errors and malformed aggregates', async () => {
    await expect(
      fetchCloudflareUsage(
        { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_ANALYTICS_API_TOKEN: 't', R2_BUCKET_NAME: 'b' },
        new Date(),
        vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(new Response(JSON.stringify({ errors: [{ message: 'denied' }] })))
          )
      )
    ).rejects.toThrow('GraphQL error: denied');
    expect(() =>
      parseUsage({
        workersInvocationsAdaptive: [],
        r2StorageAdaptiveGroups: [],
        r2OperationsAdaptiveGroups: []
      })
    ).toThrow('storage result is invalid');
  });
});
