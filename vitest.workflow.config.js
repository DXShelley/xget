import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/workflow-deployment.test.js']
  }
});
