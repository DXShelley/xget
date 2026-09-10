const RECENT_TARGETS_KEY = 'xget.fast.recent-targets.v1';

/**
 * Escapes JSON embedded in an HTML script element.
 * @param {unknown} value
 * @returns {string} JSON that is safe to embed in a script element.
 */
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Creates the human-facing Fast proxy entry page.
 * @param {ReadonlyArray<{ alias?: string, id: string, upstreamOrigin: string }>} sites
 * @param {string[]} formActionOrigins Canonical mirror origins from the site registry.
 * @returns {Response} Entry page response.
 */
export function createProxyEntryResponse(sites, formActionOrigins = []) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const browserSites = sites.map(site => ({
    id: site.id,
    label: new URL(site.upstreamOrigin).hostname,
    target: site.upstreamOrigin
  }));
  const shortcuts = browserSites
    .map(
      site =>
        `<a class="shortcut" href="/?target=${encodeURIComponent(site.target)}"><span>${site.label}</span><small>打开</small></a>`
    )
    .join('');
  const contentSecurityPolicy = [
    "default-src 'none'",
    "base-uri 'none'",
    `form-action 'self' ${[...new Set(formActionOrigins)].join(' ')}`.trim(),
    "connect-src 'self'",
    "img-src 'self' data:",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'"
  ].join('; ');

  return new Response(
    `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Xget Fast</title>
  <style>
    :root { color: #e7edf2; background: #111820; font-family: Inter, "Microsoft YaHei UI", system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; background: #111820; }
    main { width: min(940px, calc(100% - 32px)); margin: clamp(28px, 8vh, 92px) auto; }
    .masthead { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 1px solid #34414d; padding-bottom: 16px; }
    h1 { margin: 0; color: #f4f8fb; font-size: 28px; font-weight: 700; letter-spacing: 0; }
    .badge, small, .eyebrow { color: #91a4b3; font-size: 12px; letter-spacing: 0; }
    .badge { color: #58d5cc; text-transform: uppercase; }
    .workbench { margin-top: 30px; padding: clamp(20px, 4vw, 38px); border: 1px solid #3c4a57; background: #17212b; }
    .eyebrow { margin: 0 0 12px; color: #f4bc5d; font-weight: 700; }
    h2 { margin: 0 0 20px; color: #f4f8fb; font-size: clamp(22px, 4vw, 34px); line-height: 1.15; letter-spacing: 0; }
    form { display: grid; grid-template-columns: 1fr auto; gap: 10px; }
    label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
    input { min-width: 0; height: 48px; border: 1px solid #50616f; border-radius: 4px; background: #0e151c; color: #f4f8fb; padding: 0 14px; font: inherit; }
    input::placeholder { color: #7890a2; }
    button { height: 48px; border: 1px solid #58d5cc; border-radius: 4px; background: #58d5cc; color: #0c151b; padding: 0 18px; font: inherit; font-weight: 700; cursor: pointer; }
    button:hover { background: #80e7df; }
    :focus-visible { outline: 3px solid #f4bc5d; outline-offset: 3px; }
    .quick { margin-top: 28px; }
    h3 { margin: 0 0 10px; color: #c6d2dc; font-size: 13px; font-weight: 700; }
    .shortcuts, .history-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .shortcut, .recent-link { display: flex; align-items: center; justify-content: space-between; min-height: 44px; border: 1px solid #34414d; border-radius: 4px; background: #141d26; color: #e7edf2; padding: 0 12px; text-decoration: none; }
    .shortcut:hover, .recent-link:hover { border-color: #58d5cc; }
    .history-grid { margin-top: 30px; grid-template-columns: minmax(0, 1.4fr) minmax(180px, .6fr); }
    .panel { min-height: 122px; border-top: 1px solid #34414d; padding-top: 14px; }
    .list { display: grid; gap: 7px; }
    .recent-link { overflow: hidden; }
    .recent-link span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ranking { margin: 0; padding: 0; list-style: none; }
    .ranking li { display: flex; justify-content: space-between; border-bottom: 1px solid #283541; padding: 8px 0; color: #c6d2dc; font-size: 13px; }
    .empty { color: #91a4b3; font-size: 13px; }
    .clear { border: 0; background: transparent; color: #91a4b3; padding: 0; font-size: 12px; text-decoration: underline; cursor: pointer; }
    @media (max-width: 620px) { main { width: min(100% - 24px, 940px); } form { grid-template-columns: 1fr; } button { width: 100%; } .shortcuts, .history-grid { grid-template-columns: 1fr; } .masthead { align-items: flex-start; gap: 12px; flex-direction: column; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; } }
  </style>
</head>
<body>
  <main>
    <header class="masthead"><h1>Xget / Fast</h1><span class="badge">受限代理入口</span></header>
    <section class="workbench" aria-labelledby="entry-title">
      <p class="eyebrow">已登记 HTTPS 站点</p>
      <h2 id="entry-title">输入目标地址</h2>
      <form id="target-form" action="/" method="get">
        <label for="target">目标 URL</label>
        <input id="target" name="target" type="url" inputmode="url" autocomplete="url" placeholder="https://code.claude.com/docs/zh-CN/quickstart" required>
        <button type="submit">访问</button>
      </form>
      <div class="quick"><h3>快捷访问</h3><nav class="shortcuts" aria-label="已登记站点">${shortcuts}</nav></div>
    </section>
    <section class="history-grid" aria-label="本机访问记录">
      <div class="panel"><h3>最近访问 <button class="clear" id="clear-history" type="button">清除</button></h3><div class="list" id="recent-list"><p class="empty">本机尚无记录</p></div></div>
      <div class="panel"><h3>常用域名</h3><ol class="ranking" id="domain-ranking"><li class="empty">暂无数据</li></ol></div>
    </section>
  </main>
  <script nonce="${nonce}">
    (() => {
      const storageKey = '${RECENT_TARGETS_KEY}';
      const allowedOrigins = new Set(${safeJson(browserSites.map(site => site.target))});
      const form = document.querySelector('#target-form');
      const input = document.querySelector('#target');
      const recentList = document.querySelector('#recent-list');
      const ranking = document.querySelector('#domain-ranking');
      const clearButton = document.querySelector('#clear-history');
      const read = () => { try { const items = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(items) ? items.filter(value => typeof value === 'string' && allowedOrigins.has(new URL(value).origin)) : []; } catch { return []; } };
      const write = items => localStorage.setItem(storageKey, JSON.stringify(items.slice(0, 8)));
      const render = () => {
        const items = read();
        recentList.replaceChildren(); ranking.replaceChildren();
        if (!items.length) { recentList.innerHTML = '<p class="empty">本机尚无记录</p>'; ranking.innerHTML = '<li class="empty">暂无数据</li>'; return; }
        items.forEach(target => { const link = document.createElement('a'); link.className = 'recent-link'; link.href = '/?target=' + encodeURIComponent(target); link.textContent = target; recentList.append(link); });
        const counts = items.reduce((result, target) => { const host = new URL(target).hostname; result.set(host, (result.get(host) || 0) + 1); return result; }, new Map());
        [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).forEach(([host, count]) => { const item = document.createElement('li'); item.innerHTML = '<span></span><strong></strong>'; item.firstChild.textContent = host; item.lastChild.textContent = String(count); ranking.append(item); });
      };
      form.addEventListener('submit', () => { try { const target = new URL(input.value); if (!allowedOrigins.has(target.origin) || target.username || target.password) return; const items = read().filter(item => item !== target.toString()); write([target.toString(), ...items]); } catch {} });
      clearButton.addEventListener('click', () => { localStorage.removeItem(storageKey); render(); });
      render();
    })();
  </script>
</body>
</html>`,
    {
      headers: {
        'Content-Security-Policy': contentSecurityPolicy,
        'Content-Type': 'text/html; charset=utf-8'
      }
    }
  );
}
