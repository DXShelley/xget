# Xget Shared Quota Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deployed `xget-fast` and `xget-git` Workers reserve a request
from `shotsync-quota-gateway` before processing, while preserving every
non-Cloudflare adapter unchanged.

**Architecture:** `handleRequest()` asks an optional `QUOTA_GATE` external
Durable Object binding for one `worker.requests` reservation. The binding is
configured only in the default Worker and the `git` environment, so Vercel,
Deno, and Pages environments without that binding immediately retain their prior
behavior. A failed or rejected reservation terminates locally before routing,
cache lookup, or any upstream fetch.

**Tech Stack:** Cloudflare Workers, cross-Worker Durable Object binding,
JavaScript ESM, Vitest, Wrangler 4.

## Global Constraints

- Bind both `xget-fast` and `xget-git` to `QuotaGate` in the deployed
  `shotsync-quota-gateway` script.
- Reserve exactly one `worker.requests` unit per accepted incoming Worker
  request, including CORS preflight requests.
- A missing binding is an explicit compatibility mode for non-Cloudflare
  deployments and must not change existing output.
- A malformed, unavailable, or non-successful quota-gate response must fail
  closed with a generic `503` response.
- An exhausted quota must return `429`, preserve a positive `Retry-After` value
  from the gate when supplied, and never execute application routing or upstream
  fetches.
- Do not change `git.dxshelley.fun` routing: it remains mapped directly to
  `xget-git`.

---

### Task 1: Add the optional Durable Object reservation client

**Files:**

- Create: `src/quota/reserve-worker-request.js`
- Create: `test/unit/quota-gate.test.js`

**Interfaces:**

- Produces `reserveWorkerRequest(env, now?)`, resolving to `null` when
  processing can continue or to a terminal `Response`.
- Consumes an optional binding with `idFromName(name)`, `get(id)`, and
  `fetch(input, init)` methods.

- [ ] **Step 1: Write failing tests** for absent bindings, successful
      reservations, quota denial, malformed responses, and binding errors.
- [ ] **Step 2: Run `npx vitest run test/unit/quota-gate.test.js`; expected
      output: tests fail because the module does not exist.**
- [ ] **Step 3: Implement a single purpose client that posts
      `{ id, period, day, deltas }` to the shared `global` object at
      `/reserve`.**
- [ ] **Step 4: Run `npx vitest run test/unit/quota-gate.test.js`; expected
      output: all tests pass.**

### Task 2: Guard shared application request processing

**Files:**

- Modify: `src/app/handle-request.js`
- Modify: `test/unit/worker-regressions.test.js`

**Interfaces:**

- Consumes `reserveWorkerRequest(requestContext.env)` before CORS, application
  routing, cache, or upstream code.
- Produces the existing response finalization behavior for admitted requests and
  terminal 429/503 responses for denied requests.

- [ ] **Step 1: Add a regression test proving a quota-denied request cannot
      invoke the upstream fetch mock.**
- [ ] **Step 2: Run the targeted regression test; expected output: it fails
      before the guard is wired.**
- [ ] **Step 3: Import and invoke the reservation client immediately after
      `createRequestContext()`, returning its terminal response through the
      normal CORS/security finalizer.**
- [ ] **Step 4: Run
      `npx vitest run test/unit/quota-gate.test.js test/unit/worker-regressions.test.js`;
      expected output: all tests pass.**

### Task 3: Configure both Cloudflare Worker deployments

**Files:**

- Modify: `wrangler.toml`

**Interfaces:**

- Provides `QUOTA_GATE` as an external Durable Object binding for both
  `xget-fast` and `xget-git`.
- Uses `class_name = "QuotaGate"` and `script_name = "shotsync-quota-gateway"`.

- [ ] **Step 1: Add a default `[[durable_objects.bindings]]` block and matching
      `[[env.git.durable_objects.bindings]]` block.**
- [ ] **Step 2: Run `npx wrangler deploy --dry-run --env git`; expected output:
      Wrangler bundles successfully and recognizes the external binding.**

### Task 4: Verify, deploy, and inspect

**Files:**

- Verify: `src/quota/reserve-worker-request.js`, `src/app/handle-request.js`,
  `wrangler.toml`, and tests.

- [ ] **Step 1: Run `npm run lint`, `npm run format:check`,
      `npm run type-check`, and `npm run test:run`.**
- [ ] **Step 2: Run `npx wrangler whoami`; expected output: the intended
      Cloudflare account is authenticated.**
- [ ] **Step 3: Run `npm run deploy:fast` and `npm run deploy:git`; expected
      output: each Worker receives a new version without changing its
      custom-domain route.**
- [ ] **Step 4: Run `npx wrangler deployments status` and
      `npx wrangler deployments status --env git`; expected output: both latest
      deployments are active.**
- [ ] **Step 5: Run `npx gitnexus detect-changes --repo xget` and inspect
      `git status --short` before any commit.**

## Self-Review

- Spec coverage: Tasks 1-2 enforce the shared atomic request budget in
  application processing; Task 3 applies it to both requested Cloudflare
  hostnames; Task 4 verifies local quality gates and production deployment.
- Placeholder scan: all paths, bindings, commands, resource names, and failure
  outcomes are concrete.
- Type consistency: both Worker environments provide the `QUOTA_GATE` shape
  consumed by `reserveWorkerRequest()`, and the function's `Response | null`
  return is consumed by `handleRequest()`.
