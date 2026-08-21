# Claude Code Docs Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Claude Code documentation mirror readable during transient upstream 5xx responses by serving a recently successful public response.

**Architecture:** Route only the registered `claude-code` alias through a dedicated wrapper inside `FastRoute`. The wrapper delegates normal fetching and URL rewriting to `ConfiguredAdapter`, stores successful anonymous GET responses in the Workers Cache API, and returns that cached response only after the configured upstream returns a retryable error or throws.

**Tech Stack:** Cloudflare Workers, Cache API, JavaScript, Vitest.

## Global Constraints

- Do not alter authentication, cookies, or caching behavior for other configured sites.
- Cache only anonymous `GET` responses for the Claude Code public documentation route.
- Preserve existing same-origin response rewriting before saving the fallback response.

---

### Task 1: Dedicated Claude Code Documentation Adapter

**Files:**
- Create: `src/claude-code-docs/handle-request.js`
- Modify: `src/proxy/fast-route.js`
- Test: `test/unit/claude-code-docs.test.js`

**Interfaces:**
- Consumes: `handleConfiguredTargetRequest(request, targetUrl)` and `getDefaultCache()`.
- Produces: `handleClaudeCodeDocsRequest({ request, site, targetUrl }): Promise<Response | null>`.

- [ ] Write tests that prove an unrelated site returns `null`, a successful `GET` is cached, and a later retryable failure returns the cached response.
- [ ] Run `npm run test:run -- test/unit/claude-code-docs.test.js` and confirm the new adapter import fails before implementation.
- [ ] Implement the adapter with a `claude-code` site-id guard, a GET-only cache key, cache writes for successful responses, and stale fallback for upstream `500`, `502`, `503`, `504`, or fetch errors.
- [ ] Invoke the adapter from `handleFastRoute` before the generic configured request; continue to the generic route when it returns `null`.
- [ ] Run `npm run test:run -- test/unit/claude-code-docs.test.js test/unit/fast-route.test.js` and confirm all tests pass.

### Task 2: Regression Documentation and Verification

**Files:**
- Modify: `docs/site-mirror-routing.zh-Hans.md`
- Test: `test/unit/claude-code-docs.test.js`

**Interfaces:**
- Consumes: the Claude Code adapter from Task 1.
- Produces: documented cache fallback boundary and executable regression coverage.

- [ ] Document that only public Claude Code documents receive a short-lived stale fallback after an upstream error; credentials remain disabled.
- [ ] Run `npm run type-check`, `npm run lint`, targeted unit tests, and `npm run test:workflows`.
- [ ] Run `npx gitnexus detect-changes --repo xget --scope staged` and `git diff --cached --check` before committing.
