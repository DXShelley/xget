# GitHub Read-only Web Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone, public read-only GitHub Web proxy that keeps repository browsing and search on `fast.dxshelley.fun`, redirects write/account operations to the canonical GitHub URL, and preserves all existing Xget platform routes.

**Architecture:** Add a `src/github/` module with route classification, read-only policy, upstream host allowlisting, shortcut resolution, and response URL rewriting. The main request handler checks this module before the existing platform router only for `/search` and browser HTML navigation under `/gh/...`; Git, downloads, and all other legacy requests continue through the existing pipeline unchanged. GitHub Web requests never forward cookies, authorization, or request bodies.

**Tech Stack:** Cloudflare Workers Web APIs, JavaScript ES modules, Vitest with `@cloudflare/vitest-pool-workers`, `agent-browser` for browser E2E.

## Global Constraints

- Preserve all existing `/gh/...`, GitLab, package, Docker, AI, and protocol proxy behavior.
- Public GitHub Web requests are read-only and anonymous; do not implement login, OAuth, cookies, or write APIs.
- The Web namespace is `/gh/...`; `GET /search?q=hermes` redirects to `/gh/DXShelley/xget` by default.
- GET/HEAD write or account paths redirect to `https://github.com`; mutating methods are never proxied.
- GitHub upstream hosts are fixed allowlisted hosts; user input cannot select an arbitrary upstream.
- Add tests before each implementation increment and run the focused test command before continuing.
- Update `README.zh-Hans.md` and a deployment/troubleshooting document with the final behavior and configuration.

---

### Task 1: Define GitHub Web route and policy contracts

**Files:**
- Create: `src/github/config.js`
- Create: `src/github/policy.js`
- Create: `src/github/routing.js`
- Test: `test/unit/github-web.test.js`

**Interfaces:**
- `getGithubWebShortcuts(env)` returns a normalized `{ [query: string]: string }` map and defaults `hermes` to `/DXShelley/hermes`.
- `classifyGithubWebRequest(request, url, env)` returns `{ kind: 'shortcut' | 'proxy' | 'redirect' | null, targetUrl?: string, upstreamUrl?: string }`.
- `getGithubUpstreamUrl(localPath, search)` only creates URLs for the GitHub Web allowlist.
- `isGithubWritePath(pathname, method)` identifies mutation, account, and write UI paths.

- [x] Add failing tests for shortcut matching, generic `/search`, repository paths, existing `/gh` preservation, write redirects, mutation-method redirects, and invalid paths.
- [x] Run `npm run test:run -- test/unit/github-web.test.js`; expect failures for missing module exports.
- [x] Implement the pure route/policy functions without changing `src/index.js` or `src/app/handle-request.js`.
- [x] Re-run the focused test; require all tests in the file to pass.

### Task 2: Implement read-only upstream transport

**Files:**
- Create: `src/github/fetch.js`
- Test: `test/unit/github-web.test.js`

**Interfaces:**
- `fetchGithubWeb({ request, targetUrl, config })` accepts only GET/HEAD, strips Cookie/Authorization/body, uses manual redirects, applies timeout/retry settings, and returns `{ response, responseGeneratedLocally }`.
- `getGithubRequestHeaders(request)` forwards only safe navigation headers such as `Accept`, `Accept-Language`, `User-Agent`, and GitHub navigation hints.

- [x] Add tests proving sensitive headers and request bodies are not forwarded, redirects remain observable, 5xx responses retry, and timeout becomes 408.
- [x] Run the focused test file and verify the new tests fail before implementation.
- [x] Implement transport using `fetch`, `AbortController`, and the existing config values; do not call the generic target resolver.
- [x] Run the focused test file and require all tests to pass.

### Task 3: Implement response and URL rewriting

**Files:**
- Create: `src/github/rewrite.js`
- Create: `src/github/response.js`
- Test: `test/unit/github-web.test.js`

**Interfaces:**
- `rewriteGithubUrl(value, origin)` maps GitHub Web URLs to the local origin, maps allowlisted asset/API hosts to `/_github/proxy/{host}/...`, and leaves unrelated external links unchanged.
- `rewriteGithubText(text, origin)` rewrites absolute GitHub URLs in HTML/JSON/text navigation payloads without rewriting unrelated domains.
- `finalizeGithubWebResponse({ response, request, origin })` rewrites `Location`, supported text bodies, CSP, removes `Set-Cookie`, and adds safe cache behavior.

- [x] Add tests for HTML attributes, absolute Web URLs, API/assets/raw/codeload aliases, external links, Location headers, CSP, Set-Cookie removal, and content length.
- [x] Run the focused test file and verify the new tests fail.
- [x] Implement narrowly scoped rewriting and an allowlisted proxy-host parser; reject unsupported hosts with 403/404.
- [x] Run the focused test file and require all tests to pass.

### Task 4: Integrate the standalone module without regressions

**Files:**
- Modify: `src/app/handle-request.js`
- Modify: `src/utils/security.js` only if shared header behavior must be extended
- Test: `test/index.test.js`
- Test: `test/unit/app-structure.test.js` if module wiring is covered there

- [x] Add Worker tests for `/search?q=hermes`, public repository browsing, local internal links, write redirects, and `/_github/proxy` allowlisted resources.
- [x] Run those tests before integration and confirm failures.
- [x] Add one early `handleGithubWebRequest` branch before the existing root/platform logic; return `null` for all legacy routes.
- [x] Preserve existing root, `/gh`, Git, Docker, package, and AI behavior unless a new GitHub Web path is explicitly claimed.
- [ ] Run the focused integration tests and then `npm run test:run` (full suite still contains existing real-network waits).

### Task 5: Browser E2E and two-attempt completeness gate

**Files:**
- Create: `test/e2e/github-readonly-web.md` with the executed checklist and observed results
- Modify: `docs/deployment-troubleshooting.zh-Hans.md`

- [x] Start the local Worker on an available port.
- [x] Use `agent-browser` to open the local domain and verify search, shortcut navigation, repository home, README/file links, branch/commit links, and back/forward behavior where the upstream was reachable.
- [x] Verify the Fork/Edit/New Issue/PR/Settings paths navigate to `github.com` and are not proxied.
- [x] Inspect the browser URL after each step and capture any external subresource or broken navigation.
- [x] Fix discovered gaps and repeat the complete E2E checklist once.
- [x] The second full attempt reproduced the upstream timeout; documented the exact limitation and skipped only the unavailable live read/resource checks.

### Task 6: Two-pass code review, fixes, and documentation

**Files:**
- Modify: implementation files identified by review
- Modify: `README.zh-Hans.md`
- Modify: `docs/deployment-troubleshooting.zh-Hans.md`

- [x] Review pass one for routing collisions, SSRF/open-proxy exposure, cache leaks, redirect method handling, header/body forwarding, and legacy regressions.
- [x] Fix every actionable finding and rerun focused tests.
- [x] Review pass two on the post-fix diff and test coverage.
- [x] Fix every new actionable finding and rerun focused tests.
- [ ] Run `npm run lint`, `npm run format:check`, `npm run test:run`, and `npm run type-check`.
- [x] Update documentation with URL patterns, `hermes` shortcut configuration, read-only scope, write redirect behavior, upstream allowlist, deployment variables, and known E2E limitations.
