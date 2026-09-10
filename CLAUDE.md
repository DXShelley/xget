# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

Xget is a high-performance, Cloudflare Workers-based acceleration engine for
developer resources. It provides unified acceleration for code repositories
(GitHub, GitLab, etc.), package registries (npm, PyPI, Maven, etc.), container
registries (Docker Hub, GHCR, etc.), and AI inference APIs (OpenAI, Anthropic,
etc.).

The project operates as a reverse proxy that transforms incoming requests to
match various platform APIs while adding security headers, caching, retry logic,
and performance monitoring.

## Development Commands

### Core Commands

```bash
# Start development server (Cloudflare Workers local environment)
npm run dev              # Runs on http://localhost:8787

# Deploy to Cloudflare Workers production
npm run deploy

# Build and run tests
npm run test             # Run tests in watch mode
npm run test:run         # Run tests once
npm run test:coverage    # Generate coverage report
npm run test:ui          # Open Vitest UI

# Code quality
npm run lint             # Check code quality
npm run lint:fix         # Fix linting issues
npm run format           # Format code with Prettier
npm run format:check     # Check formatting without changes
npm run type-check       # TypeScript type checking (no emit)
npm run commitlint       # Validate the latest commit message
```

## Commit Messages

- Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for
  every commit
- Preferred format: `type(scope): description`
- Common types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`
- The repository installs a `commit-msg` hook via `npm install`; do not bypass
  it unless explicitly required

## Pre-Commit Requirements

- Before every commit, run the local CI-equivalent checks from
  `.github/workflows/ci.yml`
- Required commands: `npm run lint`, `npm run format:check`, `npm run test:run`,
  and `npm run type-check`
- If any required check fails, do not commit until the failure is resolved
- Apply this rule to every commit, including documentation-only changes, unless
  the user explicitly asks for a different workflow

## Branch Workflow

All development must follow this sequence:

1. Switch to `dev` before making changes.
2. Develop, run the required tests and checks, and commit the changes on `dev`.
3. Merge `dev` into `main` only after the checks pass.
4. Push both `main` and `dev` to the remote.
5. Switch back to `dev` after pushing.

Do not develop or commit directly on `main`. Keep `main` as the release branch
and `dev` as the development branch.

### Testing Workflow

- Tests use Vitest with `@cloudflare/vitest-pool-workers` for Workers-specific
  testing
- Run `npm run test:run` before committing to ensure all tests pass
- Coverage reports are generated in `coverage/` directory

## Architecture

### Request Flow

1. **Entry Point**: `src/index.js` - Exports default Worker with `fetch()`
   handler
2. **Validation**: `src/utils/validation.js` - Validates HTTP methods, path
   length, detects protocol types
3. **Platform Detection**: URL path is parsed to identify platform (e.g., `/gh/`
   → GitHub)
4. **Path Transformation**:
   `src/platforms/path-transformers.js#transformPlatformPath()` converts request
   paths to upstream URLs
5. **Protocol Handling**: Different handlers for Git, Docker, AI inference
   requests
6. **Upstream Fetch**: Request forwarded with appropriate headers and retry
   logic
7. **Response Processing**: URL rewriting for certain platforms (npm, PyPI),
   cache storage
8. **Security Headers**: Added via `src/utils/security.js` before returning to
   client

### Key Components

#### Configuration (`src/config/`)

- **`index.js`**: Runtime configuration with environment variable overrides
  - `TIMEOUT_SECONDS`: Request timeout (default: 30s)
  - `MAX_RETRIES`: Retry attempts (default: 3)
  - `CACHE_DURATION`: Cache TTL (default: 1800s = 30 minutes)
  - `SECURITY.ALLOWED_METHODS`: HTTP methods (default: GET, HEAD)

- **`platform-catalog.js`**: Platform base URL definitions
  - `PLATFORM_CATALOG`: Object mapping platform keys to base URLs

- **`routing/platform-index.js`**: Pre-sorted keys for efficient matching
  - `SORTED_PLATFORMS`: Longest-prefix-first platform matching order

- **`platforms/path-transformers.js`**: Platform-specific path rewriting
  - `transformPlatformPath()`: Converts request paths to platform-specific URLs
  - Special handling for crates.io (adds `/api/v1/crates` prefix) and Jenkins
    (adds `/current/` prefix)

#### Protocol Handlers (`src/protocols/`)

- **`git.js`**: Git protocol detection and header configuration
  - Detects Git operations via User-Agent, endpoints (`/info/refs`,
    `/git-upload-pack`)
  - Handles Git LFS via `Accept: application/vnd.git-lfs+json`

- **`docker.js`**: Container registry protocol (OCI/Docker)
  - Parses WWW-Authenticate headers for token authentication
  - Handles Docker registry v2 API authentication flow
  - Special redirect handling to prevent leaking auth tokens to blob storage

- **`ai.js`**: AI inference API detection and header forwarding
  - Detects requests to `/ip/*` platforms
  - Preserves all headers for AI API compatibility

#### Utilities (`src/utils/`)

- **`validation.js`**: Request validation logic
  - `isDockerRequest()`: Detects Docker/OCI operations
  - `validateRequest()`: Enforces security policies

- **`security.js`**: Security headers and error responses
  - Adds HSTS, X-Frame-Options, CSP, X-XSS-Protection
  - `createErrorResponse()`: Generates standardized error responses

- **`performance.js`**: Performance monitoring
  - `PerformanceMonitor`: Tracks request timing
  - Adds `X-Performance-Metrics` header to responses

### Caching Strategy

- Uses Cloudflare Cache API for GET requests (200 OK only)
- Cache TTL controlled by `CACHE_DURATION` config
- Skips cache for: Git operations, Docker operations, AI inference requests
- Range requests: First checks for range-specific cache, falls back to full
  content cache

### Special Platform Handling

#### npm

- Rewrites `https://registry.npmjs.org/` URLs in JSON responses to point to Xget
  instance

#### PyPI

- Rewrites `https://files.pythonhosted.org` URLs in HTML responses to point to
  Xget instance
- Uses separate `pypi-files` platform for file downloads

#### crates.io

- Adds `/api/v1/crates` prefix to all API requests
- Handles search endpoint (`/?q=`) specially

#### Jenkins

- Adds `/current/` prefix to update center paths
- Preserves `/experimental/` and `/download/` paths as-is

#### Docker Registries

- Handles authentication via token service
- Uses manual redirect mode to strip Authorization headers before S3 redirects
- Auto-retries with public token on 401 responses

## Code Structure Conventions

### File Organization

```
src/
├── index.js                 # Main Worker entry point
├── app/
│   ├── handle-request.js    # Shared request pipeline
│   └── request-context.js   # Protocol-aware request classification
├── config/
│   ├── index.js             # Runtime configuration
│   ├── platform-catalog.js  # Platform base URLs
│   └── platforms.js         # Compatibility exports
├── protocols/
│   ├── git.js               # Git protocol handler
│   ├── docker.js            # Docker/OCI handler
│   └── ai.js                # AI inference handler
├── response/
│   └── finalize-response.js # Response shaping and cache writes
├── routing/
│   ├── platform-index.js    # Platform matching order
│   └── resolve-target.js    # Upstream target resolution
├── platforms/
│   ├── path-transformers.js # Platform-specific upstream paths
│   └── response-filters.js  # Platform-specific text response filtering
├── upstream/
│   ├── cache.js             # Cache read helpers
│   └── fetch-upstream.js    # Upstream transport and retries
└── utils/
    ├── validation.js        # Request validation
    ├── security.js          # Security utilities
    └── performance.js       # Performance monitoring

test/
├── features/               # Feature tests
├── platforms/              # Platform-specific tests
├── unit/                   # Unit tests
├── index.test.js          # Core Worker tests
└── integration.test.js    # Integration tests
```

### Important Patterns

#### Protocol Detection Order

1. Check if Docker request (via `isDockerRequest()`)
2. Check if Git request (via `isGitRequest()`)
3. Check if Git LFS request (via `isGitLFSRequest()`)
4. Check if AI request (via `isAIInferenceRequest()`)
5. Default to standard file download

#### Adding a New Platform

1. Add platform entry to `PLATFORM_CATALOG` in `src/config/platform-catalog.js`
2. If special path transformation needed, add a transformer in
   `src/platforms/path-transformers.js`
3. Add platform tests in `test/platforms/`
4. Update README.md with platform documentation

#### Retry Logic

- Retries up to `MAX_RETRIES` times with linear backoff
- Delay: `RETRY_DELAY_MS * attempts` (default: 1000ms, 2000ms, 3000ms)
- Retries on: Network errors, timeouts, 5xx errors
- Does NOT retry: 4xx errors (except Docker 401 which has special handling)

#### Error Handling

- All errors caught at top level in `handleRequest()`
- Errors converted to JSON responses via `createErrorResponse()`
- Performance metrics still added even on error paths

## Testing Guidelines

### Test Structure

- **Unit tests** (`test/unit/`): Test individual functions in isolation
- **Feature tests** (`test/features/`): Test specific features (auth, caching,
  Git, performance)
- **Platform tests** (`test/platforms/`): Test platform-specific transformations
- **Integration tests** (`test/integration.test.js`): End-to-end request flows

### Running Specific Tests

```bash
# Run specific test file
npm run test:run test/unit/platforms.test.js

# Run tests matching pattern
npm run test:run -- --testNamePattern "Docker"

# Run with coverage
npm run test:coverage
```

### Common Test Patterns

```javascript
// Mock request creation
const request = new Request('http://localhost/gh/microsoft/vscode', {
  method: 'GET',
  headers: { 'User-Agent': 'git/2.34.1' }
});

// Mock environment
const env = {};
const ctx = { waitUntil: () => {} };

// Test the worker
const response = await worker.fetch(request, env, ctx);
expect(response.status).toBe(200);
```

## Deployment

### Cloudflare Workers

- Primary deployment target
- Uses GitHub Actions for CI/CD (`.github/workflows/workers.yml`)
- Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets

### Cloudflare Pages

- Alternative deployment via adapter in `adapters/pages/`
- Auto-synced from `main` branch to `pages` branch
- Uses separate workflow (`.github/workflows/pages-cf.yml`)

### Other Platforms

- **Vercel/Netlify**: Uses Functions adapter in `adapters/functions/`
- **Deno Deploy**: Uses Functions adapter (compatible format)
- **Docker**: Multi-stage build using `workerd` runtime

### Environment Variables

Configure in Cloudflare Workers dashboard or via `wrangler.toml`:

- `TIMEOUT_SECONDS`: Override default timeout
- `MAX_RETRIES`: Override retry count
- `CACHE_DURATION`: Override cache TTL
- `ALLOWED_METHODS`: Override allowed HTTP methods (comma-separated)
- `ALLOWED_ORIGINS`: Override CORS origins (comma-separated)

## Important Notes

### Security Considerations

- Never log or expose Authorization headers
- Docker authentication tokens are stripped before S3 redirects
- All responses include security headers (HSTS, CSP, X-Frame-Options, etc.)
- Path length limited to prevent URL-based attacks (default: 2048 chars)

### Performance Optimization

- Use `ctx.waitUntil()` for cache writes to avoid blocking response
- Range requests leverage cache when possible
- Cloudflare edge caching (`cf` fetch options) for non-protocol requests
- HTTP/3 enabled for supported clients

### Git/Docker/AI Requests

- Skip normal caching mechanisms
- Allow POST/PUT/PATCH methods
- Preserve all upstream headers
- No performance headers added (to maintain protocol compatibility)

### URL Rewriting

- Only enabled for npm and PyPI platforms
- Rewrites responses to point to Xget instance instead of upstream
- Required for package managers to download dependencies through Xget

## Common Tasks

### Adding a New Platform

1. Add to `PLATFORM_CATALOG` in `src/config/platform-catalog.js`
2. If special transformation needed, update `src/platforms/path-transformers.js`
3. Add test in `test/platforms/`
4. Update README.md documentation
5. Test locally with `npm run dev`

### Debugging Requests

1. Use `npm run dev` to start local server
2. Add `console.log()` statements in `src/app/handle-request.js` or the relevant
   extracted pipeline module
3. Check Wrangler dev server output
4. Inspect `X-Performance-Metrics` header in responses

### Fixing Test Failures

1. Run specific failing test: `npm run test:run test/path/to/test.js`
2. Check mock setup matches actual request pattern
3. Verify platform configuration in `src/config/platform-catalog.js` and
   `src/platforms/path-transformers.js`
4. Run all tests before committing: `npm run test:run`

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **xget** (4087 symbols, 5609 relationships, 189 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/xget/context` | Codebase overview, check index freshness |
| `gitnexus://repo/xget/clusters` | All functional areas |
| `gitnexus://repo/xget/processes` | All execution flows |
| `gitnexus://repo/xget/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
