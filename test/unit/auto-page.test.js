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
import { handleRequest } from '../../src/app/handle-request.js';
import { createRequestContext } from '../../src/app/request-context.js';
import { handleApplicationRoute } from '../../src/app/route-adapters/registry.js';
import { CONFIG, createConfig } from '../../src/config/index.js';

/**
 * Returns the actual Workers test storage namespace.
 */
function environment() {
  return /** @type {{PAGE_MAP: import('../../src/proxy/auto-page/handle.js').MappingNamespace}} */ ({
    ...bindings,
    XGET_PROXY_TARGET_ALLOWLIST: 'false'
  });
}

/**
 * Builds a complete entry context before invoking its fixed route strategy.
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @param {import('../../src/config/index.js').ApplicationConfig} config
 */
function routeContext(request, env, config) {
  return { ...createRequestContext(request, env), config };
}

describe('automatic public pages', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    { enabled: true, strict: false, allowed: true },
    { enabled: false, strict: false, allowed: false },
    { enabled: true, strict: true, allowed: false }
  ])(
    'scopes entry form redirects to enabled automatic page hosts: %o',
    async ({ enabled, strict, allowed }) => {
      const env = {
        PAGE_MAP: enabled ? environment().PAGE_MAP : undefined,
        XGET_PROXY_TARGET_ALLOWLIST: String(strict)
      };
      const url = new URL('https://fast.dxshelley.fun/');
      const result = await handleApplicationRoute(
        routeContext(new Request(url), env, createConfig(env))
      );
      const directives = result?.response.headers.get('Content-Security-Policy')?.split('; ') || [];
      const form = directives.find(value => value.startsWith('form-action ')) || '';
      expect(form.includes('https://*.fast.dxshelley.fun')).toBe(allowed);
      expect(form).not.toContain('https://*.dxshelley.fun');
      expect(directives).toContain("connect-src 'self'");
      expect(directives).toContain("default-src 'none'");
    }
  );

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

  it('requires an explicit false target allowlist setting before serving public pages', async () => {
    const pageMap = environment().PAGE_MAP;
    const env = { PAGE_MAP: pageMap };
    const mirror = await registerPage(new URL('https://example.com/implicit'), pageMap);

    expect((await handleAutoPage(new Request(mirror), env))?.status).toBe(403);
    expect(
      await handleAutoPage(
        new Request('https://fast.dxshelley.fun/?target=https://example.com/implicit'),
        env
      )
    ).toBeNull();
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

  it('creates stable readable labels from the origin hostname, excluding path, query and fragment', async () => {
    const a = await pageLabel(new URL('https://developers.openai.com/codex/changelog?q=1'));
    expect(a).toBe('developers-openai-com');
    expect(a.length).toBeLessThanOrEqual(63);
    expect(
      await pageLabel(new URL('https://DEVELOPERS.OPENAI.COM:443/codex/changelog?q=2#section'))
    ).toBe(a);
    const other = await pageLabel(new URL('https://developers.openai.com/codex/overview'));
    expect(other).toBe(a);
    expect(await pageLabel(new URL('https://a.example/a-b'))).toBe(
      await pageLabel(new URL('https://a.example/a/b'))
    );
    expect(
      (await pageLabel(new URL(`https://example.com/${'x'.repeat(200)}`))).length
    ).toBeLessThanOrEqual(63);
  });

  it('caps the site identifier at the DNS-label limit and trims a trailing separator', async () => {
    const long = await pageLabel(
      new URL(`https://${'a'.repeat(30)}.${'b'.repeat(30)}.example/docs`)
    );
    expect(long).toMatch(/^[a]{30}-[b]{30}-e$/);
    expect(long.length).toBe(63);
    expect(isPageHost(`${long}.fast.dxshelley.fun`)).toBe(true);
    const trimmed = await pageLabel(new URL(`https://${'a'.repeat(62)}.com/docs`));
    expect(trimmed).toBe(`${'a'.repeat(61)}-c`);
  });

  it.each([
    'fast.dxshelley.fun',
    'docker.fast.dxshelley.fun',
    'claude-web.fast.dxshelley.fun',
    'claude-code.fast.dxshelley.fun',
    'ai-studio.fast.dxshelley.fun',
    `site-${'a'.repeat(32)}.fast.dxshelley.fun.evil.example`,
    `site-${'a'.repeat(32)}.dxshelley.fun`,
    'page.fast.dxshelley.fun',
    `site-${'a'.repeat(20)}-fast.dxshelley.fun`,
    `site-${'a'.repeat(64)}.fast.dxshelley.fun`,
    `${'a'.repeat(31)}-${'a'.repeat(32)}.fast.dxshelley.fun`,
    `-site-${'a'.repeat(32)}.fast.dxshelley.fun`
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
    expect(mirror.hostname).toBe('example-com.fast.dxshelley.fun');
    expect(mirror.pathname).toBe('/docs/start');
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
    expect(html).toContain(`${mirror.origin}/next`);
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

  it('reuses one generated host for every path of the same origin', async () => {
    const env = environment();
    const first = await registerPage(
      new URL('https://developers.openai.com/codex/changelog?q=1'),
      env.PAGE_MAP
    );
    const second = await registerPage(
      new URL('https://developers.openai.com/codex/overview?q=2#part'),
      env.PAGE_MAP
    );
    expect(second.origin).toBe(first.origin);
    expect(first.pathname).toBe('/codex/changelog');
    expect(second.pathname).toBe('/codex/overview');
    expect(second.search).toBe('?q=2');
    expect(second.hash).toBe('#part');
  });

  it('rejects origins whose readable hostname labels collide', async () => {
    const env = environment();
    await registerPage(new URL('https://a.b.example/docs'), env.PAGE_MAP);
    await expect(registerPage(new URL('https://a-b.example/docs'), env.PAGE_MAP)).rejects.toThrow(
      'Site label collision'
    );
  });

  it('returns a conflict response when the entry hits a readable-label collision', async () => {
    const env = environment();
    await registerPage(new URL('https://a.b.example/docs'), env.PAGE_MAP);
    const response = await handleAutoPage(
      new Request('https://fast.dxshelley.fun/?target=https%3A%2F%2Fa-b.example%2Fdocs'),
      env
    );
    expect(response?.status).toBe(409);
    expect(await response?.text()).toBe('Generated page host already maps to a different site');
  });

  it('serves a direct label that happens to end in the legacy hash shape', async () => {
    const env = environment();
    const mirror = await registerPage(new URL('https://foo.abcdefgh/docs'), env.PAGE_MAP);
    expect(mirror.hostname).toBe('foo-abcdefgh.fast.dxshelley.fun');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    expect(await (await handleAutoPage(new Request(mirror), env))?.text()).toBe('ok');
  });

  it('redirects a legacy per-path page host to its origin-scoped successor', async () => {
    const env = environment();
    const target = new URL('https://legacy.example/docs/start');
    const bytes = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(target.origin + target.pathname)
      )
    );
    const legacyHash = [...bytes]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
    const legacyLabel = `legacy-example-${legacyHash}`;
    const stub = env.PAGE_MAP.get(env.PAGE_MAP.idFromName(legacyLabel));
    await stub.fetch('https://mapping/', { method: 'PUT', body: target.href });
    const response = await handleAutoPage(
      new Request(`https://${legacyLabel}.fast.dxshelley.fun/?q=1`),
      env
    );
    expect(response?.status).toBe(302);
    expect(response?.headers.get('Location')).toMatch(
      /^https:\/\/legacy-example\.fast\.dxshelley\.fun\/docs\/start\?q=1$/
    );
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
      /^https:\/\/learn-chatgpt-com\.fast\.dxshelley\.fun\/docs\/changelog$/
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
    const env = {
      ...environment(),
      XGET_AUTH_REQUIRED: 'true'
    };
    const mirror = await registerPage(new URL('https://example.com/public'), env.PAGE_MAP);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('public', { headers: { 'Content-Type': 'text/plain' } })
    );
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
    expect((await handleRequest(new Request(mirror), env, ctx)).status).toBe(200);
    const portal = await handleRequest(
      new Request('https://fast.dxshelley.fun/?target=https://code.claude.com/'),
      env,
      ctx
    );
    expect(portal.headers.get('Location')).toContain('/__xget/auth/login');
  });

  it('keeps registered targets on their authenticated adapter when public pages are enabled', async () => {
    const env = {
      ...environment(),
      XGET_AUTH_REQUIRED: 'true',
      XGET_PROXY_TARGET_ALLOWLIST: 'false'
    };
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
    const registered = await handleRequest(
      new Request('https://fast.dxshelley.fun/?target=https%3A%2F%2Fcode.claude.com%2Fdocs'),
      env,
      ctx
    );
    const publicPage = await handleRequest(
      new Request('https://fast.dxshelley.fun/?target=https%3A%2F%2Funregistered.example%2Fdocs'),
      env,
      ctx
    );

    expect(registered.headers.get('Location')).toContain('/__xget/auth/login');
    expect(publicPage.status).toBe(302);
    expect(new URL(publicPage.headers.get('Location') || '').hostname).toBe(
      'unregistered-example.fast.dxshelley.fun'
    );
  });

  it('keeps registered isolated hosts on their authenticated adapter when public pages are enabled', async () => {
    const env = {
      ...environment(),
      XGET_AUTH_REQUIRED: 'true',
      XGET_PROXY_TARGET_ALLOWLIST: 'false'
    };
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
    const response = await handleRequest(
      new Request('https://claude-web.fast.dxshelley.fun/download'),
      env,
      ctx
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/__xget/auth/login?return_to=%2Fdownload');
  });

  it('returns 404 for unscoped resources but leaves platform routing and legacy mode available', async () => {
    const env = environment();
    const url = new URL('https://fast.dxshelley.fun/_astro/app.js');
    const result = await handleApplicationRoute(routeContext(new Request(url), env, CONFIG));
    expect(result?.response.status).toBe(404);
    expect(result?.response.headers.has('Location')).toBe(false);
    const platform = new URL('https://fast.dxshelley.fun/gh/a/b');
    expect(
      await handleApplicationRoute(routeContext(new Request(platform), env, CONFIG))
    ).toBeNull();
    expect(
      await handleAutoPage(
        new Request('https://fast.dxshelley.fun/?target=https://example.com/'),
        {}
      )
    ).toBeNull();
  });
});
