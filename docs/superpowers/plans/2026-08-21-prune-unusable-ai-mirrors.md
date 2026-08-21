# Prune Unusable AI Mirrors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retain working Google/Gemini mirrors, move AI Studio to a TLS-compatible host, and remove unusable OpenAI, ChatGPT, and Cloud documentation mirrors.

**Architecture:** Site availability is declared in `config/sites.json`; the registry and web adapter consume that configuration without per-site code. Remove the disabled site records, rename only the AI Studio `mirrorHost` to the one-label hostname covered by the existing `*.fast.dxshelley.fun` route, then make the registry, adapter, and Chinese routing documentation describe only the retained services.

**Tech Stack:** Cloudflare Workers, Node.js ESM, Vitest, JSON configuration, Markdown documentation.

## Global Constraints

- Do not change generic proxy routing or relax any origin allowlist.
- Preserve Gemini, AI Studio, Google Identity, Google Developers, AI Google Developers, and Google public configurations.
- Remove all public web-mirror configuration and tests specifically for `openai-docs`, `chatgpt-web`, and `cloud-docs`.
- AI Studio must use `ai-studio.fast.dxshelley.fun`, which is matched by the existing `*.fast.dxshelley.fun` route.

---

### Task 1: Update Site Registration

**Files:**
- Modify: `config/sites.json`
- Test: `test/unit/site-registry.test.js`

**Interfaces:**
- Consumes: `resolveSiteByAlias(alias)`, `resolveSiteByProxyHost(host)`, and `resolveSiteByTargetUrl(url)` from `src/proxy/site-registry.js`.
- Produces: Registrations only for usable public and Gemini-related mirror origins.

- [ ] **Step 1: Write the failing registration expectations**

Replace the public-site list with only `google-dev-docs` and `google-public`; assert `cloud-docs` and `openai-docs` resolve to `null`; assert `ai-studio.fast.dxshelley.fun` resolves to site id `ai-studio` and the former two-label host resolves to `null`.

- [ ] **Step 2: Run the targeted registry test and verify failure**

Run: `npm run test:run -- test/unit/site-registry.test.js`

Expected: failure while obsolete site records and the former AI Studio hostname remain in `config/sites.json`.

- [ ] **Step 3: Apply the minimal registration change**

Delete the objects whose ids are `openai-docs`, `cloud-docs`, and `chatgpt-web`. Change AI Studio `mirrorHost` from `aistudio.google.fast.dxshelley.fun` to `ai-studio.fast.dxshelley.fun`.

- [ ] **Step 4: Run the targeted registry test and verify success**

Run: `npm run test:run -- test/unit/site-registry.test.js`

Expected: all registry tests pass.

### Task 2: Remove Obsolete Adapter Coverage

**Files:**
- Modify: `test/unit/web-adapters.test.js`

**Interfaces:**
- Consumes: `resolveWebAdapterRoute(request, url)` and `handleWebAdapterRequest(context)`.
- Produces: Web adapter coverage for Google/Gemini hosts only, with no test fixtures referring to OpenAI or ChatGPT web mirrors.

- [ ] **Step 1: Remove obsolete route and challenge tests**

Delete assertions and fixtures for `openai-docs`, `chatgpt-web`, `cdn.oaistatic.com`, `ab.chatgpt.com`, and Cloudflare challenge fallback. Retain Gemini and Google Identity route coverage. Add an AI Studio route assertion for `https://ai-studio.fast.dxshelley.fun/` mapping to `https://aistudio.google.com/`.

- [ ] **Step 2: Run the targeted adapter test**

Run: `npm run test:run -- test/unit/web-adapters.test.js`

Expected: all retained web adapter tests pass and no removed host appears in the file.

### Task 3: Align Documentation and Verify

**Files:**
- Modify: `docs/site-mirror-routing.zh-Hans.md`
- Test: `test/unit/site-registry.test.js`, `test/unit/web-adapters.test.js`, `test/unit/configured-response.test.js`, `test/unit/fast-route.test.js`

**Interfaces:**
- Consumes: the final entries in `config/sites.json` and Cloudflare route `*.fast.dxshelley.fun/*` in `wrangler.toml`.
- Produces: accurate public documentation and a verified configuration removal.

- [ ] **Step 1: Rewrite the AI mirror tables**

Remove OpenAI, ChatGPT, and Cloud documentation rows. Rename the AI Studio host to `ai-studio.fast.dxshelley.fun`. Remove the OpenAI Cloudflare-fallback and upstream-network-rejection sections; retain Google `/sorry` limitations.

- [ ] **Step 2: Validate static configuration references**

Run: `rg -n -i "openai-docs|chatgpt-web|chatgpt\.fast|cloud-docs|aistudio\.google\.fast" config src test docs -g "!*.backup*"`

Expected: no matches except unrelated API-proxy documentation that does not reference the removed web mirrors.

- [ ] **Step 3: Run focused regression tests**

Run: `npm run test:run -- test/unit/site-registry.test.js test/unit/web-adapters.test.js test/unit/configured-response.test.js test/unit/fast-route.test.js`

Expected: four test files pass with zero failed tests.

- [ ] **Step 4: Inspect change impact**

Run: `npx gitnexus detect-changes --repo xget`

Expected: only configuration, documentation, and their tests are reported; no unrelated execution flow changes.
