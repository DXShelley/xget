# Web Adapter Credential Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep web-adapter credentials scoped to their primary upstream, validate site configuration keys, and protect these rules with response-level tests.

**Architecture:** `handleWebAdapterRequest` builds each upstream request after routing it to either the primary application Origin or an allowlisted resource Origin. Authorization is meaningful only to the primary application, while cookies remain host-scoped. Configuration is loaded from `config/sites.json`; its public routing keys must be unique before Maps are created.

**Tech Stack:** Cloudflare Workers, Node.js ESM, Vitest, JSON configuration, Markdown.

## Global Constraints

- Preserve browser authentication for a web adapter's `upstreamOrigin`.
- Never forward `Authorization` to a `resourceOrigins` entry.
- Keep every resource Origin exact and allowlisted.
- Reject duplicate configured mirror hosts, aliases, and upstream Origins at module initialization.

---

### Task 1: Credential Boundary Tests and Fix

**Files:**
- Modify: `test/unit/web-adapters.test.js`
- Modify: `src/web-adapters/handle-request.js`

**Interfaces:**
- Consumes: `handleWebAdapterRequest({ request, url })`.
- Produces: Main-origin requests preserve `Authorization`; resource-origin requests omit it while keeping only their own scoped cookies.

- [ ] Add one mocked Gemini main-origin request with `Authorization: Bearer primary-token` and assert the mocked fetch receives it.
- [ ] Add one mocked Gemini resource request to `/_site/resource/www.gstatic.com/app.js` with the same header and assert the mocked fetch does not receive it.
- [ ] Run `npm run test:run -- test/unit/web-adapters.test.js`; expect the resource assertion to fail before implementation.
- [ ] In `getRequestHeaders`, skip `authorization` when `upstreamUrl.origin !== route.site.upstreamOrigin`; pass the primary origin into the helper.
- [ ] Run the targeted test and expect all assertions to pass.

### Task 2: Configuration Validation

**Files:**
- Modify: `src/proxy/site-registry.js`
- Modify: `test/unit/site-registry.test.js`

**Interfaces:**
- Consumes: `config/sites.json` site definitions.
- Produces: deterministic startup failure for duplicate `id`, `mirrorHost`, configured `alias`, or `upstreamOrigin`.

- [ ] Extract a `validateSiteDefinitions(definitions)` function that throws an Error naming the duplicate key and value.
- [ ] Add focused tests with duplicate fixture values and retain a test that the actual configuration passes validation.
- [ ] Run `npm run test:run -- test/unit/site-registry.test.js` and expect all tests to pass.

### Task 3: Response and Documentation Coverage

**Files:**
- Modify: `test/unit/web-adapters.test.js`
- Modify: `docs/site-mirror-routing.zh-Hans.md`

**Interfaces:**
- Consumes: Google Identity's primary mirror registration and web-adapter response rewriting.
- Produces: a regression assertion that a Gemini redirect to Google Identity uses the identity mirror, and documentation stating Authorization is primary-Origin-only.

- [ ] Mock a Gemini upstream `302 Location: https://accounts.google.com/signin` and assert the returned Location is `https://google-identity.fast.dxshelley.fun/signin`.
- [ ] Update the credential boundary section to state that Cookie and Authorization are both scoped to exact upstream origins, with Authorization excluded from static resource requests.
- [ ] Run `npm run test:run -- test/unit/site-registry.test.js test/unit/web-adapters.test.js` and `git diff --check`.
