# GitHub Public Cookie Forwarding Implementation Plan

> **For agentic workers:** Execute this plan inline with a test checkpoint after each implementation step.

**Goal:** Forward the complete incoming Cookie header for GitHub Web requests, avoid shared caching for cookie-bearing responses, and measure whether this changes `/commits/main/` availability.

**Architecture:** Preserve the existing safe navigation-header filter, but forward the incoming `Cookie` header verbatim. Any request carrying Cookie bypasses Cloudflare shared caching so account-specific content and session state cannot be stored or served to another user. Keep all `Set-Cookie` headers removed at the response boundary.

**Tech Stack:** Cloudflare Workers `fetch`, JavaScript, Vitest, Wrangler, Prettier.

## Global Constraints

- Public GitHub Web browsing remains read-only.
- The incoming Cookie header is forwarded verbatim when present.
- Cookie-bearing responses must not use shared Cloudflare cache.
- Existing non-GitHub proxy behavior must remain unchanged.
- Only successful public responses may participate in shared caching.

### Task 1: Establish Cookie Policy Tests

**Files:**
- Modify: `test/unit/github-web.test.js`

- [x] Add tests proving the sanitizer forwards all Cookie values while still filtering Authorization, and does not preserve `Set-Cookie` after response finalization.
- [x] Add a test proving Cookie-bearing requests disable shared GitHub Web caching.
- [x] Run the focused test file and confirm the new tests fail before implementation.

### Task 2: Implement Sanitization and Cache Isolation

**Files:**
- Modify: `src/github/fetch.js`

- [x] Forward the incoming Cookie header without parsing or filtering cookie names.
- [x] Disable shared Cloudflare caching whenever the request contains Cookie.
- [x] Preserve existing request-header filtering, redirect behavior, retry behavior, and response handling.
- [x] Run the focused GitHub unit and feature tests.

### Task 3: Verify and Explore the Runtime Boundary

**Files:**
- Modify: `test/e2e/github-readonly-web.md`

- [x] Run format, lint, type-check, and focused tests; the full suite timed out in the Cloudflare Workers test pool without producing a failure report.
- [x] Compare production requests with no Cookie and a full Cookie header; both returned `429` on the currently deployed version, which predates this change.
- [x] Record status, cache headers, and the local error contract in `test/e2e/github-readonly-web.md`.
- [x] Record that `/gh/go-gitea/gitea/commits/main/` did not reach `200` in this environment; post-deployment verification remains required.
