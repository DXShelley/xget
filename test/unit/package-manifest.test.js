import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

describe('Package manifest', () => {
  it('does not depend on itself', () => {
    const require = createRequire(import.meta.url);
    const packageJson = require('../../package.json');
    const { dependencies } = packageJson;
    const typedDependencies = /** @type {Record<string, string> | undefined} */ (dependencies);

    expect(packageJson.name).toBe('xget');
    expect(typedDependencies?.xget).toBeUndefined();
  });

  it('exposes separate deployment commands for Xget and GitHub mirror workers', () => {
    const require = createRequire(import.meta.url);
    const packageJson = require('../../package.json');

    expect(packageJson.scripts['deploy:fast']).toBe('wrangler deploy --env ""');
    expect(packageJson.scripts['deploy:git']).toBe('wrangler deploy --env git');
    expect(packageJson.scripts.deploy).toBe('npm run deploy:fast && npm run deploy:git');
  });
});
