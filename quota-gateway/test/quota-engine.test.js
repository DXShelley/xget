import { describe, expect, it } from 'vitest';

import { createState, releaseStorage, reserve, setKillSwitch } from '../src/quota-engine.js';

const policy = {
  resources: {
    'r2.storage.bytes': { scope: 'current', limit: 100 },
    'r2.class_a': { scope: 'monthly', limit: 2 },
    'worker.requests': { scope: 'daily', limit: 3 }
  }
};

function request(id, deltas, day = '2026-08-24') {
  return { id, period: '2026-08', day, deltas };
}

describe('quota engine', () => {
  it('reserves all resources atomically and is idempotent by reservation id', () => {
    const state = createState(policy, '2026-08', '2026-08-24');
    const reservation = request('put-1', [
      { resource: 'r2.storage.bytes', amount: 80 },
      { resource: 'r2.class_a', amount: 1 },
      { resource: 'worker.requests', amount: 1 }
    ]);

    const first = reserve(state, reservation);
    const second = reserve(first.state, reservation);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.state.usage.current['r2.storage.bytes']).toBe(80);
    expect(second.state.usage.monthly['r2.class_a']).toBe(1);
  });

  it('rejects a request before any partial usage is recorded', () => {
    const state = createState(policy, '2026-08', '2026-08-24');
    const result = reserve(
      state,
      request('too-large', [
        { resource: 'r2.storage.bytes', amount: 101 },
        { resource: 'r2.class_a', amount: 1 }
      ])
    );

    expect(result).toMatchObject({
      allowed: false,
      reason: 'quota-exhausted',
      resource: 'r2.storage.bytes',
      status: 429
    });
    expect(result.state.usage.current).toEqual({});
    expect(result.state.usage.monthly).toEqual({});
  });

  it('adds duplicate resource deltas before enforcing the limit', () => {
    const state = createState(policy, '2026-08', '2026-08-24');
    const result = reserve(
      state,
      request('duplicate-resource', [
        { resource: 'r2.storage.bytes', amount: 60 },
        { resource: 'r2.storage.bytes', amount: 50 }
      ])
    );

    expect(result).toMatchObject({
      allowed: false,
      reason: 'quota-exhausted',
      resource: 'r2.storage.bytes',
      status: 429
    });
  });

  it('rejects unregistered resources', () => {
    const state = createState(policy, '2026-08', '2026-08-24');
    const result = reserve(state, request('unknown', [{ resource: 'ai.tokens', amount: 1 }]));

    expect(result).toMatchObject({
      allowed: false,
      reason: 'unknown-resource',
      resource: 'ai.tokens',
      status: 503
    });
  });

  it('keeps current storage across a monthly rollover and resets monthly usage', () => {
    const state = createState(policy, '2026-08', '2026-08-24');
    const august = reserve(
      state,
      request('august', [
        { resource: 'r2.storage.bytes', amount: 40 },
        { resource: 'r2.class_a', amount: 1 }
      ])
    ).state;
    const september = reserve(august, {
      id: 'september',
      period: '2026-09',
      day: '2026-09-01',
      deltas: [{ resource: 'r2.class_a', amount: 2 }]
    });

    expect(september.allowed).toBe(true);
    expect(september.state.usage.current['r2.storage.bytes']).toBe(40);
    expect(september.state.usage.monthly['r2.class_a']).toBe(2);
  });

  it('denies all reservations when the kill switch is enabled', () => {
    const state = setKillSwitch(createState(policy, '2026-08', '2026-08-24'), true);
    const result = reserve(state, request('blocked', [{ resource: 'worker.requests', amount: 1 }]));

    expect(result).toMatchObject({ allowed: false, status: 503, reason: 'kill-switch-enabled' });
  });

  it('releases storage only after a confirmed deletion', () => {
    const state = reserve(
      createState(policy, '2026-08', '2026-08-24'),
      request('put', [{ resource: 'r2.storage.bytes', amount: 80 }])
    ).state;
    const released = releaseStorage(state, 25);

    expect(released.usage.current['r2.storage.bytes']).toBe(55);
  });
});
