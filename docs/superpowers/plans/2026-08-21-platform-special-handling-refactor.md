# Platform Special Handling Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move platform-specific routing and response handling out of generic utility and routing modules, centralize reusable filters, and delete replaced legacy modules without changing proxy behavior.

**Architecture:** `src/platforms/` owns only named-platform exceptions: path transformation and text response rewrites. `src/routing/` identifies a platform and builds its target URL; `src/response/` owns response lifecycle and invokes the platform response policy. `src/filters/` owns the generic ordered filter runner used by configured-site adapters, while Web and configured-site filters remain scoped to their adapter.

**Tech Stack:** Cloudflare Workers, JavaScript ESM, Vitest, TypeScript check-JS.

## Global Constraints

- Preserve all platform URLs, path rewrites, cache behavior, headers, and protocol handling.
- Do not broaden the configured-site Origin allowlist or its credential policy.
- Do not delete untracked diagnostics, existing plans, or document backups.
- Delete a legacy module only after all source and test imports point to its replacement.

---

### Task 1: Establish Platform Policy Ownership

**Files:**
- Create: `src/platforms/path-transformers.js`
- Create: `src/platforms/response-filters.js`
- Modify: `src/routing/resolve-target.js`
- Modify: `src/response/finalize-response.js`
- Test: `test/unit/platform-boundaries.test.js`
- Test: `test/unit/pipeline-modules.test.js`

**Interfaces:**
- `transformPlatformPath(path: string, platformKey: string): string` strips a known platform prefix and applies Crates or Jenkins normalization.
- `shouldFilterPlatformTextResponse(platform: string, requestPath: string, contentType: string): boolean` identifies NPM metadata, PyPI HTML, and Flatpak descriptors.
- `filterPlatformTextResponse(platform: string, requestPath: string, originalText: string, origin: string): string` rewrites only the documented platform response forms.
- `isOriginBoundPlatformResponse(platform: string, requestPath: string): boolean` reports whether cache entries vary by caller origin.

- [ ] Add boundary assertions for Jenkins, Crates, NPM, PyPI, and Flathub policy exports.
- [ ] Run `npx vitest run test/unit/platform-boundaries.test.js test/unit/pipeline-modules.test.js` and observe missing-module failure.
- [ ] Implement platform path and response policy modules with the existing behavior.
- [ ] Replace `resolve-target.js` and `finalize-response.js` imports with platform-policy imports.
- [ ] Run the two test files and confirm the existing URL and response rewrite assertions pass.

### Task 2: Put Generic Filters in Their Shared Layer

**Files:**
- Create: `src/filters/run-filters.js`
- Modify: `src/proxy/handle-configured-site.js`
- Modify: `test/unit/site-registry.test.js`

**Interfaces:**
- `runFilters<T>(context: T, filters: Array<(context: T) => T | Promise<T>>): Promise<T>` applies a supplied adapter filter chain in registration order.
- Configured-site request and response filter registration remains on the resolved site object.

- [ ] Change the site-registry test import to the shared filter module and retain the registration-order assertion.
- [ ] Run `npx vitest run test/unit/site-registry.test.js` and observe the missing-module failure.
- [ ] Move the unchanged generic filter runner into `src/filters/run-filters.js` and update configured-site imports.
- [ ] Run `npx vitest run test/unit/site-registry.test.js` and confirm configured-site credential and filter tests pass.

### Task 3: Remove Replaced Legacy Modules and Update Documentation

**Files:**
- Delete: `src/routing/platform-transformers.js`
- Delete: `src/utils/rewrite.js`
- Delete: `src/proxy/filter-chain.js`
- Modify: `test/platforms/crates.test.js`
- Modify: `test/platforms/homebrew.test.js`
- Modify: `test/platforms/flathub.test.js`
- Modify: `test/platforms/jenkins.test.js`
- Modify: `test/platforms/opensuse.test.js`
- Modify: `test/unit/platforms.test.js`
- Modify: `docs/site-mirror-routing.zh-Hans.md`

**Interfaces:**
- All callers import platform path policy from `src/platforms/path-transformers.js`.
- All callers import generic filter execution from `src/filters/run-filters.js`.
- No caller imports the deleted modules.

- [ ] Update tests to import the platform policy module directly.
- [ ] Run `rg -n "routing/platform-transformers|utils/rewrite|proxy/filter-chain" src test` and confirm only expected old imports remain before removal.
- [ ] Delete the three replaced modules once imports are migrated.
- [ ] Back up the routing document, then document `src/platforms/` and `src/filters/` ownership.
- [ ] Run platform, configured-site, static, and deployment verification.

## Self-Review

- Platform special cases are not imported by `src/app/handle-request.js`.
- Generic routing does not contain named-platform branching beyond platform identification.
- Configured-site filters remain adapter-scoped and execute in registration order.
- Deleted modules have no remaining source or test imports.
