---
applyTo: '**'
---

# CPAP Analyzer — Global Development Instructions

This is a client-side web application for analysis of CPAP therapy data. The entire project is developed by a team of AI coding agents coordinated by an orchestrator agent.

## Core Principles

- **Client-side only**: No backend server. All data processing happens in the browser.
- **Performance first**: Must handle years of full-resolution time-series data (25–50 Hz) responsively.
- **Privacy by default**: No data leaves the user's browser. No analytics, no telemetry.
- **Modularity**: Plugin architecture for machine support, analyses, visualizations, integrations, and exports.
- **Accessibility**: WCAG AA compliance target.

## Coding Standards

- **Language**: TypeScript (strict mode).
- **Formatting**: Prettier (see `.prettierrc`).
- **Commits**: Conventional Commits only (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `perf:`, `ci:`).
- **Versioning**: Calendar Versioning (CalVer) — `YYYY.0M.MICRO`.
- **Changelog**: Keep a Changelog format in `CHANGELOG.md`.
- **License**: MIT.

## Documentation Standards

- All user-facing documentation must be written for an audience of patients with data science, mathematics, or bioinformatics backgrounds.
- Include enough explanatory material for dedicated laypersons to learn what they need within the app.
- In-app help should be detailed and contextual.
- Aim for regulatory compliance in documentation (no formal certification).

## Testing Requirements

- Unit tests with Vitest.
- End-to-end tests with Playwright.
- Pre-commit hooks must pass before any commit.
- If pre-commit passes, CI must be green.

## Agent Workflow

This project is developed entirely by AI agents. There is no human development team.

- The orchestrator agent coordinates all work by delegating to specialist agents.
- The orchestrator never writes code directly — it delegates and reviews.
- Every change should involve relevant specialists (implementation, review, testing, security, UX).
- Quality enforcement is aggressive; the QA agent can block releases.
