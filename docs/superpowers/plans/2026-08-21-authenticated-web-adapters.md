# Authenticated Web Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dedicated, host-isolated adapters for ChatGPT Web, Gemini Web/AI Studio, and Google Identity login without exposing a generic authenticated proxy.

**Architecture:** A central immutable registry declares one primary Origin and explicit resource Origins per adapter. A dedicated request handler recognizes only the adapter's isolated mirror host or its resource namespace, scopes mirror cookies by upstream host, forwards bodies only to trusted hosts, and rewrites same-site navigation/resource URLs. It disables shared caching and preserves no untrusted host routing paths.

**Tech Stack:** Cloudflare Workers, JavaScript ESM, JSON configuration, Vitest.

## Global Constraints

- Never proxy an arbitrary host, suffix wildcard, or API Origin.
- Cookies and Authorization may only be sent to the exact selected upstream host.
- Authenticated responses must be `private, no-store`.
- Do not add OpenAI Console, Google Cloud Console, or API routes.
- Preserve all existing user worktree changes.

---

### Task 1: Define Adapter Origins And Safe Routing

**Files:**
- Create: `src/web-adapters/config.js`
- Create: `src/web-adapters/routing.js`
- Test: `test/unit/web-adapters.test.js`

**Interfaces:**
- Produces: `resolveWebAdapterRoute(request, url): { site, upstreamUrl, upstreamHost, forwardBody } | null`.

- [ ] **Step 1: Write failing tests for primary and resource routes**

```js
expect(resolveWebAdapterRoute(new Request('https://chatgpt.fast.dxshelley.fun/'), url)).toMatchObject({
  site: { id: 'chatgpt-web' }, upstreamUrl: 'https://chatgpt.com/'
});
expect(resolveWebAdapterRoute(new Request('https://chatgpt.fast.dxshelley.fun/_site/resource/evil.example/x'), url)).toBeNull();
```

- [ ] **Step 2: Run focused test to verify failure**

Run: `npm test -- --run test/unit/web-adapters.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement immutable exact-origin site definitions and path validation**

```js
export const WEB_ADAPTER_SITES = Object.freeze([Object.freeze({
  id: 'chatgpt-web',
  mirrorHost: 'chatgpt.fast.dxshelley.fun',
  upstreamOrigin: 'https://chatgpt.com',
  resourceOrigins: Object.freeze(['https://cdn.oaistatic.com', 'https://files.oaiusercontent.com'])
})]);
```

- [ ] **Step 4: Run focused test to verify pass**

Run: `npm test -- --run test/unit/web-adapters.test.js`

Expected: PASS.

### Task 2: Implement Credential-Scoped Transport And Rewriting

**Files:**
- Create: `src/web-adapters/transport.js`
- Create: `src/web-adapters/response.js`
- Test: `test/unit/web-adapters.test.js`

**Interfaces:**
- Consumes: a route from `resolveWebAdapterRoute`.
- Produces: `handleWebAdapterRequest({ request, url }): Promise<Response | null>`.

- [ ] **Step 1: Add failing cookie, Location, and unknown-host tests**

```js
expect(upstreamHeaders.get('Cookie')).toBe('session=abc');
expect(response.headers.get('Set-Cookie')).toContain('__xget_web_chatgpt_com__session=abc');
expect(response.headers.get('Location')).toBe('https://chatgpt.fast.dxshelley.fun/next');
```

- [ ] **Step 2: Implement host-prefixed Cookie conversion and request sanitization**

```js
const prefix = `__xget_web_${host.replace(/[^a-z0-9]/gi, '_')}__`;
headers.set('Cookie', scopedCookies(request.headers.get('Cookie'), host));
```

- [ ] **Step 3: Implement text response URL, Location, CSP, and Set-Cookie rewriting**

```js
headers.set('Cache-Control', 'private, no-store');
headers.delete('Content-Length');
headers.delete('Set-Cookie');
```

- [ ] **Step 4: Run focused test to verify pass**

Run: `npm test -- --run test/unit/web-adapters.test.js`

Expected: PASS.

### Task 3: Integrate Configuration, Handler, And Documentation

**Files:**
- Modify: `config/sites.json`
- Modify: `src/app/handle-request.js`
- Modify: `docs/site-mirror-routing.zh-Hans.md`
- Test: `test/unit/web-adapters.test.js`

**Interfaces:**
- Consumes: `handleWebAdapterRequest({ request, url })` before configured-site routing.
- Produces: isolated hosts for `chatgpt-web`, `gemini-web`, `ai-studio`, and `google-identity`.

- [ ] **Step 1: Add failing integration tests**

```js
const response = await worker.fetch(new Request('https://gemini.fast.dxshelley.fun/'), {}, executionContext);
expect(fetchSpy).toHaveBeenCalledWith('https://gemini.google.com/', expect.any(Object));
```

- [ ] **Step 2: Register adapter metadata and call handler before `ConfiguredAdapter`**

```js
const webAdapterResponse = await handleWebAdapterRequest({ request, url });
if (webAdapterResponse) return webAdapterResponse;
```

- [ ] **Step 3: Backup and update routing documentation**

Document primary mirror hosts, exact resource Origins, cookie isolation, and exclusions.

- [ ] **Step 4: Run verification**

Run: `npm run lint && npm test -- --run test/unit/web-adapters.test.js`

Expected: lint exit code 0 and all web-adapter tests passing.
