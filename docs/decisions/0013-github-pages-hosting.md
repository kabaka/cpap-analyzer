# 0013 — GitHub Pages for Hosting and Deployment

## Status

Accepted

## Context

CPAP Analyzer requires hosting for the production application. As a client-side-only static web application (HTML/CSS/JavaScript with no backend), hosting requirements are straightforward but critical for accessibility and reliability.

Hosting requirements:

- Serve static files (HTML, CSS, JavaScript, fonts, images)
- HTTPS required for security (Service Worker, OPFS, File System Access API)
- Custom domain support (future: cpap-analyzer.dev)
- Zero or very low cost (project has no funding)
- Automated deployment from CI/CD pipeline
- Reliable uptime (99%+ availability)
- Reasonable performance (CDN preferred)
- No server-side execution required

Additional constraints:

- Must support PWA (Service Worker requires HTTPS and proper MIME types)
- Must serve with correct HTTP headers for static assets
- Version control: atomic deployments (no partial updates)
- Rollback capability if deployment introduces breaking change

Alternatives evaluated:

- **GitHub Pages**: Free, integrated with GitHub, HTTPS included, custom domain support, simple deployment, CDN via Fastly
- **Netlify**: Free tier (100 GB bandwidth/month), excellent performance, automatic HTTPS, custom headers support, but external service requiring account
- **Vercel**: Free tier (100 GB bandwidth/month), excellent performance, custom domains, but external service requiring account
- **CloudFlare Pages**: Free unlimited bandwidth, excellent CDN, but external service requiring account setup
- **AWS S3 + CloudFront**: Powerful, scalable, but complex setup, requires AWS account, potential costs (free tier has limits)
- **Surge.sh**: Simple deployment, free tier, but limited features, uncertain long-term viability
- **Firebase Hosting**: Google infrastructure, free tier, but requires Firebase project setup, overkill for static site

## Decision

Use **GitHub Pages** for hosting and deployment.

GitHub Pages characteristics:

- **Free**: Unlimited bandwidth for public repositories
- **HTTPS**: Automatic HTTPS via Let's Encrypt
- **Custom domain**: Support for custom domains with HTTPS
- **CDN**: Backed by Fastly CDN for global distribution
- **Deployment**: Native GitHub Actions integration via `actions/deploy-pages@v3`
- **Version control**: Every deployment is a commit, full history
- **Zero config**: Enable in repository settings, configure workflow

Deployment strategy:

- Trigger: push to `main` branch after all CI checks pass
- Build: Vite production build creates `dist/` directory
- Upload: `actions/upload-pages-artifact@v3` packages dist
- Deploy: `actions/deploy-pages@v3` publishes to GitHub Pages
- URL: `https://[username].github.io/cpap-analyzer/` initially
- Custom domain: future DNS configuration for custom domain

Configuration:

```yaml
# .github/workflows/ci.yml
deploy:
  runs-on: ubuntu-latest
  needs: [audit, lint, test-unit, test-e2e, build]
  permissions:
    pages: write
    id-token: write
  environment:
    name: github-pages
    url: ${{ steps.deployment.outputs.page_url }}
  steps:
    - uses: actions/deploy-pages@v3
```

Caveats and workarounds:

- **No custom HTTP headers**: GitHub Pages doesn't support custom headers (e.g., COOP/COEP for SharedArrayBuffer)
  - **Impact**: SharedArrayBuffer unavailable, limits some parallel processing optimizations
  - **Workaround**: Use Service Worker-based polyfill if SharedArrayBuffer becomes critical
- **404 handling**: Must use `404.html` = `index.html` for SPA routing
- **Base path**: Repository name becomes base path unless custom domain used
- **Build size**: No hard limit but keep reasonable (< 1 GB, ours is < 5 MB)

## Consequences

### Positive

- Zero cost hosting eliminates financial barrier to project sustainability
- Automatic HTTPS ensures security (required for PWA, OPFS, File System Access API)
- Native GitHub integration simplifies deployment workflow, no external service credentials
- CDN (Fastly) provides reasonable global performance
- Version control via git commit history enables rollback if needed
- Custom domain support allows professional branding in future
- No maintenance: GitHub handles infrastructure, uptime, security patches
- Unlimited bandwidth for public repository removes traffic concerns
- Simple setup: enable in settings + add workflow, no complex configuration

### Negative

- No custom HTTP headers limits SharedArrayBuffer usage (affects some parallel processing patterns)
- No server-side rendering or API routes (not needed for our client-only architecture)
- GitHub Pages outages affect our availability (rare but possible)
- Base path complication if not using custom domain (e.g., `/cpap-analyzer/` in URLs)
- Build artifacts must be static (no dynamic server-side generation)
- Free tier has 100 GB soft bandwidth limit per month (sufficient but not unlimited despite claims)
- Jekyll processing by default (disabled via `.nojekyll` file)

### Neutral

- Deployment speed depends on GitHub Actions queue and Pages propagation (typically 1-2 minutes)
- Custom domain requires DNS configuration (A records or CNAME)
- HTTPS certificate managed by GitHub (automatic renewal, no control)
- Repository must be public for free GitHub Pages (acceptable for open source project)
