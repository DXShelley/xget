// @vitest-environment node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Read a deployment workflow from the repository.
 * @param {string} name
 */
function readWorkflow(name) {
  const path = fileURLToPath(new URL(`../../.github/workflows/${name}`, import.meta.url)).replace(
    /^\/([A-Za-z]:[\\/])/,
    '$1'
  );
  return readFileSync(path, 'utf8');
}

describe('deployment workflow triggers', () => {
  it('keeps Workers deployment automatic after a successful CI run', () => {
    const workflow = readWorkflow('workers.yml');

    expect(workflow).toContain('workflow_run:');
    expect(workflow).toContain('workflows: ["CI"]');
    expect(workflow).toContain('run: npm run deploy');
    expect(workflow).toContain('workflow_dispatch:');
  });

  it.each([
    'functions-ntl.yml',
    'functions-vc.yml',
    'image.yml',
    'pages-cf.yml',
    'pages-eo.yml',
    'sync.yml'
  ])('leaves %s available only for manual dispatch', name => {
    const workflow = readWorkflow(name);

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('workflow_run:');
  });
});
