import {
  RESOURCE_PREFIX,
  PAGE_SUFFIX,
  isPageHost,
  pageLabel,
  publicTarget,
  resourceUrl,
  decodeResource,
  navigationUrl,
  siteUrl,
  matchesLegacyLabel
} from './urls.js';
import { rewriteHtml, rewriteCss, rewriteModule } from './rewrite.js';
import { PAGE_RUNTIME } from './runtime.js';

/** @typedef {{ idFromName: (name: string) => unknown, get: (id: unknown) => { fetch: (input: string, init?: RequestInit) => Promise<Response> } }} MappingNamespace */

/** @type {WeakMap<MappingNamespace, Map<string, string>>} */
const originCaches = new WeakMap();

/**
 * Returns the immutable mapping cache attached to this storage binding.
 * @param {MappingNamespace} namespace
 * @returns {Map<string, string>} Site origin cache.
 */
function originCache(namespace) {
  let cache = originCaches.get(namespace);
  if (!cache) {
    cache = new Map();
    originCaches.set(namespace, cache);
  }
  return cache;
}

/**
 * Retains at most 256 verified origins in a Worker isolate.
 * @param {Map<string, string>} cache
 * @param {string} label
 * @param {string} origin
 */
function rememberOrigin(cache, label, origin) {
  if (!cache.has(label) && cache.size >= 256) cache.delete(cache.keys().next().value || '');
  cache.set(label, origin);
}

/**
 * Registers an immutable mapping before redirecting, avoiding eventual-consistency races.
 * @param {URL} target
 * @param {MappingNamespace} map
 * @returns {Promise<URL>} Canonical generated page.
 */
export async function registerPage(target, map) {
  const label = await pageLabel(target);
  const cache = originCache(map);
  const previous = cache.get(label);
  if (previous && previous !== target.origin) throw new Error('Site label collision');
  if (!previous) {
    const stub = map.get(map.idFromName(label));
    const stored = await stub.fetch('https://mapping/', { method: 'PUT', body: target.origin });
    if (!stored.ok)
      throw new Error(stored.status === 409 ? 'Site label collision' : 'Page mapping unavailable');
    rememberOrigin(cache, label, target.origin);
  }
  return new URL(siteUrl(target, `https://${label}${PAGE_SUFFIX}`));
}

/**
 * Bounds buffering to the documents that need rewriting; media remains streamed.
 * @param {Response} response
 * @returns {Promise<string>} UTF-8 source.
 */
async function readText(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4 * 1024 * 1024) {
      await reader.cancel();
      throw new Error('Page exceeds rewrite limit');
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  return chunks.join('') + decoder.decode();
}

/**
 * Handles public page hosts and automatic entry URLs when storage is configured.
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @returns {Promise<Response | null>} Routed response.
 */
export async function handleAutoPage(request, env) {
  const url = new URL(request.url);
  const generated = isPageHost(url.hostname);
  const entry =
    url.hostname === 'fast.dxshelley.fun' && url.pathname === '/' && url.searchParams.has('target');
  if (!generated && !entry) return null;
  const map = /** @type {MappingNamespace | undefined} */ (env.PAGE_MAP);
  if (!map) return generated ? new Response('Page mapping unavailable', { status: 503 }) : null;
  if (String(env.XGET_PROXY_TARGET_ALLOWLIST).trim().toLowerCase() === 'true') {
    return generated
      ? new Response('Automatic public pages are disabled by the target allowlist', { status: 403 })
      : null;
  }
  if (!['GET', 'HEAD'].includes(request.method))
    return new Response('Public pages support GET and HEAD only', {
      status: 405,
      headers: { Allow: 'GET, HEAD' }
    });
  if (entry) {
    let target;
    try {
      target = publicTarget(url.searchParams.get('target') || '');
    } catch {
      return new Response('Invalid public page target', { status: 400 });
    }
    try {
      return Response.redirect(await registerPage(target, map), 302);
    } catch (error) {
      return new Response(
        error instanceof Error && error.message === 'Site label collision'
          ? 'Generated page host already maps to a different site'
          : 'Page mapping unavailable',
        { status: error instanceof Error && error.message === 'Site label collision' ? 409 : 503 }
      );
    }
  }
  const label = url.hostname.slice(0, -PAGE_SUFFIX.length);
  const legacy = /-(?:[a-f0-9]{32}|[a-z2-7]{8})$/.test(label);
  const cache = originCache(map);
  let storedTarget = legacy ? undefined : cache.get(label);
  if (!storedTarget) {
    const stored = await map.get(map.idFromName(label)).fetch('https://mapping/');
    if (!stored.ok) return new Response('Unknown public page', { status: 404 });
    storedTarget = await stored.text();
  }
  let target;
  try {
    target = publicTarget(storedTarget);
    const canonicalLabel = await pageLabel(target);
    if (legacy && canonicalLabel !== label) {
      if (!(await matchesLegacyLabel(target, label))) throw new Error('Invalid legacy mapping');
      const destination = await registerPage(new URL(target.origin), map);
      const pathname = url.pathname === '/' ? target.pathname : url.pathname;
      return Response.redirect(`${destination.origin}${pathname}${url.search}`, 302);
    }
    if (target.origin !== storedTarget || canonicalLabel !== label)
      throw new Error('Invalid mapping');
    rememberOrigin(cache, label, storedTarget);
    if (url.pathname === '/__xget/page-runtime.js')
      return new Response(PAGE_RUNTIME, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=300'
        }
      });
    if (url.pathname.startsWith(RESOURCE_PREFIX)) target = decodeResource(url);
    else {
      target.pathname = url.pathname;
      target.search = url.search;
    }
  } catch {
    return new Response('Invalid public resource', { status: 400 });
  }
  const headers = new Headers();
  for (const name of ['Accept', 'Accept-Language', 'Range', 'If-Range']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const upstream = await fetch(target.href, {
      method: request.method,
      headers,
      redirect: 'manual',
      signal: controller.signal
    });
    const resultHeaders = new Headers(upstream.headers);
    for (const name of [
      'Set-Cookie',
      'Content-Security-Policy',
      'Content-Security-Policy-Report-Only',
      'Report-To',
      'NEL',
      'Link',
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Credentials'
    ])
      resultHeaders.delete(name);
    resultHeaders.set('Cache-Control', 'private, no-store');
    resultHeaders.set('Referrer-Policy', 'no-referrer');
    resultHeaders.set('X-Content-Type-Options', 'nosniff');
    const location = upstream.headers.get('Location');
    if ([301, 302, 303, 307, 308].includes(upstream.status) && location !== null) {
      const next = publicTarget(new URL(location, target));
      resultHeaders.set(
        'Location',
        url.pathname.startsWith(RESOURCE_PREFIX)
          ? resourceUrl(next.href, target, url.origin)
          : next.origin === storedTarget
            ? siteUrl(next, url.origin)
            : (await registerPage(next, map)).href
      );
      resultHeaders.delete('Refresh');
      await upstream.body?.cancel();
      resultHeaders.delete('Content-Length');
      return new Response(null, { status: upstream.status, headers: resultHeaders });
    }
    const refresh = resultHeaders.get('Refresh');
    if (refresh) {
      const match = /^\s*([\d.]+)\s*;\s*url\s*=\s*['"]?(.*?)['"]?\s*$/i.exec(refresh);
      if (match)
        resultHeaders.set(
          'Refresh',
          `${match[1]};url=${navigationUrl(match[2], target, url.origin, storedTarget)}`
        );
      else resultHeaders.delete('Refresh');
    }
    const mime = resultHeaders.get('Content-Type') || '';
    const html = /text\/html|application\/xhtml\+xml/i.test(mime);
    const css = /text\/css/i.test(mime);
    const js = /(?:javascript|ecmascript)/i.test(mime);
    if (html)
      resultHeaders.set(
        'Content-Security-Policy',
        "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self' https://fast.dxshelley.fun; base-uri 'self'; object-src 'none'; worker-src 'none'; frame-ancestors 'none'"
      );
    if (upstream.status === 200 && request.method !== 'HEAD' && (html || css || js)) {
      const text = await readText(upstream);
      const body = html
        ? await rewriteHtml(text, target, url.origin, storedTarget)
        : css
          ? rewriteCss(text, target, url.origin)
          : rewriteModule(text, target, url.origin);
      for (const name of ['Content-Length', 'Content-Encoding', 'ETag', 'Last-Modified'])
        resultHeaders.delete(name);
      return new Response(body, { status: upstream.status, headers: resultHeaders });
    }
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: resultHeaders
    });
  } catch {
    return new Response('Public page upstream or rewriting failed', { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
