import { describe, expect, it } from 'vitest';

import { createRequestContext } from '../../src/app/request-context.js';
import { runPipeline } from '../../src/filters/run-pipeline.js';

/**
 * @param {string} name
 * @param {string[]} events
 * @returns {(context: unknown, next: () => Promise<Response>) => Promise<Response>}
 */
function createRecordingFilter(name, events) {
  return async (_context, next) => {
    events.push(`${name}:request`);
    const response = await next();
    events.push(`${name}:response`);
    return response;
  };
}

describe('protocol adapter registry', () => {
  it.each([
    ['web', new Request('https://fast.example/gh/owner/repository')],
    [
      'git',
      new Request('https://git.example/owner/repository.git/objects/batch', {
        body: '{}',
        headers: { 'Content-Type': 'application/vnd.git-lfs+json' },
        method: 'POST'
      })
    ],
    [
      'docker',
      new Request('https://fast.example/cr/docker/v2/library/alpine/manifests/latest', {
        headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' }
      })
    ],
    ['ai', new Request('https://fast.example/ip/openai/v1/chat/completions')],
    ['huggingface', new Request('https://fast.example/hf/api/models/example')],
    ['package', new Request('https://fast.example/npm/example')]
  ])('binds the %s adapter once at request entry', (feature, request) => {
    const context = createRequestContext(request, {});

    expect(context.protocolFeature).toBe(feature);
    expect(context.adapter.kind).toBe(feature);
  });
});

describe('bidirectional request pipeline', () => {
  it('runs request handlers forward and response handlers in reverse order', async () => {
    /** @type {string[]} */
    const events = [];

    const response = await runPipeline({}, [
      createRecordingFilter('security', events),
      createRecordingFilter('authentication', events),
      async () => {
        events.push('transport:request');
        return new Response('ok');
      }
    ]);

    expect(await response.text()).toBe('ok');
    expect(events).toEqual([
      'security:request',
      'authentication:request',
      'transport:request',
      'authentication:response',
      'security:response'
    ]);
  });
});
