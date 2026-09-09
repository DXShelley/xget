import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  pageLabel,
  isPageHost,
  publicTarget,
  resourceUrl,
  decodeResource
} from '../../src/proxy/auto-page/urls.js';
import { handleAutoPage, registerPage } from '../../src/proxy/auto-page/handle.js';
import { env as bindings } from 'cloudflare:test';
import { rewriteCss, rewriteModule, rewriteHtml } from '../../src/proxy/auto-page/rewrite.js';
import { handleApplicationRoute, handleRequest } from '../../src/app/handle-request.js';
import { CONFIG } from '../../src/config/index.js';

/**
 * Returns the actual Workers test storage namespace.
 */
function environment() {
  return /** @type {{PAGE_MAP: import('../../src/proxy/auto-page/handle.js').MappingNamespace}} */ (
    bindings
  );
}

describe('automatic public pages', () => {
  afterEach(() => vi.restoreAllMocks());

  it('disables existing generated hosts when the strict target allowlist is enabled', async () => {
    const env = { ...environment(), XGET_PROXY_TARGET_ALLOWLIST: ' true ' };
    const mirror = await registerPage(new URL('https://example.com/strict'), env.PAGE_MAP);
    const spy = vi.spyOn(globalThis, 'fetch');
    expect((await handleAutoPage(new Request(mirror), env))?.status).toBe(403);
    expect(
      await handleAutoPage(
        new Request('https://fast.dxshelley.fun/?target=https://example.com/'),
        env
      )
    ).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('preserves HEAD semantics and bounds rewritten text', async () => {
    const env = environment();
    const mirror = await registerPage(new URL('https://example.com/limits'), env.PAGE_MAP);
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { headers: { 'Content-Type': 'text/html' } }));
    const head = await handleAutoPage(new Request(mirror, { method: 'HEAD' }), env);
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe('');
    expect(spy.mock.calls[0][1]?.method).toBe('HEAD');
    spy.mockResolvedValueOnce(
      new Response('a'.repeat(4 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'text/html' } })
    );
    expect((await handleAutoPage(new Request(mirror), env))?.status).toBe(502);
  });

  it('creates stable hostname labels with a 128-bit path hash, excluding query and fragment', async () => {
    const a = await pageLabel(new URL('https://developers.openai.com/codex/changelog?q=1'));
    expect(a).toMatch(/^developers-openai-com-[a-f0-9]{32}$/);
    expect(a.length).toBeLessThanOrEqual(63);
    expect(
      await pageLabel(new URL('https://DEVELOPERS.OPENAI.COM:443/codex/changelog?q=2#section'))
    ).toBe(a);
    const other = await pageLabel(new URL('https://developers.openai.com/codex/overview'));
    expect(other).toMatch(/^developers-openai-com-[a-f0-9]{32}$/);
    expect(other).not.toBe(a);
    expect(await pageLabel(new URL('https://a.example/a-b'))).not.toBe(
      await pageLabel(new URL('https://a.example/a/b'))
    );
    expect(
      (await pageLabel(new URL(`https://example.com/${'x'.repeat(200)}`))).length
    ).toBeLessThanOrEqual(63);
  });

  it('caps the site identifier at 30 characters and trims a trailing separator', async () => {
    const long = await pageLabel(new URL(`https://${'a'.repeat(50)}.example/docs`));
    expect(long).toMatch(/^[a]{30}-[a-f0-9]{32}$/);
    expect(long.length).toBe(63);
    expect(isPageHost(`${long}.fast.dxshelley.fun`)).toBe(true);
    const trimmed = await pageLabel(new URL(`https://${'a'.repeat(29)}.example/docs`));
    expect(trimmed).toMatch(/^[a]{29}-[a-f0-9]{32}$/);
  });

  it.each([
    'fast.dxshelley.fun',
    'docker.fast.dxshelley.fun',
    'claude-code.fast.dxshelley.fun',
    'ai-studio.fast.dxshelley.fun',
    `site-${'a'.repeat(32)}.fast.dxshelley.fun.evil.example`,
    `site-${'a'.repeat(32)}.dxshelley.fun`,
    `site-${'a'.repeat(20)}-fast.dxshelley.fun`,
    `site-${'a'.repeat(64)}.fast.dxshelley.fun`,
    `${'a'.repeat(31)}-${'a'.repeat(32)}.fast.dxshelley.fun`,
    `-site-${'a'.repeat(32)}.fast.dxshelley.fun`,
    `site--${'a'.repeat(32)}.fast.dxshelley.fun`
  ])('does not classify fixed or malformed hosts as public page hosts: %s', hostname => {
    expect(isPageHost(hostname)).toBe(false);
  });

  it.each([
    'http://example.com',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost',
    'https://a.internal',
    'https://user:pass@example.com'
  ])('rejects nonpublic targets %s', value => {
    expect(() => publicTarget(value)).toThrow();
  });

  it('registers a page then rewrites styles, images, Astro components and navigation', async () => {
    const env = environment();
    const entry = new Request(
      'https://fast.dxshelley.fun/?target=https%3A%2F%2Fexample.com%2Fdocs%2Fstart%3Fq%3D1'
    );
    const redirect = await handleAutoPage(entry, env);
    expect(redirect?.status).toBe(302);
    const mirror = new URL(redirect?.headers.get('Location') || '');
    expect(mirror.hostname).toMatch(/^example-com-[a-f0-9]{32}\.fast\.dxshelley\.fun$/);
    expect(mirror.pathname).toBe('/');
    expect(mirror.search).toBe('?q=1');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          '<html><head><link rel="stylesheet" href="/_astro/main.css"></head><body><img src="../logo.png"><astro-island component-url="/_astro/app.js" renderer-url="https://cdn.example/client.js"></astro-island><a href="/next">Next</a></body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        )
      );
    const response = await handleAutoPage(new Request(mirror), env);
    const html = await response?.text();
    expect(html).toContain(
      resourceUrl('/_astro/main.css', new URL('https://example.com/docs/start'), mirror.origin)
    );
    expect(html).toContain(
      resourceUrl('../logo.png', new URL('https://example.com/docs/start'), mirror.origin)
    );
    expect(html).toContain('https://fast.dxshelley.fun/?target=');
    expect(html).toContain('/__xget/page-runtime.js');
    expect(fetchSpy.mock.calls[0][0]).toBe('https://example.com/docs/start?q=1');
  });

  it('does not claim unrelated hosts, and rejects unknown generated hosts', async () => {
    const env = environment();
    expect(await handleAutoPage(new Request('https://git.dxshelley.fun/a'), env)).toBeNull();
    expect(
      (
        await handleAutoPage(
          new Request('https://unknown-0123456789abcdef0123456789abcdef.fast.dxshelley.fun/'),
          env
        )
      )?.status
    ).toBe(404);
  });

  it('persists immutable mappings and rejects concurrent conflicting registrations', async () => {
    const map = environment().PAGE_MAP;
    const stub = map.get(map.idFromName('concurrency-test'));
    const results = await Promise.all(
      ['https://a.example/', 'https://b.example/'].map(body =>
        stub.fetch('https://mapping/', { method: 'PUT', body })
      )
    );
    expect(results.map(r => r.status).sort()).toEqual([204, 409]);
    expect(await (await stub.fetch('https://mapping/')).text()).toMatch(
      /^https:\/\/[ab]\.example\/$/
    );
  });

  it('rewrites CSS imports, font and image URLs, preserving data URLs', () => {
    const base = new URL('https://cdn.example/css/main.css');
    const mirror = 'https://page.example';
    const css = rewriteCss(
      '@import "./theme.css"; @font-face{src:url(../font.woff2)} .a{background:url(https://img.example/a.png)} .b{background:url(data:image/png;base64,AAAA)}',
      base,
      mirror
    );
    for (const url of ['./theme.css', '../font.woff2', 'https://img.example/a.png'])
      expect(css).toContain(resourceUrl(url, base, mirror));
    expect(css).toContain('data:image/png;base64,AAAA');
  });

  it('rewrites static and literal dynamic imports without touching ordinary strings', () => {
    const base = new URL('https://cdn.example/js/main.js');
    const mirror = 'https://page.example';
    const js = rewriteModule(
      'import x from "./a.js"; export {y} from "/b.js"; import("https://cdn2.example/c.js"); const s="/unchanged";',
      base,
      mirror
    );
    for (const url of ['./a.js', '/b.js', 'https://cdn2.example/c.js'])
      expect(js).toContain(resourceUrl(url, base, mirror));
    expect(js).toContain('"/unchanged"');
  });

  it('honors base, inline CSS and module imports and handles srcset with data commas', async () => {
    const base = new URL('https://cdn.example/assets/');
    const html = await rewriteHtml(
      '<html><head><base href="https://cdn.example/assets/"><style>.a{background:url(a.png)}</style><script type="module">import "./app.js"</script></head><body><img srcset="data:image/png;base64,AAAA 1x, logo.png 2x"><a href="#part">Part</a></body></html>',
      new URL('https://example.com/docs/start?q=1'),
      'https://page.example'
    );
    expect(html).toContain(resourceUrl('a.png', base, 'https://page.example'));
    expect(html).toContain(resourceUrl('./app.js', base, 'https://page.example'));
    expect(html).toContain('data:image/png;base64,AAAA 1x');
    expect(html).toContain('https://page.example/?q=1#part');
  });

  it('keeps nested resource paths and query parameters on their own upstream origin', () => {
    const url = resourceUrl(
      'https://cdn.example/a/main.js?q=1',
      new URL('https://example.com/'),
      'https://page.example'
    );
    expect(decodeResource(new URL('../b/chunk.js?q=2', url)).href).toBe(
      'https://cdn.example/b/chunk.js?q=2'
    );
  });

  it('follows document and resource redirects through the proxy', async () => {
    const env = environment();
    const mirror = await registerPage(
      new URL('https://developers.openai.com/codex/changelog'),
      env.PAGE_MAP
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'https://learn.chatgpt.com/docs/changelog' }
        })
    );
    const document = await handleAutoPage(new Request(mirror), env);
    expect(document?.headers.get('Location')).toMatch(
      /^https:\/\/learn-chatgpt-com-[a-f0-9]{32}\.fast\.dxshelley\.fun\/$/
    );
    const resource = await handleAutoPage(
      new Request(resourceUrl('/a.js', new URL('https://example.com/'), mirror.origin)),
      env
    );
    expect(resource?.headers.get('Location')).toBe(
      resourceUrl('https://learn.chatgpt.com/docs/changelog', mirror, mirror.origin)
    );
    expect(fetchSpy.mock.calls.every(call => call[1]?.redirect === 'manual')).toBe(true);
  });

  it('streams partial media and strips incoming and outgoing credentials', async () => {
    const env = environment();
    const mirror = await registerPage(new URL('https://example.com/watch'), env.PAGE_MAP);
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('abc', {
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': 'bytes 0-2/10',
          'Set-Cookie': 'secret=1'
        }
      })
    );
    const response = await handleAutoPage(
      new Request(resourceUrl('/a.mp4', new URL('https://cdn.example/'), mirror.origin), {
        headers: { Cookie: 'secret=1', Authorization: 'Bearer secret', Range: 'bytes=0-2' }
      }),
      env
    );
    expect(response?.status).toBe(206);
    expect(await response?.text()).toBe('abc');
    expect(response?.headers.has('Set-Cookie')).toBe(false);
    const headers = new Headers(spy.mock.calls[0][1]?.headers);
    expect(headers.get('Range')).toBe('bytes=0-2');
    expect(headers.has('Cookie')).toBe(false);
    expect(headers.has('Authorization')).toBe(false);
  });

  it('rejects writes, malformed namespaces, and private redirect destinations', async () => {
    const env = environment();
    const mirror = await registerPage(new URL('https://example.com/read'), env.PAGE_MAP);
    expect((await handleAutoPage(new Request(mirror, { method: 'POST' }), env))?.status).toBe(405);
    expect(
      (await handleAutoPage(new Request(new URL('/__xget/page-resource/invalid/', mirror)), env))
        ?.status
    ).toBe(400);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/' } })
    );
    expect((await handleAutoPage(new Request(mirror), env))?.status).toBe(502);
  });

  it('retains portal authentication while allowing public generated pages', async () => {
    const env = { ...environment(), XGET_AUTH_REQUIRED: 'true' };
    const mirror = await registerPage(new URL('https://example.com/public'), env.PAGE_MAP);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('public', { headers: { 'Content-Type': 'text/plain' } })
    );
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
    expect((await handleRequest(new Request(mirror), env, ctx)).status).toBe(200);
    const portal = await handleRequest(
      new Request('https://fast.dxshelley.fun/?target=https://example.com/'),
      env,
      ctx
    );
    expect(portal.headers.get('Location')).toContain('/__xget/auth/login');
  });

  it('returns 404 for unscoped resources but leaves platform routing and legacy mode available', async () => {
    const env = environment();
    const url = new URL('https://fast.dxshelley.fun/_astro/app.js');
    const result = await handleApplicationRoute({
      request: new Request(url),
      url,
      env,
      config: CONFIG
    });
    expect(result?.response.status).toBe(404);
    expect(result?.response.headers.has('Location')).toBe(false);
    const platform = new URL('https://fast.dxshelley.fun/gh/a/b');
    expect(
      await handleApplicationRoute({
        request: new Request(platform),
        url: platform,
        env,
        config: CONFIG
      })
    ).toBeNull();
    expect(
      await handleAutoPage(
        new Request('https://fast.dxshelley.fun/?target=https://example.com/'),
        {}
      )
    ).toBeNull();
  });
});
