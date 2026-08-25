# Hourly Quota Enforcement Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Make per-request quota reservations optional and make hourly GraphQL
reconciliation the deployed default for Xget and ShotSync.

**Architecture:** `QUOTA_ENFORCEMENT_MODE` selects `request` or `hourly`. Both
application Workers bypass their existing Durable Object reservation and release
calls in hourly mode; the separately deployed quota gateway retains its hourly
cron to maintain the account-level platform overage record.

**Tech Stack:** Cloudflare Workers, Durable Objects, JavaScript, TypeScript,
Vitest, Wrangler.

## Global Constraints

- Default missing or invalid mode to `hourly`.
- Preserve `request` mode behavior exactly for operators requiring immediate
  local admission control.
- Do not modify routes, domains, R2 objects, Durable Object instance names, or
  secrets.
- Document that hourly mode trades immediate enforcement for lower request
  latency and lower DO usage.

### Task 1: Xget mode gate

**Files:**

- Modify: `src/quota/reserve-worker-request.js`
- Modify: `test/unit/quota-gate.test.js`
- Modify: `wrangler.toml`

- [ ] Add a failing test proving the hourly default does not call the DO
      binding.
- [ ] Add mode selection and set `QUOTA_ENFORCEMENT_MODE = "hourly"` for fast
      and git deployments.
- [ ] Run targeted quota tests.

### Task 2: ShotSync mode gate

**Files:**

- Modify: `E:/linshi/shotsync/src/quota.ts`
- Modify: `E:/linshi/shotsync/src/responses.ts`
- Modify: `E:/linshi/shotsync/test/routing.test.ts`
- Modify: `E:/linshi/shotsync/wrangler.toml`

- [ ] Add a failing test proving hourly mode bypasses the exhausted DO response.
- [ ] Skip reservations and storage releases in hourly mode; retain request
      behavior when configured.
- [ ] Run ShotSync tests.

### Task 3: Documentation and deployment

**Files:**

- Modify: `quota-gateway/ARCHITECTURE.zh-Hans.md`
- Modify: `quota-gateway/README.zh-Hans.md`

- [ ] Document both modes and their safety tradeoff.
- [ ] Verify formatting, tests, dry runs, authenticated account, then deploy
      quota gateway, Xget fast/git, and ShotSync.
