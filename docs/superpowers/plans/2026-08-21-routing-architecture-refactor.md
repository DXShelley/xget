# Routing Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove confirmed compatibility wrappers and turn the Worker entry point into a small, ordered router over the current platform, GitHub, configured-site, Fast-entry, and credentialed Web-adapter layers.

**Architecture:** `src/app/handle-request.js` retains global CORS, error, security, performance, and platform-pipeline responsibilities. Fast entry routing moves into `src/proxy/fast-route.js`, while interactive Web-adapter precedence remains unchanged. Deprecated re-export modules are replaced by direct imports from their owning modules.

**Tech Stack:** Cloudflare Workers, JavaScript ESM, Vitest, TypeScript check-JS.

## Global Constraints

- Preserve request precedence: Web adapter, GitHub, configured-site, Fast entry, Docker/platform pipeline.
- Do not delete user-created untracked diagnostics, document backups, or unfinished plans.
- Do not broaden any upstream host, credential, Cookie, OAuth, WebSocket, or Service Worker policy.
- Retain all existing public Worker entry points and deployment adapters.

---

### Task 1: Extract Fast Entry Routing

**Files:**
- Create: `src/proxy/fast-route.js`
- Modify: `src/app/handle-request.js`
- Test: `test/features/github-web.test.js`

**Interfaces:**
- Produces `handleFastRoute(request, url): Promise<Response | null>`.
- Consumes configured-site target handling and registry lookup helpers.

- [ ] Write a feature test proving an unknown Fast route returns `null` to the platform router and an allowlisted `target` still redirects to the isolated Host.
- [ ] Run `npx vitest run test/features/github-web.test.js` and observe the extraction test fail before export exists.
- [ ] Move `FAST_PROXY_HOST`, canonical target construction, and all Fast root/path/isolated-host routing into `src/proxy/fast-route.js` without changing route outputs.
- [ ] Replace the old local function call with `handleFastRoute(request, url)`.
- [ ] Run `npx vitest run test/features/github-web.test.js` and confirm pass.

### Task 2: Simplify Main Dispatch

**Files:**
- Modify: `src/app/handle-request.js`
- Test: `test/unit/app-structure.test.js`, `test/features/github-web.test.js`

**Interfaces:**
- Produces `handleApplicationRoute({ request, url, env, config }): Promise<{ response: Response, isProxiedResponse: boolean } | null>`.
- Keeps platform resolution in the existing cache/fetch/finalize pipeline.

- [ ] Add a structural test asserting application routers are dispatched before the platform pipeline.
- [ ] Run the structural and feature tests; confirm the new helper test fails.
- [ ] Extract ordered Web-adapter, GitHub, configured-site and Fast-entry dispatch into one helper that returns `null` only when the platform pipeline owns the request.
- [ ] Run `npx vitest run test/unit/app-structure.test.js test/features/github-web.test.js` and confirm pass.

### Task 3: Delete Confirmed Compatibility Wrappers

**Files:**
- Delete: `src/config/platforms.js`, `test/helpers/test-utils.js`
- Modify: `test/unit/platform-boundaries.test.js`, `test/benchmark/performance.bench.js`

**Interfaces:**
- Tests import `PLATFORM_CATALOG` from `src/config/platform-catalog.js`, `SORTED_PLATFORMS` from `src/routing/platform-index.js`, and `transformPath` from `src/routing/platform-transformers.js`.
- Benchmark imports `TEST_URLS` from `test/helpers/generators.js`.

- [ ] Replace compatibility imports with direct imports and remove assertions that require obsolete wrappers.
- [ ] Run `rg -n "config/platforms\.js|helpers/test-utils\.js" src test` and confirm no remaining references.
- [ ] Delete the two wrappers.
- [ ] Run affected unit tests and TypeScript checking.

### Task 4: Document Architecture and Verify

**Files:**
- Modify: `docs/site-mirror-routing.zh-Hans.md`
- Test: `test/unit/site-registry.test.js`, `test/unit/web-adapters.test.js`

- [ ] Back up the document before modification.
- [ ] Document dispatch order and distinguish public configured-site from credentialed Web-adapter ownership.
- [ ] Run targeted tests, `npm run type-check`, `npm run lint`, Prettier check, `git diff --check`, and `npx wrangler deploy --dry-run`.

## Self-Review

- Fast-route extraction preserves all root, `target`, path-proxy, and isolated-host behavior.
- Main handler no longer embeds configuration routing details.
- No source import references deleted compatibility wrappers.
- Web adapters retain precedence and their credential-scoped behavior.
