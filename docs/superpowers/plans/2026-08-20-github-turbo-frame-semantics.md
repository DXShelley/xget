# GitHub Turbo Frame Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve GitHub Turbo frame identifiers during public repository HTML rewriting so dynamic commit, branch, and tag metadata requests can run.

**Architecture:** Keep the existing Git protocol and public GitHub Web routes unchanged. Narrow the HTML URL-attribute matcher so `data-turbo-frame` remains an identifier while `data-turbo-frame-src` remains a rewritten URL.

**Tech Stack:** Cloudflare Workers, JavaScript ES modules, Vitest.

## Global Constraints

- Do not change Git protocol routing or transport.
- Do not proxy write methods in this change.
- Preserve existing rewriting for `data-turbo-frame-src` and ordinary repository links.

---

### Task 1: Preserve Turbo Frame IDs

**Files:**
- Modify: `src/github/rewrite.js`
- Test: `test/unit/github-web.test.js`

**Interfaces:**
- Consumes: `rewriteGithubHtml(html, origin)`.
- Produces: rewritten URLs while retaining literal `data-turbo-frame` identifier values.

- [x] **Step 1: Write the failing HAR-derived test**

```javascript
const rewritten = rewriteGithubHtml(
  '<a data-turbo-frame="repo-content-turbo-frame" href="/Homebrew/brew"></a>',
  'https://fast.example'
);
expect(rewritten).toContain('data-turbo-frame="repo-content-turbo-frame"');
expect(rewritten).toContain('href="https://fast.example/gh/Homebrew/brew"');
```

- [x] **Step 2: Run the focused test and verify failure**

Run: `npm run test:run -- test/unit/github-web.test.js`

- [x] **Step 3: Remove `data-turbo-frame` from the URL attribute matcher**

```javascript
const HTML_ATTRIBUTE_PATTERN =
  /(^|[\s<])((?:href|src|srcset|action|formaction|poster|cite|data-hovercard-url|data-turbo-frame-src|data-url)\s*=\s*)(["'])(.*?)\3/gim;
```

- [x] **Step 4: Run focused GitHub tests and verify pass**

Run: `npm run test:run -- test/unit/github-web.test.js test/features/github-web.test.js`

### Task 2: Verify the unchanged Git boundary

**Files:**
- Test: `test/features/git.test.js`
- Test: `test/unit/github-web.test.js`

**Interfaces:**
- Consumes: existing Git protocol and GitHub Web route tests.
- Produces: evidence that the Web rewrite fix does not alter Git handling.

- [x] **Step 1: Run Git and GitHub focused tests**

Run: `npm run test:run -- test/features/git.test.js test/unit/github-web.test.js test/features/github-web.test.js`

- [x] **Step 2: Run lint, type check, and touched-file formatting checks**

Run: `npm run lint; npm run type-check; npx prettier --check src/github/rewrite.js test/unit/github-web.test.js`

- [x] **Step 3: Review the exact diff**

Run: `git diff --check; git diff -- src/github/rewrite.js test/unit/github-web.test.js`
