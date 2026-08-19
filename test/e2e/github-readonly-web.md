# GitHub Read-only Web E2E Record

Date: 2026-08-19

## Scope

- Local Worker: `http://127.0.0.1:8787`
- Target behavior: public GitHub repository browsing remains on the proxy
  domain; write and account actions go to `https://github.com`.
- Browser tool: Chrome CDP (native protocol fallback)

## Round 3 (CSP/style regression)

| Check                                    | Result                  | Observation                                                                                              |
| ---------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| Repository home, `tree` and `blob` pages | Pass (local Worker)     | Chrome CDP observed 20 CSS responses per read page, with zero stylesheet failures and zero CSP blocks.   |
| GitHub asset CSP                         | Pass (local Worker)     | Proxy asset origins now end with `/`, so CSP permits descendants such as `/assets/*.css`.                |
| Compound GitHub hostnames in CSP         | Pass (unit/integration) | `uploads.github.com` and `gist.github.com` remain unchanged; only exact allowlisted hosts are rewritten. |

The production-domain response was the original report's failure mode: the CSS
URLs were present and returned `200`, but Chrome rejected them before sending
the requests because the CSP source omitted the proxy path's trailing `/`. The
fix is verified against the local Worker; production behavior must be checked
again after the Worker deployment.

## Round 4 (JavaScript and manifest regression)

| Check                    | Result                  | Observation                                                                                                                        |
| ------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GitHub JavaScript syntax | Pass (local transform)  | The real `app-runtime` bundle parses as an ES module after rewriting; template expressions such as `${t[1]}` remain intact.        |
| `/gh/manifest.json`      | Pass (unit/integration) | Manifest JSON is handled by the GitHub Web branch and icon URLs use `/_github/proxy/github.githubassets.com/...`.                  |
| Manifest icon CSP        | Root cause confirmed    | The old route returned unrewritten `application/manifest+json`; Chrome then requested the original GitHub icon and CSP blocked it. |

The production domain still serves the pre-fix JavaScript bundle until the new
Worker version is deployed.

## Round 5 (repository metadata Fetch regression)

| Check                                 | Result                   | Observation                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Latest commit message and time        | Root cause fixed (tests) | GitHub uses JSON Fetch requests such as `/latest-commit` with `X-GitHub-Client-Version` and `X-Requested-With`; these requests now stay in the GitHub Web route and are rewritten back to the local `/gh/...` namespace. |
| Repository metadata Fetch integration | Pass (unit/integration)  | A Worker test confirms `/gh/{owner}/{repo}/latest-commit` is proxied to GitHub and the commit metadata payload reaches the page.                                                                                         |
| Browser stats POST                    | Pass (unit/integration)  | Only the exact `api.github.com/_private/browser/stats` endpoint is forwarded with its body; other GitHub API write methods remain rejected.                                                                              |

The production domain must be rechecked after deploying this Worker version.

## Round 6 (HTML/JSON cache isolation)

| Check                                  | Result                  | Observation                                                                                                                                                       |
| -------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same URL with HTML and JSON Accept     | Pass (unit/integration) | Cloudflare cache keys include representation variants such as `html`, `json`, `fragment` and `other`; HTML and JSON responses cannot occupy the same cache entry. |
| Distinct PJAX/Turbo containers         | Pass (unit/integration) | Fragment cache keys include a bounded container suffix, so targets such as `#repo` and `#issues` cannot share a cache entry.                                      |
| Public GET cache performance           | Preserved               | `cacheEverything` and the configured `CACHE_DURATION` remain enabled for GET requests; only the internal cache key gains a small representation suffix.           |
| GitHub `/commits/main/` upstream `429` | Out of scope            | The independent upstream rate-limit issue is intentionally not changed by this fix.                                                                               |

The production domain must be rechecked after deploying this Worker version,
including a fresh HTML navigation after a JSON Fetch to the same repository URL.

## Round 7 (repository security and same-origin Fetch paths)

| Check                          | Result                  | Observation                                                                                                                          |
| ------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Repository `/security` page    | Pass (unit/integration) | The repository security page remains on `/gh/{owner}/{repo}/security`; it is no longer classified as a generic write path.           |
| Security write entry points    | Pass (unit)             | Explicit paths such as `/security/advisories/new` still redirect to canonical GitHub.                                                |
| Same-origin repository Fetches | Pass (unit/integration) | Bare browser Fetch paths such as `/{owner}/{repo}/latest-commit` and PJAX repository paths proxy to the corresponding GitHub URL.    |
| Collector telemetry POST       | Pass (unit/integration) | The exact `collector.github.com/github/collect` analytics POST is proxied with its body; other collector POST paths remain rejected. |
| Commits upstream `429`         | Out of scope            | The existing independent `/commits/main/` upstream rate-limit behavior remains unchanged.                                            |

The production domain must be rechecked after deployment by opening the
repository overview, then checking Security, Branches, Tags and the latest
commit area while observing that requests remain on `fast.dxshelley.fun`.

## Round 1

| Check                                      | Result     | Observation                                                                                                                                    |
| ------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `/search?q=hermes` shortcut                | Pass       | Browser URL became `/gh/DXShelley/xget`.                                                                                                       |
| Repository home                            | Pass       | Title was `GitHub - DXShelley/xget...`; repository contents, README and directory listing rendered.                                            |
| Internal repository links                  | Pass       | Owner, repository, `tree`, `blob`, `commits` and `branches` links used the local `/gh/...` namespace.                                          |
| GitHub Assets                              | Pass       | Loaded styles/scripts used `/_github/proxy/github.githubassets.com/...`; no GitHub asset resource remained in the browser performance entries. |
| External links                             | Pass       | Documentation, Cloudflare, Star History and personal sites remained external.                                                                  |
| Fork/edit/new Issue/new PR/Settings/Signup | Pass       | Final browser URLs were on `github.com`; no local proxy URL remained.                                                                          |
| Generic GitHub search                      | Incomplete | The Worker request to GitHub did not return before the browser timeout.                                                                        |

## Round 2

| Check                          | Result              | Observation                                                                                                               |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Shortcut and write redirects   | Pass                | Repeated after restarting Wrangler; `fork`, edit, new Issue, new PR, Settings and Signup left the local origin.           |
| Repository home and read pages | Skipped after retry | The local Worker could not receive a response from GitHub and the browser reported `os error 10060` / connection timeout. |
| Raw/allowlisted resource fetch | Skipped after retry | Same upstream connectivity failure; allowlist behavior is covered by unit and Worker integration tests.                   |

## Gate Decision

Two live attempts could not complete the full read-page checklist because the
current test environment intermittently timed out while the Worker fetched
GitHub. This is recorded as an environment limitation, not as evidence that the
read-only routing code is complete in production. The remaining live E2E must be
rerun after deploying to the target domain or from a network where the Worker
can reach GitHub reliably.

## Current Route Contract

The current implementation supersedes the historical shortcut observation above:

| Request                                          | Expected behavior                                            |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `/search?q=hermes`                               | Redirects to `/gh/search?q=hermes&type=repositories`         |
| `/gh/Homebrew`                                   | Proxies the public GitHub organization page                  |
| `/gh/Homebrew/brew`                              | Proxies the public repository page                           |
| Browser fetches under `/gh/...`                  | Stay on the GitHub Web proxy and receive rewritten responses |
| GitHub CSS, JavaScript, images and API resources | Use `/_github/proxy/{allowlisted-host}/...`                  |

The regression suite covering these rules is `test/unit/github-web.test.js` and
`test/features/github-web.test.js`.
