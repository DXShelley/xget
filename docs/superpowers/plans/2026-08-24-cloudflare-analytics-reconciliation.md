# Cloudflare Analytics Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Every hour reconcile the shared quota ledger against Cloudflare
GraphQL Analytics data and persist specific resource blocks when actual platform
use exceeds policy.

**Architecture:** A cron-triggered `scheduled()` handler addresses the one
shared `QuotaGate` Durable Object. The DO owns the once-per-hour guard, fetches
Workers and R2 aggregates through an account-scoped Analytics token, updates
local counters on success, and preserves a `platformExceeded` state; an
unavailable or malformed Analytics response leaves local conservative accounting
in force.

**Tech Stack:** Cloudflare Workers, SQLite-backed Durable Objects, Cloudflare
GraphQL Analytics API, JavaScript ESM, Vitest, Wrangler.

## Global Constraints

- The reconciliation path must never run on a user request.
- Analytics API failures must not clear a previously detected platform overage.
- A platform overage response must identify the concrete resource.
- Do not use R2 `list()` or a paid telemetry product to obtain the figures.
- Keep all existing manual kill-switch behavior unchanged.

### Task 1: Analytics client and tests

**Files:**

- Create: `quota-gateway/src/cloudflare-analytics.js`
- Create: `quota-gateway/test/cloudflare-analytics.test.js`

- [ ] Parse GraphQL Workers invocation totals, R2 storage totals, and R2 action
      groups into quota resources.
- [ ] Reject missing tokens, HTTP failures, GraphQL errors, and malformed
      payloads as reconciliation failures.
- [ ] Test valid aggregates, unknown R2 action conservatism, and invalid
      upstream responses.

### Task 2: Persistent reconciliation state

**Files:**

- Modify: `quota-gateway/src/quota-engine.js`
- Modify: `quota-gateway/src/quota-gate.js`
- Modify: `quota-gateway/test/quota-gate-state.test.js`

- [ ] Add `reconciliation` and `platformExceeded` state with
      backwards-compatible defaults.
- [ ] Add a serialized `/reconcile` endpoint that permits one Analytics attempt
      per UTC hour.
- [ ] Apply actual aggregates to their scope, block all later reservations for
      platform-exceeded resources, and only clear platform blocks after a later
      successful under-limit sample.
- [ ] Verify Analytics failure falls back to the existing local accounting
      rules.

### Task 3: Cron wiring and configuration

**Files:**

- Modify: `quota-gateway/src/index.js`
- Modify: `quota-gateway/wrangler.toml`
- Modify: `quota-gateway/test/quota-binding.test.js`

- [ ] Wire the hourly cron to the configured shared DO instance.
- [ ] Declare the hourly cron and bucket-name variable; retain the Analytics
      token as a Wrangler secret, not a variable.
- [ ] Test that scheduled events call `/reconcile` on the shared named instance.

### Task 4: Operational documentation and review

**Files:**

- Modify: `quota-gateway/README.zh-Hans.md`
- Modify: `quota-gateway/ARCHITECTURE.zh-Hans.md`

- [ ] Document token least privilege, one-hour cadence, aggregation delay,
      fallback, and status fields.
- [ ] Run the full gateway test suite, formatting check, Wrangler dry run, and
      GitNexus change detection.
