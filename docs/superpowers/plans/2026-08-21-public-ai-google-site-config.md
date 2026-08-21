# Public AI and Google Site Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register public OpenAI and Google documentation origins, plus an optional public Google landing/search origin, as configuration-backed proxy sites.

**Architecture:** Add one exact HTTPS Origin per public upstream in `config/sites.json`, using the existing `ConfiguredAdapter` defaults: isolated origin, `GET`/`HEAD`, credentials disabled, and no dynamic application support. Extend registry tests to prove each registered origin resolves while untrusted lookalikes remain rejected.

**Tech Stack:** Cloudflare Workers, JavaScript ESM, JSON configuration, Vitest.

## Global Constraints

- Register exact Origins only; no suffix or wildcard domain matching.
- Only public, anonymous browsing belongs in `ConfiguredAdapter`.
- Do not add `googleapis.com`, API endpoints, ChatGPT, Gemini Web, or Google login in this change.
- Preserve all existing user worktree changes.

---

### Task 1: Register Public Sites

**Files:**
- Modify: `config/sites.json`
- Test: `test/unit/site-registry.test.js`

**Interfaces:**
- Consumes: `createConfiguredAdapter(site)` from `src/proxy/configured-adapter.js`.
- Produces: `resolveSiteByAlias(alias)` and `resolveSiteByTargetUrl(url)` entries for registered public sites.

- [ ] **Step 1: Write the failing registry assertions**

```js
expect(resolveSiteByAlias('openai-docs')).toMatchObject({
  upstreamOrigin: 'https://openai.com'
});
expect(resolveSiteByTargetUrl(new URL('https://ai.google.dev/gemini-api/docs'))).toMatchObject({
  id: 'ai-google-dev-docs'
});
expect(resolveSiteByTargetUrl(new URL('https://evilgoogle.dev/'))).toBeNull();
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run test/unit/site-registry.test.js`

Expected: FAIL because the public site aliases have not yet been registered.

- [ ] **Step 3: Add exact public-origin site records**

```json
{
  "id": "openai-docs",
  "alias": "openai-docs",
  "mirrorHost": "openai-docs.fast.dxshelley.fun",
  "upstreamOrigin": "https://openai.com",
  "adapter": "configured",
  "allowedMethods": ["GET", "HEAD"],
  "proxyPolicy": { "paths": "all", "timeoutSeconds": 20, "maxRetries": 1 }
}
```

Add corresponding records for `google.dev`, `ai.google.dev`, `cloud.google.com`, and `www.google.com`, each with the same public-only method and proxy policy.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- --run test/unit/site-registry.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add config/sites.json test/unit/site-registry.test.js
git commit -m "feat(proxy): register public OpenAI and Google sites"
```

### Task 2: Document The Boundary

**Files:**
- Modify: `docs/site-mirror-routing.zh-Hans.md`

**Interfaces:**
- Consumes: exact configured site aliases in `config/sites.json`.
- Produces: operator-facing separation of public documentation from login-capable site adapters.

- [ ] **Step 1: Add the public-site table**

```markdown
| Alias | Upstream Origin | Scope |
| --- | --- | --- |
| `openai-docs` | `https://openai.com` | Public documentation only |
| `ai-google-dev-docs` | `https://ai.google.dev` | Public Gemini documentation only |
```

List all five registered origins and state that ChatGPT, Gemini Web, Google login, resource-host rewriting, and APIs are excluded.

- [ ] **Step 2: Run formatting and test checks**

Run: `npm run lint && npm test -- --run test/unit/site-registry.test.js`

Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add docs/site-mirror-routing.zh-Hans.md
git commit -m "docs(proxy): define public AI and Google site scope"
```
