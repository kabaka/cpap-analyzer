# Phase 11 Evaluation: Plugin Architecture

**Date:** 2026-02-12
**Status:** Evaluation for product owner decision
**Scope:** Phase 11 — Plugin Architecture (TODO.md lines ~407–442)

---

## What Was Planned

Phase 11 called for a full plugin architecture: a `PluginRegistry` with lifecycle management, a `DataProvider` abstraction layer, and re-wrapping every existing feature (ResMed parser, all analyses, all charts, all exports) as plugins conforming to formal contracts. It also included three integration stubs (Fitbit, Weather, LLM) with OAuth flows and network policy enforcement. ADR 0007 justified this primarily for multi-manufacturer support and future community contributions.

## Benefits

- **Formal extension contracts.** Each capability (parsing, analysis, visualization, export) would have a defined interface and lifecycle, enforcing isolation between subsystems.
- **Multi-manufacturer support.** Adding a second machine manufacturer (e.g., Philips Respironics) would follow the same registration pattern as ResMed.
- **Lazy-loading potential.** Plugins could be loaded on demand, reducing initial bundle size for features the user hasn't activated.

## Costs and Risks

- **Massive refactoring with no functional gain.** Every parser, analysis routine, chart component, and export service would need to be wrapped in plugin adapters. The application already works — this adds code without adding capability.
- **No actual consumers.** The project is developed entirely by AI agents. There are no third-party developers, no community plugin ecosystem, and none anticipated. All plugin infrastructure complexity serves zero external users.
- **Plugin API stability trap.** Publishing formal plugin contracts creates pressure to maintain backward compatibility. This adds rigidity to a project that benefits from staying agile and refactoring freely.
- **AI agent context burden.** More abstraction layers mean more files to read, more indirection to trace, and harder debugging for the agent team. Direct module imports are immediately legible; registry lookups are not.
- **UX complexity for nothing.** A plugin management UI is pointless when every "plugin" is a mandatory first-party module. Users would see a settings panel with nothing optional to configure.
- **Speculative integrations don't need a plugin system.** Fitbit sync, weather correlation, and LLM analysis can each be implemented as regular service modules with their own configuration. A registry adds no value over direct imports for a known, finite set of integrations.

## Alternatives

| Option                         | Description                                                                                                                                                         | Effort  | Risk |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- |
| **(A) Direct implementation**  | Add new features (Philips support, integrations) as regular TypeScript modules using the same patterns that succeeded across Phases 1–10.                           | Low     | Low  |
| **(B) Lightweight interfaces** | Keep the TypeScript interfaces in `src/types/plugins.ts` as documentation of capability contracts, but skip the registry, lifecycle management, and adapter layers. | Minimal | Low  |
| **(C) Defer / abandon**        | Remove Phase 11 from the current plan. Supersede ADR 0007. Revisit only if a concrete need for runtime extensibility emerges.                                       | None    | None |

## Recommendation

**Defer/abandon — Option C.**

The plugin architecture was designed for a hypothetical ecosystem that does not exist. All 10 completed phases work correctly with direct module imports. The pattern is proven, debuggable, and well-understood by the agent team.

When second-manufacturer support (e.g., Philips) becomes a priority, it is a first-party implementation task — not a community contribution. A simple factory or strategy pattern at the parser level is sufficient and far cheaper than a full plugin system.

If runtime extensibility ever becomes a real requirement (e.g., user-installable analysis modules), it can be designed then with the benefit of concrete use cases rather than speculation.

## Cleanup Items (if Abandoned)

1. **Supersede ADR 0007** — Write a new ADR documenting the decision to defer plugin architecture, referencing this evaluation.
2. **Remove placeholder code** (optional) — `src/types/plugins.ts` and `src/services/plugins/` contain unused interfaces and an empty README. Removing them eliminates confusion; keeping them is harmless if annotated as aspirational.
3. **Update Phase 12 dependencies** — Change "Phases 5–11 complete" to "Phases 5–10 complete" in TODO.md, since Phase 12 (Advanced Analysis) has no actual dependency on plugin infrastructure.
4. **Keep Settings integration placeholders** — The Settings view stubs for future integrations are harmless and signal intent without imposing architectural cost.
