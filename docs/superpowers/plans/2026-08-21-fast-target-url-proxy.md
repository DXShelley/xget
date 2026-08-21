# Fast Target URL Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow browser access to allowlisted configured sites through `https://fast.dxshelley.fun/?target=<encoded-https-url>` without a DNS subdomain per upstream.

**Architecture:** On the root path of `fast.dxshelley.fun`, parse `target` before the homepage redirect. Match its exact HTTPS origin to an existing configured site, then reuse its method restrictions and filter chain. Targets outside that registry return `400`, preventing an open proxy.

**Tech Stack:** Cloudflare Workers, JavaScript ESM, Vitest.

## Global Constraints

- Canonical syntax: `https://fast.dxshelley.fun/?target=<encodeURIComponent(targetUrl)>`.
- Only `https` origins exactly matching a configured `upstreamOrigin` are accepted.
- Existing `/npm/*`, `/ip/*`, `/cr/*`, and `git.dxshelley.fun` behavior remains unchanged.
- Do not log credentials, cookies, tokens, or request bodies.

---

### Task 1: Resolve an Allowlisted Target

**Files:**
- Modify: `src/proxy/site-registry.js`
- Test: `test/unit/site-registry.test.js`

**Interfaces:**
- Produces: `resolveSiteByTargetUrl(targetUrl: URL): ConfiguredSite | null`.

- [ ] **Step 1: Write the failing test**

```js
it('resolves an exact configured upstream origin', () => {
  expect(resolveSiteByTargetUrl(new URL('https://code.claude.com/docs/zh-CN/quickstart'))).toMatchObject({ id: 'claude-code' });
  expect(resolveSiteByTargetUrl(new URL('https://example.com/'))).toBeNull();
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run test/unit/site-registry.test.js`

Expected: `resolveSiteByTargetUrl` is not exported.

- [ ] **Step 3: Implement the exact-origin lookup**

```js
const SITES_BY_UPSTREAM_ORIGIN = new Map(SITES.map(site => [site.upstreamOrigin, site]));

export function resolveSiteByTargetUrl(targetUrl) {
  return targetUrl.protocol === 'https:'
    ? SITES_BY_UPSTREAM_ORIGIN.get(targetUrl.origin) || null
    : null;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run test/unit/site-registry.test.js`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/site-registry.js test/unit/site-registry.test.js
git commit -m "feat(proxy): resolve configured target URLs"
```

### Task 2: Reuse the Configured Adapter for Target URLs

**Files:**
- Modify: `src/proxy/handle-configured-site.js`
- Test: `test/unit/site-registry.test.js`

**Interfaces:**
- Consumes: `resolveSiteByTargetUrl(targetUrl)`.
- Produces: `handleConfiguredTargetRequest(request, targetUrl): Promise<Response | null>`.

- [ ] **Step 1: Write the failing test**

```js
it('proxies an allowlisted target through the configured adapter', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream'));
  const response = await handleConfiguredTargetRequest(
    new Request('https://fast.dxshelley.fun/?target=https%3A%2F%2Fcode.claude.com%2Fdocs'),
    new URL('https://code.claude.com/docs')
  );
  expect(await response?.text()).toBe('upstream');
  expect(fetchSpy.mock.calls[0][0]).toBe('https://code.claude.com/docs');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run test/unit/site-registry.test.js`

Expected: `handleConfiguredTargetRequest` is not exported.

- [ ] **Step 3: Implement the shared adapter helper**

Extract the existing request-header, filter, and upstream-fetch block into `proxyConfiguredRequest(request, site, targetUrl)`. Add:

```js
export async function handleConfiguredTargetRequest(request, targetUrl) {
  const site = resolveSiteByTargetUrl(targetUrl);
  if (!site || !site.allowedMethods.includes(request.method)) return null;
  return proxyConfiguredRequest(request, site, targetUrl);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run test/unit/site-registry.test.js`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/handle-configured-site.js test/unit/site-registry.test.js
git commit -m "feat(proxy): proxy allowlisted target URLs"
```

### Task 3: Add the Fast Query Entry Point

**Files:**
- Modify: `src/app/handle-request.js`
- Test: `test/features/github-web.test.js`

**Interfaces:**
- Consumes: `handleConfiguredTargetRequest(request, targetUrl)`.
- Applies only when host is `fast.dxshelley.fun`, path is `/`, and `target` is present.

- [ ] **Step 1: Write failing integration tests**

```js
it('proxies code.claude.com through the fast target parameter', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('quickstart'));
  const target = encodeURIComponent('https://code.claude.com/docs/zh-CN/quickstart');
  const response = await worker.fetch(new Request(`https://fast.dxshelley.fun/?target=${target}`), {}, executionContext);
  expect(response.status).toBe(200);
  expect(fetchSpy.mock.calls[0][0]).toBe('https://code.claude.com/docs/zh-CN/quickstart');
});

it('rejects an unconfigured target before fetch', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const target = encodeURIComponent('https://example.com/');
  const response = await worker.fetch(new Request(`https://fast.dxshelley.fun/?target=${target}`), {}, executionContext);
  expect(response.status).toBe(400);
  expect(fetchSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run test/features/github-web.test.js`

Expected: the target URL follows the current root redirect or lacks a handler.

- [ ] **Step 3: Implement the root query branch**

Place this before the current root-path redirect:

```js
if (url.hostname === 'fast.dxshelley.fun' && url.pathname === '/' && url.searchParams.has('target')) {
  try {
    const targetUrl = new URL(url.searchParams.get('target'));
    const response = await handleConfiguredTargetRequest(request, targetUrl);
    return response || createErrorResponse('Invalid proxy target', 400);
  } catch {
    return createErrorResponse('Invalid proxy target', 400);
  }
}
```

- [ ] **Step 4: Run targeted verification**

Run: `npx vitest run test/unit/site-registry.test.js test/features/github-web.test.js`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/handle-request.js test/features/github-web.test.js
git commit -m "feat(proxy): add fast target URL entry point"
```

### Task 4: Document and Verify

**Files:**
- Modify: `docs/site-mirror-routing.zh-Hans.md`

- [ ] **Step 1: Document the canonical URL**

Add this concrete example and state that the target must be a configured HTTPS upstream:

```text
https://fast.dxshelley.fun/?target=https%3A%2F%2Fcode.claude.com%2Fdocs%2Fzh-CN%2Fquickstart
```

- [ ] **Step 2: Run full verification**

Run: `npm run test:run && npm run lint && npm run format:check`

Expected: all commands exit `0`.

- [ ] **Step 3: Commit**

```bash
git add docs/site-mirror-routing.zh-Hans.md
git commit -m "docs(proxy): document fast target URL entry point"
```

## Self-Review

- The plan implements the requested `fast.dxshelley.fun?target=` entry point.
- It retains fixed upstream origins and method limits, so it cannot proxy arbitrary URLs.
- The tasks use consistent `resolveSiteByTargetUrl` and `handleConfiguredTargetRequest` interfaces.
