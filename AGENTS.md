# CPAP Analyzer — Agent Team

This project is developed entirely by a team of AI agents running in **Claude Code**. There is no human development team. A human product owner provides direction and requirements to the **Orchestrator**, which coordinates all work by delegating to specialist subagents.

The **Orchestrator is the main Claude Code session** — the agent the user talks to directly. Its operating instructions live in [`CLAUDE.md`](CLAUDE.md) (loaded automatically every session). Specialist subagents live in [`.claude/agents/`](.claude/agents/) and are dispatched via the Agent tool. Reusable procedures live in [`.claude/skills/`](.claude/skills/).

## How It Works

### Request Flow

1. The user describes a request or requirement to the **Orchestrator** (the main session).
2. The Orchestrator analyzes the request, identifies which specialists are needed, and breaks the work into delegatable tasks.
3. Relevant specialist subagents execute their tasks (dispatched via the Agent tool) and return results to the Orchestrator.
4. The Orchestrator routes all code through the **`qa`** subagent before considering work complete.
5. The Orchestrator commits the result and reports back to the user.

### Multi-Agent Collaboration

Every non-trivial change involves multiple agents. A feature request is never just "frontend" — it typically involves:

- **`ux`** for interaction design and accessibility review
- **`ui-design`** for visual design and theme compliance
- **`frontend`** for implementation
- **`data-science`** or **`data-visualization`** if analysis or charts are involved
- **`unit-tester`** and/or **`e2e-tester`** for test coverage
- **`security`** if the change touches data handling, file parsing, or external integrations
- **`documentation`** for user-facing docs and in-app help
- **`qa`** for code review and quality enforcement

The Orchestrator decides which agents are needed for each task. It should err on the side of involving more agents rather than fewer.

### Quality Gates

- **`qa` can block merges.** No code is finalized without QA approval.
- **Pre-commit hooks must pass.** Prettier, ESLint, TypeScript type checking, and Vitest tests run on every commit.
- **CI must be green.** The GitHub Actions pipeline (audit, lint, test, build) must all pass.
- **Security review** is required for anything touching data handling, file parsing, cryptography, external APIs, or storage.

### Communication Model

Subagents cannot invoke other subagents — in Claude Code, only the main session (the Orchestrator) can dispatch agents. The Orchestrator therefore mediates all inter-agent coordination:

- Passes context and file references between agents
- Resolves conflicts when agents disagree (project principles guide: privacy > correctness > performance > UX > features)
- Ensures work products from one agent are properly handed off to the next

## Team Roster

| Subagent             | File                                   | Role                                                       |
| -------------------- | -------------------------------------- | ---------------------------------------------------------- |
| `frontend`           | `.claude/agents/frontend.md`           | UI components, views, routing, state management            |
| `ui-design`          | `.claude/agents/ui-design.md`          | Design system, themes, visual specifications               |
| `ux`                 | `.claude/agents/ux.md`                 | User experience, accessibility, interaction design         |
| `unit-tester`        | `.claude/agents/unit-tester.md`        | Vitest unit and integration tests                          |
| `e2e-tester`         | `.claude/agents/e2e-tester.md`         | Playwright end-to-end tests                                |
| `adr-author`         | `.claude/agents/adr-author.md`         | Architecture Decision Records (MADR 4.0)                   |
| `rca-analyst`        | `.claude/agents/rca-analyst.md`        | Root cause analysis for bugs and incidents                 |
| `data-science`       | `.claude/agents/data-science.md`       | Statistical analysis, algorithm implementation             |
| `data-visualization` | `.claude/agents/data-visualization.md` | Charts, interactive plots, dashboards                      |
| `documentation`      | `.claude/agents/documentation.md`      | User guides, in-app help, API docs                         |
| `resmed-specialist`  | `.claude/agents/resmed-specialist.md`  | Domain expert on ResMed machines and data formats          |
| `qa`                 | `.claude/agents/qa.md`                 | Code review, quality enforcement, release gating           |
| `security`           | `.claude/agents/security.md`           | Security audit, privacy compliance, vulnerability analysis |
| `database`           | `.claude/agents/database.md`           | Client-side storage architecture and data modeling         |
| `performance`        | `.claude/agents/performance.md`        | Runtime performance, memory optimization, profiling        |
| `devops`             | `.claude/agents/devops.md`             | CI/CD, build configuration, deployment                     |

The **Orchestrator** itself is not a subagent file — it is the main session, configured by [`CLAUDE.md`](CLAUDE.md).

## Agent Categories

### Coordination

- **Orchestrator** (main session) — The single point of contact for the user. Manages the entire lifecycle of every request.

### Implementation

- **`frontend`** — Application shell, components, routing, state
- **`data-science`** — Statistical algorithms, analysis pipelines, mathematical correctness
- **`data-visualization`** — Interactive charts, rendering performance, dashboard composition
- **`database`** — Storage schema, data access patterns, migration strategies
- **`resmed-specialist`** — EDF parsing, machine-specific data handling, clinical metrics
- **`performance`** — Optimization, profiling, memory management
- **`devops`** — CI/CD pipelines, build config, deployment

### Design

- **`ui-design`** — Visual design system, themes, component specs
- **`ux`** — Interaction patterns, accessibility, information architecture

### Quality

- **`qa`** — Code review, standards enforcement, release gating
- **`unit-tester`** — Vitest test suite
- **`e2e-tester`** — Playwright test suite
- **`security`** — Vulnerability analysis, privacy compliance

### Analysis

- **`rca-analyst`** — Bug investigation, root cause identification
- **`adr-author`** — Architectural decision documentation

### Documentation

- **`documentation`** — User guides, help content, developer docs

## Conventions

- Agent instructions are kept high-level. Task-specific procedures and step-by-step guides live in **skills** (`.claude/skills/`). Several subagents preload their matching skill via the `skills:` frontmatter field.
- Coding standards, formatting rules, project conventions, and the Orchestrator's operating instructions are defined in [`CLAUDE.md`](CLAUDE.md).
- All agents are aware that this is an AI-only development team and should operate accordingly.
