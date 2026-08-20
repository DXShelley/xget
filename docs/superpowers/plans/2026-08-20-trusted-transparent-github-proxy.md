# Trusted Transparent GitHub Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the GitHub Web route into a trusted, near-transparent GitHub mirror that preserves authenticated browser flows while rewriting GitHub navigation back through this Worker.

**Architecture:** Keep an explicit GitHub host allowlist and route every `/gh/*` navigation plus every `/_github/proxy/<host>/*` resource through it. Encode upstream host ownership into locally stored cookies, reconstruct only the matching host's `Cookie` header, preserve `Authorization`, bodies, CSRF-related headers, and rewrite response `Set-Cookie`, `Location`, HTML and JSON URLs for the mirror origin. Disable shared caching for authenticated traffic and all non-idempotent methods.

**Tech Stack:** Cloudflare Workers, Fetch API, JavaScript ESM, Vitest.

## Global Constraints

- Accept every syntactically valid HTTP method for trusted GitHub routes and forward its body without retrying consumed streams.
- Credentials must only be forwarded to the explicit GitHub host allowlist.
- Preserve `Origin`, normalize mirror `Referer` to the matching upstream host, and preserve GitHub CSRF request headers.
- Rewrite every upstream `Set-Cookie` to a mirror-origin, host-scoped cookie name; never return upstream GitHub `Domain` attributes.
- Route `https` and `wss` GitHub URLs in HTML, JSON, redirect, CSP, and WebSocket upgrade targets through the mirror.
- Add the failing test before each implementation change, run it, implement, and rerun it before continuing.

---

### Task 1: Trusted Host And Route Model

**Files:**
- Modify: `src/github/config.js`
- Modify: `src/github/routing.js`
- Test: `test/unit/github-web.test.js`

**Interfaces:**
- Produces: `isTrustedGithubHost(host)` and `classifyGithubWebRequest(request, url, env)` with `{ kind: 'proxy', upstreamHost, upstreamUrl, forwardBody: boolean }`.
- Consumes: `GITHUB_PROXY_HOSTS` and the `/gh`, `/_github/proxy/<host>` mirror namespaces.

- [ ] **Step 1: Write failing route tests**

```javascript
expect(classifyGithubWebRequest(new Request('https://mirror/gh/login', { method: 'POST' }), new URL('https://mirror/gh/login'))).toMatchObject({ kind: 'proxy', upstreamHost: 'github.com', forwardBody: true });
expect(classifyGithubWebRequest(new Request('https://mirror/_github/proxy/uploads.github.com/user/repo', { method: 'PUT' }), new URL('https://mirror/_github/proxy/uploads.github.com/user/repo'))).toMatchObject({ kind: 'proxy', upstreamHost: 'uploads.github.com', forwardBody: true });
```

- [ ] **Step 2: Run the route test to verify it fails**

Run: `npm run test:run -- test/unit/github-web.test.js`
Expected: FAIL because mutations and the upload host are rejected.

- [ ] **Step 3: Implement the trusted route model**

```javascript
return { kind: 'proxy', upstreamHost, upstreamUrl, forwardBody: !['GET', 'HEAD'].includes(method) };
```

- [ ] **Step 4: Run the route test to verify it passes**

Run: `npm run test:run -- test/unit/github-web.test.js`
Expected: PASS.

### Task 2: Credential, CSRF, And Body Transport

**Files:**
- Modify: `src/github/fetch.js`
- Test: `test/unit/github-web.test.js`

**Interfaces:**
- Consumes: `getGithubRequestHeaders(request, upstreamHost)`.
- Produces: `fetchGithubWeb({ request, targetUrl, upstreamHost, config, forwardBody })` with credentials only for `upstreamHost`.

- [ ] **Step 1: Write failing transport tests**

```javascript
expect(headers.get('Authorization')).toBe('Bearer token');
expect(headers.get('Cookie')).toBe('_gh_sess=session');
expect(headers.get('Origin')).toBe('https://github.com');
expect(fetchOptions.body).not.toBeUndefined();
```

- [ ] **Step 2: Run the transport test to verify it fails**

Run: `npm run test:run -- test/unit/github-web.test.js`
Expected: FAIL because credentials and Origin are currently removed.

- [ ] **Step 3: Implement scoped forwarding**

```javascript
headers.set('Cookie', getGithubCookieHeader(request.headers.get('Cookie'), upstreamHost));
headers.set('Authorization', request.headers.get('Authorization'));
```

- [ ] **Step 4: Run the transport test to verify it passes**

Run: `npm run test:run -- test/unit/github-web.test.js`
Expected: PASS.

### Task 3: Set-Cookie And Structured Response Rewriting

**Files:**
- Create: `src/github/cookies.js`
- Modify: `src/github/response.js`
- Modify: `src/github/rewrite.js`
- Test: `test/unit/github-web.test.js`

**Interfaces:**
- Produces: `rewriteGithubSetCookie(value, upstreamHost)` and `appendGithubSetCookies(headers, responseHeaders, upstreamHost)`.
- Consumes: `rewriteGithubHtml`, `rewriteGithubJson`, `rewriteGithubLocation`, and trusted host configuration.

- [ ] **Step 1: Write failing response tests**

```javascript
expect(response.headers.get('Set-Cookie')).toContain('__xget_gh_github_com__gh_sess=abc');
expect(response.headers.get('Set-Cookie')).not.toContain('Domain=github.com');
expect(rewriteGithubLocation('wss://live.github.com/socket', origin)).toContain('/_github/proxy/live.github.com/socket');
```

- [ ] **Step 2: Run the response test to verify it fails**

Run: `npm run test:run -- test/unit/github-web.test.js`
Expected: FAIL because cookies are discarded and WebSocket URLs are not rewritten.

- [ ] **Step 3: Implement cookie and URL response rewriting**

```javascript
headers.append('Set-Cookie', rewriteGithubSetCookie(setCookie, upstreamHost));
```

- [ ] **Step 4: Run the response test to verify it passes**

Run: `npm run test:run -- test/unit/github-web.test.js`
Expected: PASS.

### Task 4: Worker Integration And Regression Coverage

**Files:**
- Modify: `src/github/handle-request.js`
- Test: `test/features/github-web.test.js`
- Test: `test/unit/github-web.test.js`

**Interfaces:**
- Consumes: trusted route host metadata, scoped transport, and response finalization with `upstreamHost`.
- Produces: authenticated GitHub mirror response with private no-store cache policy.

- [ ] **Step 1: Write failing end-to-end tests**

```javascript
expect(fetchSpy).toHaveBeenCalledWith('https://github.com/session', expect.objectContaining({ method: 'POST' }));
expect(await response.text()).toContain('https://mirror/gh/owner/repo');
```

- [ ] **Step 2: Run feature tests to verify they fail**

Run: `npm run test:run -- test/features/github-web.test.js test/unit/github-web.test.js`
Expected: FAIL because the route host is not passed through the pipeline.

- [ ] **Step 3: Wire route metadata and cache policy**

```javascript
response: await finalizeGithubWebResponse({ response, origin: url.origin, upstreamHost: route.upstreamHost })
```

- [ ] **Step 4: Run focused and full verification**

Run: `npm run test:run -- test/features/github-web.test.js test/unit/github-web.test.js && npm run lint && npm run format:check && npm run type-check && npm run test:run`
Expected: all commands exit 0.
