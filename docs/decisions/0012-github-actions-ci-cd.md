# 0012 — GitHub Actions for CI/CD

## Status

Accepted

## Context

CPAP Analyzer requires a CI/CD platform to automate quality checks, testing, and deployment. The platform must support parallel job execution, integrate with GitHub for pull request checks, and handle deployment to GitHub Pages.

CI/CD requirements:

- Quality gates: npm audit, linting, type checking, unit tests, E2E tests
- Parallel execution: independent checks run simultaneously for fast feedback
- Build and deployment to GitHub Pages
- Artifact collection: test reports, coverage, build stats
- Pull request integration: blocking checks prevent merging broken code
- Zero cost for public repository
- Minimal configuration and maintenance

Quality gate stages:

1. **Security audit** (fail fast): npm audit for vulnerable dependencies
2. **Lint**: ESLint and Prettier checks
3. **Type check**: TypeScript strict mode compilation
4. **Unit tests**: Vitest with coverage thresholds
5. **E2E tests**: Playwright on Chromium (primary), Firefox/WebKit (nightly)
6. **Build**: Vite production build with bundle size analysis
7. **Deploy**: GitHub Pages deployment for main branch

Constraints:

- Total CI time target: < 5 minutes for PR checks
- Must be deterministic: same commit = same result
- Free tier must be sufficient (GitHub Actions: 2,000 minutes/month for free tier)

Alternatives evaluated:

- **GitLab CI**: Requires migrating from GitHub, CI tight-integrated but moving repos is disruptive
- **CircleCI**: External service, requires account setup and OAuth, free tier 2,500 credits/week sufficient but unnecessary complexity
- **Travis CI**: Historical issues with service stability, free tier reduced, no compelling benefit
- **Jenkins**: Self-hosted, powerful, but requires maintenance of CI infrastructure overkill for small project
- **Netlify/Vercel**: Primarily for deployment, limited CI customization, would still need separate CI for quality gates

## Decision

Adopt **GitHub Actions** for CI/CD.

GitHub Actions characteristics:

- Native GitHub integration: no external service authentication
- Free for public repositories: unlimited minutes for public repos
- Adequate performance: 2-core, 7 GB RAM runners sufficient for our build
- Parallel execution: jobs run concurrently with dependencies specified
- Matrix builds: test across multiple browsers/platforms
- Artifact support: upload test reports, coverage, bundle analysis
- Deployment: native GitHub Pages deployment action
- YAML configuration: `.github/workflows/ci.yml` committed to repo

Workflow structure:

```yaml
ci.yml:
  audit: # Fail fast, 30s
  lint: # Parallel, 45s
  type-check: # Parallel, 60s
  test-unit: # Parallel, 2min
  test-e2e: # Parallel, 3min (Chromium only for PRs)
  build: # After all checks, 1min
  deploy: # Main branch only, 30s
```

Caching strategy:

- `actions/setup-node@v4` with `cache: npm` caches `node_modules`
- Playwright browsers cached between runs
- Vite cache preserved for faster builds

Runner specifications:

- OS: `ubuntu-latest` (Ubuntu 22.04)
- Node.js version: 22 (LTS)
- Concurrent jobs: all checks run in parallel except build/deploy

Pull request integration:

- Required checks: audit, lint, type-check, test-unit, test-e2e, build
- Merge blocked if any required check fails
- Status checks visible inline in PR

Deployment workflow:

- Triggers on push to `main` branch
- Builds production bundle
- Deploys to GitHub Pages via `actions/deploy-pages@v3`
- Uses `GITHUB_TOKEN` (automatic), no manual credentials

## Consequences

### Positive

- Zero external service setup: works immediately with GitHub repository
- Free unlimited CI minutes for public repositories eliminates cost concern
- Native integration with pull requests: checks inline, no external status badges needed
- Parallel job execution provides fast feedback (< 5 min total)
- Artifact collection simplifies debugging failures (test reports, screenshots, bundles)
- GitHub Pages deployment built-in, no separate hosting service
- Caching reduces redundant work (npm install, browser downloads)
- Concurrency control prevents multiple simultaneous deployments
- YAML configuration version-controlled with code
- Large ecosystem of reusable actions

### Negative

- GitHub lock-in: migrating CI to another platform requires rewriting workflows
- Free tier runner performance adequate but not exceptional (2-core vs 4+ core on paid services)
- Matrix builds count against concurrent job limits (not an issue for us currently)
- Runner OS limited to Ubuntu, macOS, Windows (Ubuntu sufficient for our needs)
- Debugging workflow issues requires commit-push-wait cycle (no local testing of workflow except with act)

### Neutral

- Workflow syntax is GitHub-specific YAML dialect, not portable
- Self-hosted runners available but overkill for this project
- Secrets management via repository settings (adequate for our minimal secrets)
- Audit logs available for compliance (not critical for us)
