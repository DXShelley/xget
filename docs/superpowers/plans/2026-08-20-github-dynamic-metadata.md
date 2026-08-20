# GitHub Dynamic Metadata Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliably proxy GitHub repository commit, branch, and tag metadata while keeping read-only browsing anonymous and cache-safe.

**Architecture:** Preserve the existing read-only GitHub Web route, but explicitly carry the small set of GitHub React request-context headers observed in the HAR capture. Decode and rewrite JSON payloads structurally, including embedded HTML link fragments, so every same-origin repository URL remains under `/gh`.

**Tech Stack:** Cloudflare Workers Web APIs, JavaScript ES modules, Vitest.

## Global Constraints

- Only GET and HEAD repository metadata requests remain eligible for the Web proxy.
- Never forward `Cookie`, `Authorization`, request bodies, or browser cache validators upstream.
- Cache only anonymous public GET representations; bypass cache for requests carrying GitHub per-page verification context.
- Keep existing Git, Docker, package, and proxy-host routes unchanged.

---

### Task 1: Define GitHub metadata transport contract

**Files:**
- Modify: `src/github/fetch.js`
- Test: `test/unit/github-web.test.js`

**Interfaces:**
- Consumes: a browser `Request` and existing `fetchGithubWeb()` options.
- Produces: `getGithubRequestHeaders(request)` that forwards the approved React context headers and no credentials; `fetchGithubWeb()` cache options that bypass shared caching when a per-page nonce is present.

- [x] **Step 1: Write failing transport assertions**

```javascript
expect(headers.get('GitHub-Is-React')).toBe('true');
expect(headers.get('GitHub-Verified-Fetch')).toBe('true');
expect(headers.get('X-Fetch-Nonce')).toBe('v2:nonce');
expect(headers.get('Referer')).toBe('https://github.com/Homebrew/brew');
expect(headers.get('Cookie')).toBeNull();
```

- [x] **Step 2: Run the focused test and verify failure**

Run: `npm run test:run -- test/unit/github-web.test.js`

- [x] **Step 3: Implement the minimal allowlist and cache bypass**

```javascript
const GITHUB_METADATA_CONTEXT_HEADERS = new Set([
  'github-is-react', 'github-verified-fetch', 'referer', 'x-fetch-nonce'
]);
const canUseSharedCache = request.method === 'GET' && !request.headers.has('X-Fetch-Nonce');
```

- [x] **Step 4: Run the focused test and verify pass**

Run: `npm run test:run -- test/unit/github-web.test.js`

### Task 2: Rewrite metadata JSON paths and embedded links

**Files:**
- Modify: `src/github/rewrite.js`
- Modify: `src/github/response.js`
- Test: `test/unit/github-web.test.js`
- Test: `test/features/github-web.test.js`

**Interfaces:**
- Consumes: a JSON response body and local proxy origin.
- Produces: `rewriteGithubJson(text, origin)` that recursively rewrites relative GitHub paths and HTML-bearing string fields, without modifying unrelated external URLs.

- [x] **Step 1: Write failing JSON response assertions**

```javascript
expect(body).toContain('"url":"https://fast.example/gh/Homebrew/brew/commit/abc"');
expect(body).toContain('href="https://fast.example/gh/Homebrew/brew/commit/abc"');
expect(body).toContain('data-hovercard-url="https://fast.example/gh/Homebrew/brew/pull/1/hovercard"');
```

- [x] **Step 2: Run focused GitHub tests and verify failure**

Run: `npm run test:run -- test/unit/github-web.test.js test/features/github-web.test.js`

- [x] **Step 3: Parse and recursively transform valid JSON**

```javascript
export function rewriteGithubJson(text, origin) {
  const value = JSON.parse(text);
  return JSON.stringify(rewriteGithubJsonValue(value, origin));
}
```

- [x] **Step 4: Use JSON rewriting for `application/json` responses**

```javascript
body = contentType.includes('application/json')
  ? rewriteGithubJson(originalText, origin)
  : rewriteGithubText(originalText, origin);
```

- [x] **Step 5: Run focused GitHub tests and verify pass**

Run: `npm run test:run -- test/unit/github-web.test.js test/features/github-web.test.js`

### Task 3: Verify the regression boundary

**Files:**
- Test: `test/unit/github-web.test.js`
- Test: `test/features/github-web.test.js`

**Interfaces:**
- Consumes: the HAR-derived request headers and metadata response fixtures.
- Produces: coverage proving the three core metadata endpoints retain their routing and transport contract.

- [x] **Step 1: Add a parameterized endpoint routing test**

```javascript
for (const path of ['latest-commit', 'recently-touched-branches', 'branch-and-tag-count']) {
  expect(classifyGithubWebRequest(requestFor(path), urlFor(path))).toEqual({
    kind: 'proxy', upstreamUrl: `https://github.com/Homebrew/brew/${path}`
  });
}
```

- [x] **Step 2: Run the complete relevant verification set**

Run: `npm run format:check; npm run lint; npm run type-check; npm run test:run -- test/unit/github-web.test.js test/features/github-web.test.js`

- [x] **Step 3: Review the diff and confirm no unrelated route behavior changed**

Run: `git diff --check; git diff -- src/github/fetch.js src/github/rewrite.js src/github/response.js test/unit/github-web.test.js test/features/github-web.test.js`
