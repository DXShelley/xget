// Delivered as a separate same-origin script before upstream scripts execute.
export const PAGE_RUNTIME = String.raw`(() => {
  const script = document.currentScript;
  const base = script.dataset.upstream;
  const siteOrigin = new URL(base).origin;
  const prefix = '/__xget/page-resource/';
  const map = value => {
    if (!value || /^(data:|blob:|#)/i.test(String(value))) return value;
    if (String(value).startsWith(prefix)) return location.origin + value;
    const url = new URL(String(value), base);
    if (url.origin === siteOrigin && !url.pathname.startsWith('/__xget/')) return location.origin + url.pathname + url.search + url.hash;
    if (url.origin === location.origin) return url.href;
    if (url.protocol !== 'https:') throw new TypeError('Only public HTTPS resources are supported');
    const key = btoa(url.origin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    return location.origin + prefix + key + url.pathname + url.search + url.hash;
  };
  const originalFetch = window.fetch;
  window.fetch = (input, init) => originalFetch.call(window,
    input instanceof Request ? new Request(map(input.url), input) : map(input),
    { ...init, credentials: 'omit' });
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) { return open.call(this, method, map(url), ...args); };
  const resourceAttributes = new Set(['src', 'poster', 'component-url', 'renderer-url']);
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (resourceAttributes.has(name.toLowerCase()) || (this instanceof HTMLLinkElement && name.toLowerCase() === 'href')) value = map(value);
    return setAttribute.call(this, name, value);
  };
  for (const [ctor, property] of [[HTMLImageElement,'src'],[HTMLScriptElement,'src'],[HTMLLinkElement,'href'],[HTMLSourceElement,'src'],[HTMLMediaElement,'src'],[HTMLVideoElement,'poster'],[HTMLIFrameElement,'src']]) {
    const descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, property);
    if (descriptor && descriptor.set) Object.defineProperty(ctor.prototype, property, { ...descriptor, set(value) { descriptor.set.call(this, map(value)); } });
  }
  document.addEventListener('click', event => {
    const anchor = event.target.closest && event.target.closest('a[href],area[href]');
    if (!anchor || anchor.getAttribute('href').startsWith('#')) return;
    const target = new URL(anchor.href, base);
    if (target.origin === location.origin || target.hostname === 'fast.dxshelley.fun') return;
    if (target.origin === location.origin && target.pathname.startsWith(prefix)) {
      const rest = target.pathname.slice(prefix.length);
      const slash = rest.indexOf('/');
      const origin = atob(rest.slice(0, slash).replaceAll('-', '+').replaceAll('_', '/'));
      anchor.href = 'https://fast.dxshelley.fun/?target=' + encodeURIComponent(origin + rest.slice(slash) + target.search + target.hash);
    } else if (target.protocol === 'https:' && target.origin !== location.origin) {
      anchor.href = 'https://fast.dxshelley.fun/?target=' + encodeURIComponent(target.href);
    }
  }, true);
  document.addEventListener('submit', event => {
    const form = event.target;
    event.preventDefault();
    if (form.method.toLowerCase() !== 'get') return;
    const action = new URL(form.dataset.upstreamAction || base, base);
    action.search = new URLSearchParams(new FormData(form)).toString();
    if (action.origin === siteOrigin && !action.pathname.startsWith('/__xget/')) {
      location.assign(location.origin + action.pathname + '?' + action.searchParams.toString());
    } else location.assign('https://fast.dxshelley.fun/?target=' + encodeURIComponent(action.href));
  });
})();`;
