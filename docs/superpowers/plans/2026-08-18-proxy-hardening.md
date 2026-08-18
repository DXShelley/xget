# Proxy Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Xget configuration, protocol authorization, timeout/retry behavior, cache observability, and upstream error exposure without disturbing the concurrent GitHub Web integration.

**Architecture:** Keep `src/app/handle-request.js` as the orchestration boundary and implement policy changes in the existing config, validation, upstream, cache, response, and utility modules. Cache status is derived from `PerformanceMonitor` marks so the current GitHub Web branch does not need another orchestration edit. Docker token requests accept the active attempt signal, while the standalone Docker auth endpoint owns a bounded controller and cleanup.

**Tech Stack:** JavaScript ES modules, Cloudflare Workers Web APIs, Vitest, JSDoc checked by TypeScript.

## Global Constraints

- Preserve the concurrent uncommitted GitHub Web changes and do not rewrite `src/app/handle-request.js` unless an interface requires it.
- Keep ordinary requests cacheable only when they are anonymous GET/HEAD requests.
- Keep Git, Git LFS, Docker, AI, and Hugging Face protocol requests out of the shared cache.
- Do not expose upstream response bodies in client-facing error messages.
- Do not add runtime dependencies or change the package lock.
- Verify with lint, type-check, focused tests where possible, and full test status before completion.

### Task 1: Bound Runtime Configuration

**Files:**
- Modify: `src/config/index.js`
- Test: `test/unit/utils.test.js`

- [x] Add tests for invalid, fractional, negative, zero, and over-limit numeric overrides plus filtering unsupported methods.
- [x] Implement strict integer parsing with explicit bounds: timeout 1..120 seconds, attempts 1..5, retry delay 0..10000 ms, cache TTL 0..86400 seconds, path length 256..8192.
- [x] Normalize allowed methods to the supported HTTP method allowlist and fall back when no valid method remains.
- [x] Run the focused config tests and type-check.

### Task 2: Harden Protocol Method Policy

**Files:**
- Modify: `src/utils/validation.js`
- Test: `test/unit/utils.test.js`, `test/unit/github-web.test.js`

- [x] Add tests proving ordinary configured methods are honored while protocol methods remain explicit and GitHub Web writes are rejected or redirected by its existing policy.
- [x] Replace the duplicated protocol method literal with a named immutable allowlist and ensure `OPTIONS` is handled only by the CORS preflight path.
- [x] Keep the GitHub Web adapter's explicit read-only classification intact.
- [x] Run focused validation tests.

### Task 3: Bound Docker and Upstream Time

**Files:**
- Modify: `src/protocols/docker.js`, `src/upstream/fetch-upstream.js`
- Test: `test/unit/protocols.test.js`, `test/unit/worker-regressions.test.js`

- [x] Add tests asserting Docker token fetch receives the active `AbortSignal`, standalone Docker auth times out, and retry delays do not exceed the request time budget.
- [x] Add optional signal support to `fetchToken`.
- [x] Pass the current upstream attempt signal through anonymous Docker token negotiation.
- [x] Bound standalone Docker auth with one controller and always clear its timer.
- [x] Bound upstream attempts and retry waits by a single request deadline while preserving existing 408/502 contracts.
- [x] Run focused protocol and regression tests.

### Task 4: Add Cache Status and Sanitize Errors

**Files:**
- Modify: `src/upstream/cache.js`, `src/utils/performance.js`, `src/response/finalize-response.js`
- Test: `test/unit/worker-regressions.test.js`, `test/unit/runtime-helpers.test.js`, `test/unit/pipeline-modules.test.js`
- Docs: `README.md`, `README.zh-Hans.md`

- [x] Add tests for `X-Cache-Status: HIT`, `MISS`, and `BYPASS` and for error bodies not being echoed to clients.
- [x] Mark cache bypass, miss, and hit states in the existing monitor.
- [x] Derive `X-Cache-Status` in `addPerformanceHeaders` without changing the current handler signature.
- [x] Return bounded generic upstream errors while logging only a sanitized diagnostic summary.
- [x] Update cache observability documentation to match the implementation.
- [x] Run focused response/cache tests.

### Task 5: Final Verification

**Files:**
- No source changes unless verification exposes a regression.

- [x] Run `npm run lint`.
- [x] Run `npm run type-check`.
- [x] Run `npm run format:check` and report any pre-existing repository-wide formatting failures.
- [x] Run the focused tests and `npm run test:run`; if the Windows Workers pool hangs, document the exact timeout and successful static checks.
- [x] Run `gitnexus detect-changes --scope all` and inspect the final diff for unintended changes.
