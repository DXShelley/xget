import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from '../../src/index.js';

/** @type {ExecutionContext} */
const executionContext = {
  waitUntil() {},
  passThroughOnException() {}
};

describe('GitHub read-only Web integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects the hermes shortcut without contacting an upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await worker.fetch(
      new Request('https://fast.example/search?q=Hermes'),
      {},
      executionContext
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://fast.example/gh/DXShelley/xget');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('proxies a public repository page and rewrites internal links', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        '<html><a href="https://github.com/DXShelley/hermes">repo</a><a href="/DXShelley/hermes/fork">fork</a></html>',
        {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }
      )
    );

    const response = await worker.fetch(
      new Request('https://fast.example/gh/DXShelley/hermes', {
        headers: { Accept: 'text/html', Cookie: 'must-not-forward=true' }
      }),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('https://fast.example/gh/DXShelley/hermes');
    expect(body).not.toContain('href="/DXShelley/hermes/fork"');
    expect(body).toContain('https://github.com/DXShelley/hermes/fork');
    expect(fetchSpy.mock.calls[0][0]).toBe('https://github.com/DXShelley/hermes');
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get('Cookie')).toBeNull();
  });

  it('sends mutation requests to the canonical GitHub URL without proxying them', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await worker.fetch(
      new Request('https://fast.example/gh/DXShelley/hermes/issues', {
        method: 'POST',
        body: 'title=should-not-reach-proxy',
        headers: {
          Accept: 'text/html',
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }),
      {},
      executionContext
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('https://github.com/DXShelley/hermes/issues');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('proxies allowlisted GitHub resources through the local namespace', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('asset', { status: 200, headers: { 'Content-Type': 'text/plain' } })
      );

    const response = await worker.fetch(
      new Request(
        'https://fast.example/_github/proxy/raw.githubusercontent.com/DXShelley/hermes/main/README.md'
      ),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://raw.githubusercontent.com/DXShelley/hermes/main/README.md'
    );
    expect(await response.text()).toBe('asset');
  });

  it('applies the existing path safety policy before GitHub Web proxying', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await worker.fetch(
      new Request(`https://fast.example/gh/DXShelley/hermes/${'a'.repeat(2100)}`, {
        headers: { Accept: 'text/html' }
      }),
      {},
      executionContext
    );

    expect(response.status).toBe(414);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
