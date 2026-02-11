# Deployment & Infrastructure

## Hosting

### GitHub Pages (Current Decision)

CPAP Analyzer is a static web application hosted on [GitHub Pages](https://pages.github.com/). This is a deliberate choice for simplicity:

- **No server to maintain** — zero operational overhead.
- **Free hosting** — no infrastructure costs.
- **Automatic deployment** — pushes to `main` trigger deployment via GitHub Actions.
- **HTTPS by default** — GitHub Pages serves over HTTPS with automatic certificate management.
- **Custom domain support** — available if needed in the future.

The application is a single-page application (SPA) built by Vite, producing a `dist/` directory of static assets.

### PWA Support

The application should function as a Progressive Web App:

- **Service Worker**: Caches the application shell and assets for offline access. Uses a Cache-First strategy for static assets and a Network-First strategy for the HTML entry point (to pick up updates).
- **Web App Manifest**: Provides metadata for installability (name, icons, theme color, display mode).
- **Offline Access**: Once installed, the application works fully offline. All data is local. The only online requirement is initial installation and updates.
- **Update Mechanism**: When a new version is deployed, the service worker detects the update and notifies the user. The user can choose when to apply the update. No data loss occurs during updates.

### CDN Considerations

GitHub Pages has its own CDN (Fastly). No additional CDN is needed:

- Static assets are served with appropriate cache headers.
- The application is small enough that cache priming is fast.
- All assets are bundled — no external CDN dependencies (privacy requirement).

## CI/CD Pipeline

### GitHub Actions Workflow

The CI/CD pipeline is defined in `.github/workflows/ci.yml` and runs on every push to `main` and every pull request.

#### Pipeline Structure

```
Push/PR to main
    │
    ├─── [Parallel] ─────────────────────────────┐
    │                                              │
    │  ┌──────────────┐  ┌──────────────────┐     │
    │  │ Security Audit│  │ Lint & Format     │     │
    │  │ npm audit     │  │ Prettier check    │     │
    │  │ --audit-level │  │ ESLint            │     │
    │  │   =high       │  │ TypeScript check  │     │
    │  └──────────────┘  └──────────────────┘     │
    │                                              │
    │  ┌──────────────┐  ┌──────────────────┐     │
    │  │ Unit Tests    │  │ E2E Tests         │     │
    │  │ Vitest        │  │ Playwright        │     │
    │  │ + coverage    │  │ Chromium/FF/WK    │     │
    │  └──────────────┘  └──────────────────┘     │
    │                                              │
    ├─────────────────────────────────────────────┘
    │
    ▼ (all pass)
    │
    ┌──────────────┐
    │ Build         │
    │ Vite          │
    │ → dist/       │
    └──────────────┘
    │
    ▼ (main branch only)
    │
    ┌──────────────┐
    │ Deploy        │
    │ GitHub Pages  │
    └──────────────┘
```

#### Job Details

**Security Audit**

- `npm audit --audit-level=high`
- Fails the pipeline if any high or critical vulnerabilities are found.
- Run on every PR to catch vulnerable dependencies before merge.

**Lint & Format**

- `npx prettier --check .` — Verify all files are formatted.
- `npx eslint .` — Verify no lint errors.
- `npx tsc --noEmit` — Verify TypeScript compiles with no errors.

**Unit Tests**

- `npx vitest run --coverage` — Run all Vitest tests with coverage reporting.
- Coverage reports are available as artifacts.

**E2E Tests**

- `npx playwright install --with-deps` — Install browser engines.
- `npx playwright test` — Run all Playwright tests across Chromium, Firefox, and WebKit.
- Test reports uploaded as artifacts (retained 14 days) on failure.

**Build**

- `npm run build` — Vite production build.
- Only runs after all quality checks pass.
- Build output uploaded as a Pages artifact.

**Deploy**

- Uses the `actions/deploy-pages@v4` action.
- Only runs on pushes to `main` (not on PRs).
- Deploys the build output to GitHub Pages.
- Concurrency group ensures only one deployment runs at a time.

### Pre-Commit Hooks

The local development environment enforces the same quality checks via Husky pre-commit hooks:

1. Prettier formatting check
2. ESLint linting
3. TypeScript type checking (if tsconfig.json exists)
4. Vitest unit tests

**Guarantee**: If pre-commit passes locally, CI will be green. Any deviation between the local hook and CI pipeline is a bug that must be fixed immediately.

### Conventional Commits Enforcement

Commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. This is enforced by:

- Agent training (all agents are instructed to use conventional commits)
- QA review (the QA agent verifies commit message format)
- Future: automated commit message validation in CI (via commitlint or similar)

## Versioning and Releases

### Calendar Versioning (CalVer)

The project uses [Calendar Versioning](https://calver.org/) with the format `YYYY.0M.MICRO`:

- `YYYY` — Full year (e.g., `2026`)
- `0M` — Zero-padded month (e.g., `02`)
- `MICRO` — Incrementing patch number within the month, starting at `0`

Examples:

- `2026.02.0` — First release of February 2026
- `2026.02.1` — Second release of February 2026
- `2026.10.0` — First release of October 2026

### Release Process

1. Ensure all CI checks pass on `main`.
2. Update `CHANGELOG.md`: move items from `[Unreleased]` to a versioned heading.
3. Update `version` in `package.json`.
4. Commit: `chore: release YYYY.0M.MICRO`
5. Tag: `git tag vYYYY.0M.MICRO`
6. Push: `git push origin main --tags`
7. GitHub Pages deploys automatically from the CI pipeline.

### Changelog

`CHANGELOG.md` follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Every user-facing change must have a changelog entry categorized as Added, Changed, Deprecated, Removed, Fixed, or Security.

## Security Headers

The deployed application should include security headers. On GitHub Pages, this is done via `<meta>` tags in the HTML since HTTP headers are not configurable:

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self';
               script-src 'self';
               style-src 'self' 'unsafe-inline';
               connect-src 'self' https://api.fitbit.com https://*.openweathermap.org;
               img-src 'self' data: blob:;
               worker-src 'self' blob:;
               font-src 'self';"
/>
```

For SharedArrayBuffer support (if used for performance), COOP and COEP headers are required:

```html
<meta http-equiv="Cross-Origin-Opener-Policy" content="same-origin" />
<meta http-equiv="Cross-Origin-Embedder-Policy" content="require-corp" />
```

Note: GitHub Pages has limited header customization. If COOP/COEP cannot be set via meta tags effectively, this may become a factor in the server re-evaluation decision.

## Bundle Size Management

- **Code splitting**: Vite's automatic code splitting by route/feature. Heavy modules (charting library, analysis algorithms) are loaded on demand.
- **Tree shaking**: All imports must be tree-shaking-friendly. No barrel exports that pull in entire modules.
- **Bundle analysis**: Run Vite's bundle visualizer periodically to identify bloat.
- **Budget**: Target < 500 KB initial load (gzipped) for the application shell. Feature modules loaded on demand.

## Server Considerations (Future Evaluation)

### When a Server Might Become Necessary

1. **LLM Features**: If the LLM integration requires server-side API key management (to avoid exposing keys in client code), a minimal proxy server may be needed.

2. **Cross-Device Sync**: If users want to access their data from multiple devices (phone + desktop), a sync server with user accounts would be required.

3. **Sharing**: If users want to share analysis results with their doctor via a URL (rather than a file export), server-side storage and access control would be needed.

4. **Heavy Processing**: If future analysis features exceed browser capabilities (large-scale ML training, complex simulations), server-side compute may be beneficial.

### Options If a Server Is Needed

| Option                    | Pros                                                           | Cons                                                            |
| ------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| **Cloudflare Workers**    | Edge-deployed, low latency, generous free tier, no cold starts | Limited compute time (10-50ms CPU per request), limited storage |
| **Vercel Edge Functions** | Good DX, integrates with GitHub, generous free tier            | Vendor lock-in, cold starts on paid plans                       |
| **Self-hosted (VPS)**     | Full control, unlimited compute                                | Operational overhead, hosting cost, requires maintenance        |
| **Remote MCP Server**     | Users bring their own LLM, app provides data tools             | Complex protocol, requires user setup                           |

### Current Decision

**Stay client-side only.** Re-evaluate when a specific feature requirement makes client-side untenable. See ADR `docs/decisions/0001-client-side-architecture.md` for the full decision record.
