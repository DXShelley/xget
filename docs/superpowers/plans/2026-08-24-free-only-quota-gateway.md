# Free-Only Quota Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated Cloudflare Worker that prevents its private R2 screenshot API from exceeding conservative Free-plan quotas.

**Architecture:** A public Worker authenticates requests, applies Cloudflare's local rate limiter, and reserves a worst-case resource vector in one SQLite-backed Durable Object before it calls R2. The Durable Object fails closed, keeps uncertain reservations consumed, and exposes a separate administrator-only kill switch.

**Tech Stack:** Cloudflare Workers, R2, SQLite-backed Durable Objects, Workers Rate Limiting binding, JavaScript ESM, Vitest, Wrangler 4.

## Global Constraints

- Add files only under `quota-gateway/` plus this plan; do not change the existing `xget` Worker, routes, or root Wrangler configuration.
- Use `Standard` R2 storage only; R2 must remain private and only be reachable through the gateway binding.
- Never use delayed billing data for real-time admission decisions.
- Unknown resources, malformed payloads, missing quota state, and Durable Object failures must deny requests.
- Treat a reservation as consumed after any possible downstream service call.

---

### Task 1: Define the quota domain model

**Files:**
- Create: `quota-gateway/src/quota-engine.js`
- Create: `quota-gateway/test/quota-engine.test.js`

**Interfaces:**
- Produces `createState(policy, period)`, `reserve(state, request)`, `releaseStorage(state, delta)`, and `setKillSwitch(state, enabled)`.
- `reserve()` returns `{ allowed, status, state, reason }` and does not mutate its input.

- [ ] **Step 1: Write failing tests** for monthly caps, daily caps, unknown resources, and the kill switch.
- [ ] **Step 2: Implement immutable quota validation and conservative reservation.**
- [ ] **Step 3: Run `npx vitest run quota-gateway/test/quota-engine.test.js`; expected output: all tests pass.**

### Task 2: Add the Durable Object and HTTP gateway

**Files:**
- Create: `quota-gateway/src/quota-gate.js`
- Create: `quota-gateway/src/security.js`
- Create: `quota-gateway/src/index.js`
- Create: `quota-gateway/test/security.test.js`

**Interfaces:**
- Consumes the quota engine interfaces from Task 1.
- Exposes private Durable Object endpoints `/reserve`, `/release-storage`, `/status`, and `/kill-switch`.
- Exposes Worker endpoints `PUT|GET|DELETE /v1/objects/:key`, `GET /v1/admin/status`, and `POST /v1/admin/kill-switch`.

- [ ] **Step 1: Write failing tests for bearer-token validation and object-key/content-length validation.**
- [ ] **Step 2: Implement the Durable Object with persistent state and fail-closed validation.**
- [ ] **Step 3: Implement Worker authentication, native rate limiting, quota reservation, and private R2 access.**
- [ ] **Step 4: Run targeted Vitest tests; expected output: all tests pass.**

### Task 3: Add deployment configuration and operations documentation

**Files:**
- Create: `quota-gateway/wrangler.toml`
- Create: `quota-gateway/package.json`
- Create: `quota-gateway/README.md`
- Create: `quota-gateway/.dev.vars.example`

**Interfaces:**
- Wrangler defines the R2, Durable Object, and Rate Limiting bindings required by `src/index.js`.
- README defines development, test, R2 activation, secret configuration, deployment, rollback, and incident procedures.

- [ ] **Step 1: Configure an isolated Worker and a SQLite Durable Object migration.**
- [ ] **Step 2: Document the architecture and the deployment sequence with Mermaid diagrams.**
- [ ] **Step 3: Run `npx wrangler deploy --dry-run --config quota-gateway/wrangler.toml`; expected output: successful bundle without remote mutation.**

### Task 4: Verify the deliverable

**Files:**
- Verify: `quota-gateway/**`

- [ ] **Step 1: Run Prettier check over the new JavaScript, TOML, and Markdown files.**
- [ ] **Step 2: Run the targeted Vitest suite.**
- [ ] **Step 3: Run Wrangler dry-run.**
- [ ] **Step 4: Run `npx gitnexus detect-changes --repo xget` and confirm only the isolated gateway and documentation are affected.**

## Self-Review

- Spec coverage: Tasks 1-2 implement the unified entry, atomic quota control, R2 path, rate limiter, kill switch, and fail-closed behavior. Task 3 supplies the Cloudflare development and deployment architecture. Task 4 validates the resulting artifact.
- Placeholder scan: all paths, interfaces, and commands are concrete; no unbounded service access is introduced.
- Type consistency: Worker calls the Durable Object endpoints defined in Task 2, and each endpoint consumes the Task 1 resource-vector format.
