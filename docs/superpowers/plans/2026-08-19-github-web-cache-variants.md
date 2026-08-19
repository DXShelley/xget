# GitHub Web Cache Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep GitHub Web HTML, JSON, and fragment responses in separate
edge-cache variants while preserving public GET cache performance.

**Architecture:** The GitHub Web fetch layer will classify the response
representation from the request's `Accept` and GitHub fetch headers. GET
requests will retain Cloudflare caching, but use a deterministic `cf.cacheKey`
suffix for the representation variant; PJAX/Turbo fragment targets get an
additional bounded container suffix; non-GET requests remain uncached. Static
assets continue using the same cache path, while HTML, JSON, and distinct
fragments cannot share a cache entry.

**Tech Stack:** Cloudflare Workers `fetch` with `cf.cacheKey`, JavaScript,
Vitest, Prettier, ESLint, TypeScript.

## Global Constraints

- Do not change the existing legacy proxy routes.
- Do not address the independent GitHub `/commits/main/` `429` issue.
- Preserve credential stripping and the exact browser-stats POST exception
  already implemented locally.
- Keep public GET caching enabled for performance.

### Task 1: Add cache-variant regression tests

**Files:**

- Modify: `test/unit/github-web.test.js`
- Modify: `test/features/github-web.test.js`

**Interfaces:**

- Consume: `fetchGithubWeb` and GitHub Web Worker routing.
- Produce: assertions that HTML and JSON requests use different cache keys while
  retaining GET cache options.

- [x] **Step 1: Write failing unit assertions** for HTML versus JSON cache keys
      and stable fragment classification.
- [x] \*\*Step 2: Run
      `npm run test:run -- test/unit/github-web.test.js test/features/github-web.test.js`
      and confirm the new assertions fail because no custom cache key exists.

### Task 2: Implement representation-aware cache keys

**Files:**

- Modify: `src/github/fetch.js`

**Interfaces:**

- Consume: incoming `Request` headers and the existing upstream target URL.
- Produce: a deterministic `cf.cacheKey` that appends a representation suffix
  such as `__xget_github_variant=html|json|fragment|fragment-%23repo|other` only
  to the Cloudflare cache key.

- [x] **Step 1: Add a small request-variant helper** that classifies JSON-only
      Accept requests as `json`, HTML/navigation requests as `html`, GitHub
      PJAX/Turbo requests as `fragment`, distinct PJAX/Turbo containers as
      bounded fragment variants, and the remaining GET requests as `other`.
- [x] **Step 2: Set `cf.cacheKey` only for GET requests** and keep
      `cacheEverything` and the configured TTL unchanged.
- [x] **Step 3: Run the focused tests and confirm they pass.**

### Task 3: Document and verify the cache contract

**Files:**

- Modify: `test/e2e/github-readonly-web.md`

**Interfaces:**

- Consume: the cache-variant behavior from `src/github/fetch.js`.
- Produce: an E2E record describing HTML/JSON cache isolation and the
  intentionally excluded `429` issue.

- [x] **Step 1: Add the cache-isolation evidence and expected behavior to the
      E2E record.**
- [x] **Step 2: Run `npm run format:check`, `npm run lint`,
      `npm run type-check`, and the focused GitHub tests.**
- [x] **Step 3: Review the diff for unintended route or cache-policy changes.**
