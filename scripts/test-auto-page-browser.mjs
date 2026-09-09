import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

// Playwright may be supplied by the desktop runtime through NODE_PATH.
const { chromium } = createRequire(import.meta.url)('playwright');
const fixture = process.env.XGET_HTML_FIXTURE
  ? await readFile(process.env.XGET_HTML_FIXTURE, 'utf8')
  : '';
const source = `
import { handleApplicationRoute } from './src/app/handle-request.js';
import { CONFIG } from './src/config/index.js';
import { rewriteHtml } from './src/proxy/auto-page/rewrite.js';
export { PageMap } from './src/proxy/auto-page/map.js';
const html = '<html><head><title>Public page proxy</title><link rel="stylesheet" href="/_astro/main.css"><script type="module" src="/_astro/app.js"></script></head><body><h1>Public page proxy</h1><p id="result">Loading</p><img id="picture" src="https://cdn.example/pixel.png"><a href="https://other.example/next">Next page</a><a id="framework-link" href="https://framework.example/">Try framework link</a><script>document.addEventListener("click", event => { if (event.target.closest("#framework-link")) { event.preventDefault(); location.assign("https://framework.example/original-framework-target"); } });</script></body></html>';
globalThis.fetch = async (input) => {
  const u = new URL(String(input));
  if (u.hostname === 'example.com' && u.pathname === '/docs/start') return new Response(null, { status: 302, headers: { Location: 'https://learn.chatgpt.com/docs/start' } });
  if (u.pathname.endsWith('.png')) return new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='), c => c.charCodeAt(0)), {headers:{'Content-Type':'image/png'}});
  if (u.pathname === '/_astro/main.css') return new Response('@import "./theme.css";body{font-family:system-ui;padding:32px}img{width:64px;height:64px}', {headers:{'Content-Type':'text/css'}});
  if (u.pathname === '/_astro/theme.css') return new Response('h1{color:rgb(20, 110, 60)}', {headers:{'Content-Type':'text/css'}});
  if (u.pathname === '/_astro/app.js') return new Response('import { word } from "./chunk.js"; const extra = await import("https://cdn.example/extra.js"); const data = await fetch("/api/text").then(r=>r.text()); document.querySelector("#result").textContent = word + extra.word + data; const img = new Image(); img.id="dynamic"; img.src="https://cdn.example/dynamic.png"; document.body.append(img);', {headers:{'Content-Type':'application/javascript'}});
  if (u.pathname.endsWith('/chunk.js')) return new Response('export const word="static ";', {headers:{'Content-Type':'application/javascript'}});
  if (u.pathname.endsWith('/extra.js')) return new Response('export const word="dynamic ";', {headers:{'Content-Type':'application/javascript'}});
  if (u.pathname === '/api/text') return new Response('fetch');
  if (u.pathname === '/next') return new Response('<html><head><title>Next page</title></head><body><h1>Next page</h1></body></html>', {headers:{'Content-Type':'text/html'}});
  return new Response(html, {headers:{'Content-Type':'text/html'}});
};
export default {async fetch(request, env) {
  if(new URL(request.url).pathname === '/__fixture-check') return new Response(await rewriteHtml(${JSON.stringify(fixture)}, new URL('https://learn.chatgpt.com/docs/changelog'), 'https://fixture-0123456789abcdef0123456789abcdef.fast.dxshelley.fun'));
  return (await handleApplicationRoute({ request, url: new URL(request.url), env, config: CONFIG }))?.response || new Response('Unknown test route', {status:404});
}};
`;
const bundle = await build({
  stdin: { contents: source, resolveDir: process.cwd() },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false
});
const mf = new Miniflare({
  https: true,
  port: 0,
  modules: true,
  script: bundle.outputFiles[0].text,
  compatibilityDate: '2026-03-17',
  durableObjects: { PAGE_MAP: { className: 'PageMap', useSQLite: true } }
});
const address = await mf.ready;
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: [
    '--no-proxy-server',
    '--ignore-certificate-errors',
    '--host-resolver-rules=MAP *.dxshelley.fun 127.0.0.1:' + address.port
  ]
});
const context = await browser.newContext({ serviceWorkers: 'block', ignoreHTTPSErrors: true });
const errors = [];
const external = [];
await context.route('**/*', async route => {
  const request = route.request();
  if (!new URL(request.url()).hostname.endsWith('.dxshelley.fun')) {
    external.push(request.url());
    return route.abort();
  }
  await route.continue();
});
try {
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  for (const viewport of [
    { width: 1365, height: 900 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('https://fast.dxshelley.fun/', {
      timeout: 30000
    });
    await page.locator('#target').fill('https://example.com/docs/start');
    await page.locator('#target-form button[type=submit]').click();
    await page.locator('#result').filter({ hasText: 'static dynamic fetch' }).waitFor();
    assert.equal(
      await page.locator('h1').evaluate(el => getComputedStyle(el).color),
      'rgb(20, 110, 60)'
    );
    await page.waitForFunction(() =>
      ['picture', 'dynamic'].every(id => document.getElementById(id)?.naturalWidth > 0)
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    );
    await mkdir('.wrangler/auto-page-qa', { recursive: true });
    await page.screenshot({ path: '.wrangler/auto-page-qa/' + viewport.width + '.png' });
    await page.getByRole('link', { name: 'Next page' }).click();
    await page.getByRole('heading', { name: 'Next page' }).waitFor();
    assert.match(page.url(), /^https:\/\/other-example\.fast\.dxshelley\.fun\/next$/);
    await page.goto('https://example-com.fast.dxshelley.fun/docs/start');
    await page.getByRole('link', { name: 'Try framework link' }).click();
    await page.waitForURL(/^https:\/\/framework-example\.fast\.dxshelley\.fun\/$/);
  }
  const nativeContext = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true
  });
  try {
    const nativePage = await nativeContext.newPage();
    nativePage.setDefaultTimeout(10000);
    nativePage.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await nativePage.goto('https://fast.dxshelley.fun/', { timeout: 30000 });
    await nativePage.locator('#target').fill('https://example.com/docs/start');
    await nativePage.locator('#target-form button[type=submit]').click();
    await nativePage.waitForURL(/^https:\/\/learn-chatgpt-com\.fast\.dxshelley\.fun\/docs\/start$/);
    await nativePage.getByRole('heading', { name: 'Public page proxy' }).waitFor();
  } finally {
    await nativeContext.close();
  }
  if (fixture) {
    const rewritten = await (
      await mf.dispatchFetch('https://fast.dxshelley.fun/__fixture-check')
    ).text();
    const inspection = await context.newPage();
    const result = await inspection.evaluate(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const resources = [
        ...doc.querySelectorAll('[src],link[rel=stylesheet],[component-url],[renderer-url]')
      ].flatMap(el =>
        ['src', 'href', 'component-url', 'renderer-url']
          .map(attr => el.getAttribute(attr))
          .filter(Boolean)
      );
      return {
        count: resources.length,
        escaped: resources.filter(
          url => !url.startsWith('https://fixture-') && !/^(data:|blob:|#)/.test(url)
        ),
        islands: doc.querySelectorAll('astro-island').length
      };
    }, rewritten);
    assert.ok(result.count > 40);
    assert.deepEqual(result.escaped, []);
    console.log('Attachment HTML:', result);
  }
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log(
    'Browser smoke passed: native forms with/without JavaScript, redirect chains, desktop/mobile CSS, imports, fetch, images, navigation; zero external requests or console errors.'
  );
} catch (error) {
  console.error('Browser errors:', errors);
  throw error;
} finally {
  await context.close();
  await browser.close();
  await mf.dispose();
}
