/** Conservative defaults intentionally leave headroom below public Free-plan limits. */
export const DEFAULT_POLICY = {
  resources: {
    'd1.rows_read': { limit: 3_000_000, scope: 'daily' },
    'd1.rows_written': { limit: 60_000, scope: 'daily' },
    'kv.lists': { limit: 700, scope: 'daily' },
    'kv.reads': { limit: 60_000, scope: 'daily' },
    'kv.writes': { limit: 700, scope: 'daily' },
    'r2.class_a': { limit: 600_000, scope: 'monthly' },
    'r2.class_b': { limit: 2_000_000, scope: 'monthly' },
    'r2.storage.bytes': { limit: 8_000_000_000, scope: 'current' },
    'worker.requests': { limit: 60_000, scope: 'daily' }
  }
};

/**
 * Loads an optional JSON policy override or a named policy profile.
 * @param {string | undefined} rawPolicy
 * @param {string} [profile]
 * @returns {{ resources: Record<string, { scope: 'current' | 'daily' | 'monthly', limit: number }> }}
 */
export function loadPolicy(rawPolicy, profile = 'default') {
  if (!rawPolicy) {
    return structuredClone(DEFAULT_POLICY);
  }

  const parsed = JSON.parse(rawPolicy);
  const policy = parsed?.profiles ? parsed.profiles[profile] : parsed;
  if (
    !policy ||
    typeof policy !== 'object' ||
    !policy.resources ||
    typeof policy.resources !== 'object'
  ) {
    throw new Error(`Quota policy profile "${profile}" must define resources.`);
  }
  for (const rule of Object.values(policy.resources)) {
    if (
      !rule ||
      typeof rule !== 'object' ||
      !['current', 'daily', 'monthly'].includes(rule.scope) ||
      !Number.isSafeInteger(rule.limit) ||
      rule.limit <= 0
    ) {
      throw new Error('FREE_ONLY_POLICY contains an invalid resource rule.');
    }
  }
  return policy;
}

/**
 * @param {Date} date
 * @returns {{ day: string, period: string }}
 */
export function utcClock(date = new Date()) {
  const isoDate = date.toISOString().slice(0, 10);
  return { day: isoDate, period: isoDate.slice(0, 7) };
}
