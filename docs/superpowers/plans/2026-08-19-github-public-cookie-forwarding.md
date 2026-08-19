# GitHub REST Dynamic Data Implementation Plan

> **For agentic workers:** Execute this plan inline with a test checkpoint after each implementation step.

**Goal:** Revert the experiment that forwarded all Cookies, then serve repository metadata, commits, branches and tags through a cached GitHub REST API backed by an optional read-only GitHub App.

**Architecture:** Restore the prior public-preference Cookie policy for GitHub Web HTML requests. Route only repository REST metadata endpoints through a dedicated API transport; the browser keeps using the local rewritten API URL, while the Worker obtains an installation token server-side and caches successful JSON responses with status-aware TTLs. If App credentials are absent or unavailable, use anonymous GitHub API access as a compatibility fallback.

**Tech Stack:** Cloudflare Workers, Web Crypto RS256 JWT signing, GitHub REST API, JavaScript, Vitest, Wrangler.

## Global Constraints

- GitHub browsing remains read-only; mutation methods still redirect or reject.
- GitHub App credentials must never be sent to the browser or included in cache keys.
- Only successful API responses are edge-cacheable; `4xx`, `5xx` and rate-limit responses are not cached.
- Existing GitHub Web HTML, asset proxying, and non-GitHub routes remain unchanged.
- Required Worker secrets are `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY`.

### Task 1: Restore the Previous Cookie Behavior

**Files:**
- Modify: `src/github/fetch.js`
- Modify: `test/unit/github-web.test.js`
- Modify: `test/features/github-web.test.js`

- [x] Restore the explicit public preference Cookie allowlist and preference-specific Web cache variants from commit `74fa2d0`.
- [x] Restore tests proving account/session/device/unknown Cookies are not forwarded by GitHub Web HTML transport.
- [x] Run the focused GitHub tests and confirm the rollback is green.

### Task 2: Add GitHub App API Transport

**Files:**
- Create: `src/github/api.js`
- Modify: `src/config/index.js`
- Test: `test/unit/github-api.test.js`

- [x] Implement PKCS#8 PEM decoding, Web Crypto RS256 JWT signing, installation-token exchange, and per-isolate token expiry caching.
- [x] Send API requests with `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, and server-side Bearer authentication only when all App secrets are configured.
- [x] Use a cache key independent of user Cookies and `cacheTtlByStatus` that caches only `200-299` responses.
- [x] Retry transient `5xx` responses but never retry `429` or other `4xx` responses.
- [x] Add tests for anonymous fallback, App token exchange, cache options, and no token leakage.

### Task 3: Route Dynamic Repository Data to the API

**Files:**
- Modify: `src/github/routing.js`
- Modify: `src/github/handle-request.js`
- Modify: `test/unit/github-web.test.js`
- Modify: `test/features/github-web.test.js`

- [x] Recognize only safe `api.github.com/repos/{owner}/{repo}` metadata, `commits`, `branches`, and `tags` GET/HEAD paths as App-backed API requests.
- [x] Keep other allowlisted API resources on the existing generic proxy and keep all API writes rejected.
- [x] Pass the route through the dedicated API transport and existing JSON URL/CSP finalization.
- [x] Verify the browser-facing URL remains under `/_github/proxy/api.github.com/` and API JSON shape is unchanged.

### Task 4: Document Deployment and Verify Runtime

**Files:**
- Modify: `README.md`
- Modify: `test/e2e/github-readonly-web.md`

- [x] Document GitHub App permissions, installation scope, Worker secrets, cache TTL, and anonymous fallback behavior.
- [x] Verify local tests for commits, branches, tags and API rate-limit responses.
- [ ] After deployment, compare repository page network requests and confirm dynamic API responses remain on the local domain and return `200` without caching errors.
