# GitHub Public Cookie Forwarding Implementation Plan

> **For agentic workers:** Execute this plan inline with a test checkpoint after each implementation step.

**Goal:** Forward only non-account GitHub preference cookies for public read-only Web requests, prevent account-related cookie persistence, and measure whether this changes `/commits/main/` availability.

**Architecture:** Add an explicit cookie allowlist to the GitHub Web request sanitizer. Build a deterministic cache variant from the allowlisted values so preference-specific upstream responses cannot share cache entries. Keep all `Set-Cookie` headers removed and never forward account, session, device, or unknown cookies.

**Tech Stack:** Cloudflare Workers `fetch`, JavaScript, Vitest, Wrangler, Prettier.

## Global Constraints

- Public GitHub Web browsing remains read-only.
- Account-related cookies must never be forwarded or stored.
- Existing non-GitHub proxy behavior must remain unchanged.
- Only successful public responses may participate in shared caching.

### Task 1: Establish Cookie Policy Tests

**Files:**
- Modify: `test/unit/github-web.test.js`

- [x] Add tests proving the sanitizer keeps only `cpu_bucket`, `preferred_color_mode`, and `tz`, removes session/account/device/unknown cookies, and does not preserve `Set-Cookie` after response finalization.
- [x] Add a test proving two different allowlisted cookie sets produce different GitHub Web cache keys.
- [x] Run the focused test file and confirm the new tests fail before implementation.

### Task 2: Implement Sanitization and Cache Isolation

**Files:**
- Modify: `src/github/fetch.js`

- [x] Parse the incoming Cookie header structurally rather than using substring replacement.
- [x] Forward only the explicit public preference allowlist.
- [x] Build a cache-key suffix from the normalized allowlisted cookie values, without adding raw account/session data to the key.
- [x] Preserve existing request-header filtering, redirect behavior, retry behavior, and response handling.
- [x] Run the focused GitHub unit and feature tests.

### Task 3: Verify and Explore the Runtime Boundary

**Files:**
- Modify: `test/e2e/github-readonly-web.md`

- [x] Run format, lint, type-check, and focused tests; the full suite timed out in the Cloudflare Workers test pool without producing a failure report.
- [x] Compare production requests with no Cookie, allowed preference cookies, and account/session cookies; all returned `429` on the currently deployed version.
- [x] Record status, cache headers, and the local error contract in `test/e2e/github-readonly-web.md`.
- [x] Record that `/gh/go-gitea/gitea/commits/main/` did not reach `200` in this environment; the live result remains an upstream/shared-egress rate-limit boundary.
