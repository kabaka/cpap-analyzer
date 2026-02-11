# CPAP Analyzer — Agent Team

This project is developed entirely by a team of AI coding agents. There is no human development team. A human product owner provides direction and requirements to the **Orchestrator**, which coordinates all work by delegating to specialist agents.

## How It Works

### Request Flow

1. The user describes a request or requirement to the **Orchestrator**.
2. The Orchestrator analyzes the request, identifies which specialists are needed, and breaks the work into delegatable tasks.
3. Relevant specialists execute their tasks and return results to the Orchestrator.
4. The Orchestrator routes all code through **QA** review before considering work complete.
5. The Orchestrator commits the result and reports back to the user.

### Multi-Agent Collaboration

Every non-trivial change involves multiple agents. A feature request is never just "Frontend" — it typically involves:

- **UX** for interaction design and accessibility review
- **UI Design** for visual design and theme compliance
- **Frontend** for implementation
- **Data Science** or **Data Visualization** if analysis or charts are involved
- **Unit Tester** and/or **E2E Tester** for test coverage
- **Security** if the change touches data handling, file parsing, or external integrations
- **Documentation** for user-facing docs and in-app help
- **QA** for code review and quality enforcement

The Orchestrator decides which agents are needed for each task. It should err on the side of involving more agents rather than fewer.

### Quality Gates

- **QA can block merges.** No code is finalized without QA approval.
- **Pre-commit hooks must pass.** Prettier, ESLint, TypeScript type checking, and Vitest tests run on every commit.
- **CI must be green.** The GitHub Actions pipeline (audit, lint, test, build) must all pass.
- **Security review** is required for anything touching data handling, file parsing, cryptography, external APIs, or storage.

### Communication Model

Agents do not communicate directly with each other. The Orchestrator mediates all inter-agent coordination:

- Passes context and file references between agents
- Resolves conflicts when agents disagree (project principles guide: privacy > performance > features)
- Ensures work products from one agent are properly handed off to the next

## Team Roster

| Agent              | File                                         | Role                                                       | User-Facing |
| ------------------ | -------------------------------------------- | ---------------------------------------------------------- | :---------: |
| Orchestrator       | `.github/agents/orchestrator.agent.md`       | Team coordinator; delegates all work, never writes code    |     ✅      |
| Frontend           | `.github/agents/frontend.agent.md`           | UI components, views, routing, state management            |      —      |
| UI Design          | `.github/agents/ui-design.agent.md`          | Design system, themes, visual specifications               |      —      |
| UX                 | `.github/agents/ux.agent.md`                 | User experience, accessibility, interaction design         |      —      |
| Unit Tester        | `.github/agents/unit-tester.agent.md`        | Vitest unit and integration tests                          |      —      |
| E2E Tester         | `.github/agents/e2e-tester.agent.md`         | Playwright end-to-end tests                                |      —      |
| ADR Author         | `.github/agents/adr-author.agent.md`         | Architecture Decision Records (MADR 4.0)                   |      —      |
| RCA Analyst        | `.github/agents/rca-analyst.agent.md`        | Root cause analysis for bugs and incidents                 |      —      |
| Data Science       | `.github/agents/data-science.agent.md`       | Statistical analysis, algorithm implementation             |      —      |
| Data Visualization | `.github/agents/data-visualization.agent.md` | Charts, interactive plots, dashboards                      |      —      |
| Documentation      | `.github/agents/documentation.agent.md`      | User guides, in-app help, API docs                         |      —      |
| ResMed Specialist  | `.github/agents/resmed-specialist.agent.md`  | Domain expert on ResMed machines and data formats          |      —      |
| QA                 | `.github/agents/qa.agent.md`                 | Code review, quality enforcement, release gating           |      —      |
| Security           | `.github/agents/security.agent.md`           | Security audit, privacy compliance, vulnerability analysis |      —      |
| Database           | `.github/agents/database.agent.md`           | Client-side storage architecture and data modeling         |      —      |
| Performance        | `.github/agents/performance.agent.md`        | Runtime performance, memory optimization, profiling        |      —      |
| DevOps             | `.github/agents/devops.agent.md`             | CI/CD, build configuration, deployment                     |      —      |

## Agent Categories

### Coordination

- **Orchestrator** — The single point of contact for the user. Manages the entire lifecycle of every request.

### Implementation

- **Frontend** — Application shell, components, routing, state
- **Data Science** — Statistical algorithms, analysis pipelines, mathematical correctness
- **Data Visualization** — Interactive charts, rendering performance, dashboard composition
- **Database** — Storage schema, data access patterns, migration strategies
- **ResMed Specialist** — EDF parsing, machine-specific data handling, clinical metrics
- **Performance** — Optimization, profiling, memory management
- **DevOps** — CI/CD pipelines, build config, deployment

### Design

- **UI Design** — Visual design system, themes, component specs
- **UX** — Interaction patterns, accessibility, information architecture

### Quality

- **QA** — Code review, standards enforcement, release gating
- **Unit Tester** — Vitest test suite
- **E2E Tester** — Playwright test suite
- **Security** — Vulnerability analysis, privacy compliance

### Analysis

- **RCA Analyst** — Bug investigation, root cause identification
- **ADR Author** — Architectural decision documentation

### Documentation

- **Documentation** — User guides, help content, developer docs

## Conventions

- Agent instructions are kept high-level. Task-specific procedures and step-by-step guides live in **skills** (`.github/skills/`).
- Coding standards, formatting rules, and project conventions are defined in `.github/copilot-instructions.md`.
- All agents are aware that this is an AI-only development team and should operate accordingly.
