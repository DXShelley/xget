# Site Adapter Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce host-routed site adapters and request/response filter chains
while moving GitHub Web traffic to `git.dxshelley.fun` root paths.

**Architecture:** A site registry resolves explicit mirror hosts to dedicated or
configuration-backed adapters. The adapters add request and response filters
around the existing safe transports; existing platform protocol behavior remains
behind the Xget host so npm, PyPI, and container registries retain their tested
transformers.

**Tech Stack:** Cloudflare Workers, JavaScript ES modules, Vitest.

## Global Constraints

- GitHub Web no longer uses `/gh/*`; `git.dxshelley.fun/<path>` maps to
  `github.com/<path>`.
- `fast.dxshelley.fun` remains the existing Xget platform host.
- Unknown mirror hosts and unknown resource hosts are never proxied.
- Preserve all legal methods, bodies, CSRF context, Origin, Referer,
  Authorization, and host-scoped cookies.
- Write, run, and observe a failing test before each implementation task.

---

### Task 1: Adapter Registry and Filter Chain

**Files:**

- Create: `src/proxy/filter-chain.js`
- Create: `src/proxy/site-registry.js`
- Create: `src/proxy/configured-adapter.js`
- Create: `config/sites.json`
- Test: `test/unit/site-registry.test.js`

- [ ] Write tests that resolve `git.dxshelley.fun`, `claude.fast.dxshelley.fun`,
      and `code.claude.fast.dxshelley.fun`, reject an unknown host, and verify
      request/response filters execute in order.
- [ ] Run `npm run test:run -- test/unit/site-registry.test.js` and observe
      failure because modules do not exist.
- [ ] Implement the minimal registry, configuration adapter, and ordered filter
      runner.
- [ ] Run the focused test and observe pass.

### Task 2: GitHub Root-Host Adapter

**Files:**

- Modify: `src/github/config.js`
- Modify: `src/github/routing.js`
- Modify: `src/github/rewrite.js`
- Modify: `src/github/fetch.js`
- Modify: `src/github/handle-request.js`
- Test: `test/unit/github-web.test.js`
- Test: `test/features/github-web.test.js`

- [ ] Write root-host tests for Web, ZIP, Git smart HTTP, resource hosts, body
      forwarding, and rejecting `fast.dxshelley.fun`.
- [ ] Run focused GitHub tests and observe failure due to `/gh` routing.
- [ ] Implement host-first GitHub routing and root URL/Referer rewriting through
      the GitHub adapter.
- [ ] Run focused GitHub tests and observe pass.

### Task 3: Xget Host Boundary and Documentation

**Files:**

- Modify: `src/app/handle-request.js`
- Create: `docs/site-mirror-routing.zh-Hans.md`
- Test: `test/unit/site-registry.test.js`
- Test: `test/features/github-web.test.js`

- [ ] Write an integration test proving `fast.dxshelley.fun/npm/react` stays in
      the Xget pipeline.
- [ ] Run the focused test and observe the pre-change failure.
- [ ] Add explicit Xget host boundary handling and document custom-domain
      bindings, allowed hosts, credentials, cache and risk rules.
- [ ] Run focused integration tests and observe pass.

### Task 4: Complete Verification

**Files:**

- Verify: `src/`, `test/`, `docs/`

- [ ] Run `npm run test:run`.
- [ ] Run `npm run type-check`, `npm run lint`, and `npm run format:check`.
- [ ] Inspect `git diff --check` and final changed-file list before reporting
      results.
