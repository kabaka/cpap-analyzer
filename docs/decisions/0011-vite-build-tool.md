# 0011 — Vite for Build Tooling

## Status

Accepted

## Context

CPAP Analyzer requires a build tool to bundle the TypeScript/React application for production deployment. The build system must support modern JavaScript features, code splitting, asset optimization, fast development server with HMR, and integration with test frameworks.

Build requirements:

- TypeScript compilation with strict type checking
- React JSX transformation
- CSS Modules for scoped styling
- Code splitting for lazy-loaded routes
- Tree shaking to eliminate dead code
- Asset optimization (minification, compression)
- Fast development server with Hot Module Replacement (HMR)
- Production bundle size < 500 KB gzipped total
- Build time < 60 seconds in CI

Development experience requirements:

- Instant server startup (< 1 second)
- Fast HMR updates (< 100ms)
- Zero configuration for standard stack
- Integration with Vitest and Playwright
- Source maps for debugging

Alternatives evaluated:

- **webpack 5**: Industry standard, mature, powerful, but complex configuration, slow dev server startup (~10-30s), slow HMR, requires extensive plugins for TypeScript/React
- **Parcel**: Zero-config, fast, but less control over bundle optimization, smaller ecosystem, less mature code-splitting
- **Rollup**: Excellent tree-shaking, small bundles, but requires manual configuration for dev server, HMR, TypeScript processing; more of a library bundler than app bundler
- **esbuild**: Blazing fast, but low-level, no HMR, no CSS processing, requires building dev server from scratch
- **Turbopack** (Next.js): Fast, modern, but tightly coupled to Next.js framework, not suitable for standalone SPA

## Decision

Adopt **Vite** as the build tool for development and production.

Vite characteristics:

- **Native ESM dev server**: serves modules directly, no bundling in dev (instant startup)
- **Fast HMR**: < 100ms updates leveraging browser native ESM
- **Rollup for production**: battle-tested production bundling with excellent tree-shaking
- **TypeScript built-in**: esbuild-powered TypeScript compilation, no separate tsc step
- **React support**: official `@vitejs/plugin-react` with Fast Refresh
- **CSS Modules native**: built-in support, no configuration
- **Code splitting**: automatic route-based splitting with dynamic imports
- **Asset optimization**: image inlining, minification, content hashing
- **Vitest integration**: test framework shares Vite config
- **Playwright compatible**: can serve dev build for E2E tests

Configuration highlights:

```typescript
vite.config.ts:
- plugins: [react()]
- build target: ES2020 (modern browsers)
- chunk strategy: separate vendor, async routes
- source maps: separate files for production debugging
- minification: terser for JS, cssnano for CSS
```

Bundle optimization:

- Manual chunks: `react`, `react-dom`, `recharts`, `d3` separated
- Dynamic imports for routes and heavy features
- Tree-shaking eliminates unused Radix primitives
- Asset inlining threshold: 4 KB

Development server:

- Port: 5173 (default)
- Host: localhost
- CORS: enabled for potential future mobile debugging
- HMR: WebSocket on same port

## Consequences

### Positive

- Instant dev server startup (< 1s) enables immediate development, no waiting for bundling
- Fast HMR (< 100ms) provides near-instant feedback during development
- Native ESM in dev means no transpilation/bundling overhead during development
- Zero-config for TypeScript + React + CSS Modules reduces setup complexity
- Vitest shares config, eliminating test-specific build configuration
- Rollup production builds produce highly optimized bundles with excellent tree-shaking
- Automatic code splitting creates optimal chunk strategy without manual configuration
- Small install size compared to webpack ecosystem
- Modern architecture leveraging browser native features
- Official React plugin ensures Fast Refresh works perfectly

### Negative

- Younger than webpack, smaller ecosystem of plugins (though sufficient for our needs)
- CommonJS dependencies may need configuration (`optimizeDeps.include`)
- Native ESM in dev vs bundled in production can expose discrepancies (rare but possible)
- Less mature for complex monorepo setups (not relevant for us)
- Browser-based dev debugging differs slightly from bundled production behavior
- Some webpack-specific guides/tutorials not directly applicable

### Neutral

- Requires modern browsers for dev server (not an issue for developer machines)
- Production build uses Rollup, different from dev ESM serving (intentional trade-off)
- Pre-bundling of dependencies in dev (to reduce HTTP requests) cached in `node_modules/.vite`
- Plugin ecosystem different from webpack, though growing rapidly
