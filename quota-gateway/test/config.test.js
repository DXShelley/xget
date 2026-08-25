import { describe, expect, it } from 'vitest';

import { loadPolicy } from '../src/config.js';

describe('quota policy profiles', () => {
  it('selects independent Xget and ShotSync resource limits', () => {
    const rawProfiles = JSON.stringify({
      profiles: {
        shotsync: {
          resources: {
            'r2.storage.bytes': { limit: 10_000_000, scope: 'current' },
            'worker.requests': { limit: 60_000, scope: 'daily' }
          }
        },
        xget: {
          resources: { 'worker.requests': { limit: 5, scope: 'daily' } }
        }
      }
    });

    expect(loadPolicy(rawProfiles, 'xget').resources['worker.requests'].limit).toBe(5);
    expect(loadPolicy(rawProfiles, 'shotsync').resources['worker.requests'].limit).toBe(60_000);
    expect(loadPolicy(rawProfiles, 'shotsync').resources['r2.storage.bytes'].limit).toBe(
      10_000_000
    );
  });
});
