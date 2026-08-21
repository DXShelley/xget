# Configured Proxy Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make configured-site proxying safe by default, capable for public Web browsing, and easy to use from the Fast entry page.

**Architecture:** Site configuration declares proxy policy and browser capabilities. The configured-site handler validates the request, applies timeout/retry only to safe methods, and passes responses through a generic same-origin finalizer. Full login, OAuth, WebSocket, and Service Worker support remain explicit site-adapter capabilities, not accidental behavior of the generic proxy.

**Tech Stack:** Cloudflare Workers, JavaScript ESM, Vitest, browser-native HTML/CSS/JavaScript.

## Global Constraints

- `target` resolves only exact configured HTTPS `upstreamOrigin` values.
- No proxy request may expose credentials, cookies, tokens, or request bodies in logs or client-side storage.
- Recent-target history remains browser-local and is opt-in through a user action.
- Existing platform and GitHub routes retain their behavior.
- Document changes require a timestamped backup before modification.

---

### Task 1: Enforce Configured-Site Request Policy

**Files:**
- Modify: `src/proxy/configured-adapter.js`, `src/proxy/handle-configured-site.js`
- Test: `test/unit/site-registry.test.js`

**Interfaces:**
- Produces `isConfiguredPathAllowed(site, pathname): boolean`.
- Enforces `proxyPolicy.paths: 'all' | string[]`, allowed methods, max body size, and a `no-store` default for configured requests.

- [ ] Write failing tests for allowed and denied path policies, denied methods, and an unchanged `all` policy.
- [ ] Run `npx vitest run test/unit/site-registry.test.js` and confirm the policy tests fail.
- [ ] Implement immutable policy normalization and enforce it before the upstream request.
- [ ] Run the same targeted test command and confirm it passes.

### Task 2: Add Safe Configured-Site Fetching and Response Finalization

**Files:**
- Create: `src/proxy/configured-response.js`
- Modify: `src/proxy/handle-configured-site.js`
- Test: `test/unit/site-registry.test.js`, `test/features/github-web.test.js`

**Interfaces:**
- Produces `fetchConfiguredUpstream(request, site, targetUrl): Promise<Response>`.
- Produces `finalizeConfiguredResponse({ request, response, site, targetUrl }): Promise<Response>`.
- Rewrites same-site `Location`; supplies `private, no-store` for dynamic content; drops unsafe transport headers.

- [ ] Write failing tests for same-site redirect rewriting, external redirect preservation, and configured-response no-store headers.
- [ ] Run target tests and confirm failures.
- [ ] Add AbortController timeout and bounded retry for GET/HEAD transient failures only; preserve POST body with no retry.
- [ ] Add response finalizer and run the targeted tests to confirm they pass.

### Task 3: Define Explicit Browser Capability Boundaries

**Files:**
- Modify: `src/proxy/configured-adapter.js`, `config/sites.json`, `docs/site-mirror-routing.zh-Hans.md`
- Test: `test/unit/site-registry.test.js`

**Interfaces:**
- Adds `browserCapabilities` with `rewriteSameOriginRedirects`, `browserStorage`, `oauth`, `webSocket`, and `serviceWorker` flags.
- Generic configured sites do not rewrite HTML/JS assets or emulate upstream cookies.

- [ ] Write a failing normalization test for default capability values.
- [ ] Implement defaults and mark current documentation sites as public, no-auth browsing adapters.
- [ ] Document when a site-specific adapter is mandatory and run the unit test.

### Task 4: Build the Fast Entry Experience

**Files:**
- Create: `src/proxy/entry-page.js`
- Modify: `src/app/handle-request.js`
- Test: `test/features/github-web.test.js`

**Interfaces:**
- Produces `createProxyEntryResponse(sites): Response`.
- The page exposes configured-site quick links, input validation, a browser-local recent list, and a local-only domain frequency ranking.

- [ ] Write a failing feature test for semantic entry controls, configured shortcuts, and the local-history script markers.
- [ ] Run the feature test and confirm it fails.
- [ ] Implement the responsive entry page: midnight ink, signal cyan and amber accents, compact workstation layout, keyboard-visible focus, and reduced-motion support.
- [ ] Store at most eight normalized, allowlisted target URLs in localStorage only after submit; derive rankings from that same local list.
- [ ] Run the feature test and confirm it passes.

### Task 5: Regression Coverage, Deployment Guardrails, and Documentation

**Files:**
- Modify: `test/features/github-web.test.js`, `test/unit/site-registry.test.js`, `docs/site-mirror-routing.zh-Hans.md`
- Create: `test/unit/configured-response.test.js`

- [ ] Add tests for URL credentials rejection, policy enforcement, redirect safety, timeout/retry classification, entry-page local-only history, and wildcard-route presence.
- [ ] Add documented Cloudflare WAF/rate-limit, TLS, DNS, and smoke-test operational requirements.
- [ ] Run targeted tests, `npm run lint`, Prettier checks, `git diff --check`, and a minimal public smoke request.

## Self-Review

- The design does not turn the Worker into an arbitrary open proxy.
- User history is never sent to the Worker beyond the normal submitted target and is never stored server-side.
- Browser-heavy site support is explicitly gated behind a dedicated adapter.
- Each policy or header behavior is paired with regression coverage and documentation.
