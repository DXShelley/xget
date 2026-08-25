import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.test.toml' }
    })
  ],
  test: {
    exclude: [
      ...configDefaults.exclude,
      'test/unit/commitlint-workflow.test.js',
      'test/unit/workflow-deployment.test.js'
    ],
    testTimeout: 60000,
    hookTimeout: 30000
  }
});
