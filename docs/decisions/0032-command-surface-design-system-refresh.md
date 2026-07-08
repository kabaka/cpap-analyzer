# 0032 — Command Surface: An App-Wide Design-System Visual Refresh

## Status

Accepted — 2026-07-08

## Context

CPAP Analyzer has grown to roughly fifteen top-level surfaces — Dashboard, Sessions
list, Session Detail, the full Signal Viewer, Trends, an Explore hub with five
analysis views (Event Explorer, Correlations, Pressure Optimization, Breathing,
Configurations), Reports, Data Management, the Import wizard, Settings, Help, and the
AI Insight drawer. Each accreted its own chrome over time, so the product now speaks
**two visual dialects at once**: the older, looser view chrome, and a denser,
monospace-forward, panel-based language introduced by two recent redesigns — the
Dashboard **"Signal Deck"** (#83) and the **Session Detail** redesign (#84, whose
clinical hero is recorded in [0031](0031-per-night-therapy-assessment-two-gate-verdict.md)).
That split is visible and growing: a user moving from the redesigned Dashboard into,
say, Correlations or Reports crosses a seam in typography, spacing, and control
placement. A related symptom is **control duplication** — several views carry their
own `DateRangeSelector` that re-picks a range the app already tracks globally, so the
same conceptual control exists in many places with independently-drifting state.

To resolve this coherently rather than by taste, a **prototype was generated from the
app's own design system**: `Command Surface - Shell + Dashboard.dc.html`, a
design-composer artifact whose single React class composes the app's **real**
design-system components (`window.CpapDS.*`) inside inline-styled "command surface"
chrome. Its inline styles — sub-12px mono type, letter-spacing, paddings, gaps, radii,
and colors, **every color expressed as a `var(--…)` token** — are the exact visual
spec. Its data is seeded/illustrative (a `mulberry32` RNG); **only the
layout, typography, spacing, and color are normative.** The prototype's tokens are
already the repo's tokens (`src/styles/tokens.css`, already synced) — this is a
composition and layout refresh, **not** a token overhaul.

The forces in tension are the project's own priority order:

- **Privacy (priority 1).** The command strip surfaces a **"LOCAL · NO UPLOAD"** pill —
  a literal promise ([0015](0015-zero-telemetry-analytics.md)). A visual refresh must
  add no egress, no analytics, and **no externally-fetched web fonts** (the mono stack
  `var(--font-family-mono)`, a Cascadia Code stack, is already bundled).
- **Correctness (priority 2).** Charts inform health decisions. A restyle must not
  touch any chart's **type, y-axis range/scale, axis labels, clinical reference
  lines/zones, or units.** This is chrome, not data encoding. The honest,
  non-composite clinical presentation established in
  [0031](0031-per-night-therapy-assessment-two-gate-verdict.md) and
  [0018](0018-measurement-uncertainty-reliability-display.md) must survive intact.
- **Performance (priority 3).** The tuned rendering paths are load-bearing: the Signal
  Viewer's Canvas2D/WebGL2 hybrid ([0019](0019-webgl2-hybrid-waveform-rendering.md)),
  the Trends Canvas2D renderer ([0025](0025-trends-canvas2d-html-chrome-overlay-crosshair-rendering.md)),
  and the decimation pyramids / LTTB / rAF coalescing / virtualization behind them.
  These are marked **[KEEP-TECH]**: restyle the chrome around them, never the renderer.
- **UX (priority 4).** The refresh must deliver one coherent language for a technically
  sophisticated audience, add a keyboard-first workflow, and hold **WCAG AA** — a real
  risk given the intentionally dense, small-type aesthetic.
- **Features (priority 5).** Every view, every Explore lens, every filter, saved query,
  and export must be preserved; nothing is dropped in the name of visual tidiness.

Two further constraints are fixed by the codebase, not open questions. The CSS idiom
is **CSS Modules** (chosen alongside [0002](0002-react-typescript-frontend-stack.md) /
[0003](0003-radix-ui-primitives.md); the project deliberately does not use a
utility-CSS framework), so the prototype's inline styles must be **translated** into
`.module.css`, not shipped inline. And the global date range already lives in the
Zustand `useAppStore` ([0004](0004-zustand-state-management.md)) — the shell can drive
that existing state rather than inventing new range state per view.

This ADR records the **decision to adopt the "Command Surface" language app-wide** and
the non-negotiable constraints on how it is executed. Detailed pixel specs are
delegated to `ui-design`/`ux`; implementation to `frontend` and the chart specialists;
gating to `qa` and `security`.

## Decision Drivers

Resolved against the project priority order
(Privacy > Correctness > Performance > UX > Features):

- **Privacy.** No new network egress, analytics, or bundled fonts; the
  "LOCAL · NO UPLOAD" promise is made _more_ prominent, not weakened. Opt-in
  integrations (Fitbit, weather, LLM) stay opt-in; the AI drawer keeps its privacy
  posture ([0024](0024-grounded-opt-in-ai-insights-multi-backend-provider.md)).
- **Correctness (decisive constraint).** The refresh may change chart **chrome**
  (container, title, legend placement, token-driven colors) but **never** the data
  encoding — chart type, axis range/scale, labels, clinical thresholds/zones, or
  units. The Signal Viewer's tuned parameters are industry-normed and are not touched.
- **Performance (hard floor).** The `[KEEP-TECH]` rendering paths must not regress.
  A chrome-only restyle must not add per-frame work, defeat virtualization, or inflate
  layout/paint on the dense surfaces.
- **UX.** One visual language end-to-end; a keyboard-first ⌘K palette for a
  power-user audience; a single global time window as one mental model; WCAG AA held
  despite the density (contrast at 8–11px, visible focus, keyboard nav, color never the
  sole signal, reduced-motion honored for the pulsing status dot).
- **Features / no loss.** Every view, Explore lens, filter, saved query, and export is
  preserved. The ⌘K palette is net-new capability, not a replacement for anything.
- **Consistency & minimal churn.** Reuse existing tokens and existing shared components
  (`SegmentedControl`, `Badge`/`AHIBadge`, `Sparkline`, `KpiCard`, `StatGroup`,
  `ChartContainer`) rather than re-authoring them; stay within the CSS Modules idiom.

## Considered Options

Two axes were in play: **how much of the app to restyle**, and **how to execute** the
refresh (CSS strategy, the range control, the accent, and the tokens). Options A–C are
the scope axis; D–G are the execution sub-alternatives whose chosen counterparts are
folded into Option C.

### A. Status quo — keep the two visual dialects

Ship no refresh; let the Signal Deck / Session Detail language coexist with the older
view chrome.

- **Pro.** Zero effort and zero risk to the tuned surfaces.
- **Con.** Entrenches the exact problem: a product that visibly changes dialect
  mid-navigation, with duplicated range controls and drifting state. Fails UX and
  consistency; the seam only widens as more views are redesigned. **Rejected.**

### B. Partial / incremental restyle (shell + already-redesigned views only)

Restyle the shell and the two views that already began the direction, and defer the
rest to "later."

- **Pro.** Smaller diff; lower immediate review/QA load; less risk at once.
- **Con.** Leaves most of the app in the old dialect — the two-language incoherence
  persists indefinitely, since deferred cosmetic work rarely lands. A half-migrated
  shell (global window in the header) with views that still carry their own pickers is
  arguably _worse_ than either endpoint. **Rejected.**

### C. Full app-wide Command Surface refresh — CSS Modules, reuse tokens, single blue accent, global range in the shell, ⌘K palette (chosen)

Adopt the prototype's language across the shell and every view in a sequenced but
complete pass; translate its inline styles to CSS Modules; reuse existing tokens and
shared components; move the global time window into the shell; add a functional ⌘K
palette; single blue accent; both themes.

- **Pro.** Delivers one coherent language end-to-end, formalizing the #83/#84
  direction instead of stranding it. Correctness and performance are protected by the
  `[KEEP-TECH]` rule (chrome only). Reusing tokens/components keeps churn and theme
  coverage intact. Sequenced by phase, so the large surface area is staged, not landed
  in one drop.
- **Con.** Large surface area and a long-lived feature branch; substantial
  fidelity-verification and a11y burden across many surfaces in two themes.
  **Chosen** — it is the only option that actually resolves the incoherence, and the
  risks are manageable via phasing and the quality gates.

### D. Retain per-view date-range selectors (rejected sub-alternative)

Keep each view's own `DateRangeSelector` rather than centralizing the window in the
shell.

- **Pro.** No behavior change; a view could always hold its own range.
- **Con.** Perpetuates duplicated controls with independently drifting state and no
  single source of truth; forces the user to re-set range per view. Contradicts the
  single-global-range model. **Rejected**, with one escape hatch: a view keeps its own
  selector **only** if it genuinely needs a range independent of the global one — any
  such case is flagged to the orchestrator rather than assumed.

### E. Utility-CSS / Tailwind-style translation instead of CSS Modules (rejected)

Translate the prototype's inline styles into a utility-class system to move fast.

- **Pro.** Fast, near-mechanical translation of inline styles.
- **Con.** Contradicts the established CSS Modules idiom
  ([0002](0002-react-typescript-frontend-stack.md)/[0003](0003-radix-ui-primitives.md)
  deliberately avoided Tailwind), adds a build/dependency surface, and fights
  token-driven theming. **Rejected** — translate to `.module.css`; introduce no inline
  styles and no utility-class framework.

### F. Accent picker (rejected)

Let users choose an accent color rather than committing to one.

- **Pro.** Personalization.
- **Con.** Multiplies the theme-QA matrix across every command-surface color in two
  themes, dilutes the single-accent identity present in every reference screenshot, and
  adds token/state complexity — for no requested need. **Rejected** — single blue via
  the existing `--color-primary`, no picker.

### G. Design-token overhaul (rejected)

Re-derive a fresh token scale as part of the refresh.

- **Pro.** Opportunity to clean up the scale.
- **Con.** The prototype's tokens _are_ the repo tokens, already synced; overhauling
  them risks regressions across every themed surface and every chart's per-theme color
  tokens, for a refresh that is about composition, not palette. **Rejected** — reuse
  `src/styles/tokens.css` unchanged.

## Decision Outcome

Adopt **Option C**: a full, phased, app-wide adoption of the **Command Surface** visual
language, executed as follows.

1. **A single visual language, prototype-fidelity.** Monospace-forward
   micro-typography, uppercase micro-labels, dense panel-based decks, and a
   command-strip shell — extending the direction begun in Signal Deck (#83) and Session
   Detail (#84 / [0031](0031-per-night-therapy-assessment-two-gate-verdict.md)) to every
   surface. `Command Surface - Shell + Dashboard.dc.html` is the fidelity spec; its
   layout/typography/spacing/color are normative and its sample data is not.

2. **Rebuild the shell as a command strip.** `RootLayout` gains a 52px sticky command
   strip (section title · `LOCAL · NO UPLOAD` pill with a reduced-motion-safe pulsing
   dot · coverage string · Import control · the global time-window toggle · ⌘K button ·
   theme toggle), a spec-exact sidebar (mono wordmark, nav groups, rail/collapse), and a
   spec-exact status-bar footer (session count, coverage, storage meter).

3. **One global time window in the shell.** The window toggle (7D / 30D / 90D / 6M /
   12M + Custom popover) becomes the **single** global range control, driving the
   existing global `dateRange` in `useAppStore`
   ([0004](0004-zustand-state-management.md)); views follow it. Per-view
   `DateRangeSelector`s that merely duplicate the global range are **removed**; a view
   keeps its own only if it needs a range independent of the global one (each such case
   flagged, not assumed). Deep-link/URL range state must continue to work.

4. **Build a functional, keyboard-first ⌘K command palette (new capability).** Fuzzy
   jump to sections, jump to a session by date, and quick actions (Import, toggle theme,
   change the time window). It is a11y-complete — built on the project's accessible
   dialog lineage ([0003](0003-radix-ui-primitives.md)) with focus trap, ARIA, and full
   keyboard operation.

5. **Single blue accent; both themes.** Use the existing `--color-primary`; no accent
   picker. Support light **and** dark, keeping the current `system` default; every
   surface is verified in both.

6. **Preserve all clinical and performance fidelity.** Every chart keeps its type,
   y-axis range/scale, labels, clinical thresholds/zones, and units; only chrome is
   restyled. The `[KEEP-TECH]` paths — Canvas2D/WebGL2 signal viewers
   ([0019](0019-webgl2-hybrid-waveform-rendering.md)), the Trends canvas renderer
   ([0025](0025-trends-canvas2d-html-chrome-overlay-crosshair-rendering.md)), and
   decimation/LTTB/rAF/virtualization — are not touched by the restyle.

7. **Reuse tokens and components; CSS Modules only.** Reuse `src/styles/tokens.css`
   unchanged and the existing shared components (`SegmentedControl`, `Badge`/`AHIBadge`,
   `Sparkline`, `KpiCard`, `StatGroup`, `ChartContainer`). Translate the prototype's
   inline styles into `.module.css`; introduce no inline styles and no utility-class
   system.

8. **Deliver in phases** (Foundation/spec → Shell + global window + ⌘K → Views fan-out →
   chart-fidelity pass → QA/security/tests/docs/verify → CalVer release) on one feature
   branch, many commits, one PR, merged only when CI is green.

This ADR fixes the _what_ (adopt Command Surface everywhere), the non-negotiable _how_
(chrome-only for charts and `[KEEP-TECH]` paths; CSS Modules; reuse tokens; single blue;
both themes; WCAG AA), and the _behavioral change_ (one global range in the shell). The
per-surface pixel specs are delegated to `ui-design`/`ux`.

## Consequences

### Positive

- **One coherent product.** The two-dialect seam is removed; navigation no longer
  crosses a visual discontinuity, and the #83/#84 direction becomes the whole app's
  language rather than an island.
- **Keyboard-first power workflow.** The ⌘K palette gives a technically sophisticated
  audience fast, mouse-free navigation and actions — net-new capability.
- **One mental model for time.** A single global window removes duplicated per-view
  pickers and their independently-drifting state; the coverage string makes the active
  range explicit everywhere.
- **No privacy cost.** No egress, analytics, or new bundled fonts; the
  "LOCAL · NO UPLOAD" promise is made more prominent, and opt-in integrations stay
  opt-in.
- **Correctness preserved by construction.** Charts keep their data encoding and the
  `[KEEP-TECH]` renderers are untouched, so the restyle cannot alter a clinical reading.
- **Low structural churn.** Reusing existing tokens and shared components — and staying
  in CSS Modules — keeps theme coverage intact and avoids a new CSS build surface.

### Negative

- **Large surface area.** Nearly every view is touched in one refresh: a big diff, a
  heavy review/QA/security load, and a long-lived feature branch with real
  rebase/merge risk. Mitigated by phasing and one-PR discipline.
- **Fidelity-verification burden.** The prototype's sub-12px, tightly-tracked
  micro-typography and precise spacing must be matched across many surfaces in **both**
  themes, requiring visual verification and design sign-off, not just "looks close."
- **Accessibility risk from density.** Very small mono type, tight spacing, and dense
  uppercase labels can threaten contrast, focus visibility, and readability. WCAG AA
  must be actively re-verified at these sizes (contrast at 8–11px, keyboard/ARIA on the
  new controls, color never the sole signal, reduced-motion for the pulsing dot).
- **Global-range behavior change.** Centralizing the window changes established per-view
  behavior; every view must be audited for whether it truly needs an independent range,
  and deep-link/URL range state must keep working. Users lose per-view range memory
  where a view previously kept its own.
- **New code in ⌘K.** A command palette (dialog, focus management, fuzzy match, command
  registry) is genuinely new surface to test, make accessible, and security-review — it
  must act only within local, client-side scope.
- **Performance-regression risk even from chrome.** Mono fonts, more panels, sticky
  headers, and blur/backdrop effects can add layout/paint cost; `performance` must
  confirm the tuned paths ([0019](0019-webgl2-hybrid-waveform-rendering.md),
  [0025](0025-trends-canvas2d-html-chrome-overlay-crosshair-rendering.md)) and
  virtualization do not regress.
- **Density vs. the secondary audience.** The command-surface aesthetic is deliberately
  dense; it suits the primary technical audience but may be less approachable for the
  "dedicated layperson" secondary audience, leaning more on in-app help.

### Neutral

- **The prototype's data is illustrative.** Only its layout, typography, spacing, and
  color are the spec; implementers must never treat its seeded sample numbers as real
  values.
- **Composition/layout only.** No change to the data model, storage schema, parsing,
  plugin API, or clinical algorithms — purely presentational.
- **Mono-forward is an identity choice, not a functional one.** Body/narrative prose
  stays sans; mono is used for labels, numerals, and chrome.
- **Single accent and both-theme support** track every reference screenshot (captured
  dark-theme, blue-accent) while keeping the `system` default.
- **Delivered as one PR** off one feature branch with many commits; merge only on green
  CI, following Conventional Commits, a CHANGELOG entry, and a CalVer release.

## Confirmation

How adherence to this decision is verified:

- **Visual fidelity review.** `ui-design`/`ux` confirm each surface matches the
  prototype spec (typography, spacing, color tokens) in **both** light and dark.
- **Chart-fidelity gate (blocking).** `data-visualization` verifies every chart keeps
  its type, y-axis range/scale, labels, clinical reference lines/zones, and units, in
  both themes, with no data-encoding change.
- **Performance gate.** `performance` confirms no regression on the Signal Viewer
  ([0019](0019-webgl2-hybrid-waveform-rendering.md)), Trends
  ([0025](0025-trends-canvas2d-html-chrome-overlay-crosshair-rendering.md)), and the
  decimation/LTTB/virtualization paths.
- **Accessibility.** Keyboard navigation (including ⌘K), ARIA, visible focus, contrast
  at small sizes, color never the sole signal, and reduced-motion honored.
- **Tests.** Vitest unit/integration and Playwright e2e updated/added — shell chrome,
  ⌘K palette, global-range wiring, and per-view follow-through.
- **QA gate (can block)** on every change; **`security` review** for anything touching
  files, external APIs, storage, cryptography, or rendering of imported content (Import
  wizard, AI drawer, Reports export).
- **Pipeline.** Pre-commit hooks and CI (audit, lint, unit, e2e, build) green before
  merge to `main`.

## Related Decisions

- [0002](0002-react-typescript-frontend-stack.md) — the React/TypeScript stack and
  CSS Modules idiom this refresh restyles within.
- [0003](0003-radix-ui-primitives.md) — the accessible dialog/popover primitives the
  ⌘K palette and shell controls build on for WCAG-AA keyboard/focus/ARIA.
- [0004](0004-zustand-state-management.md) — the global `dateRange` in `useAppStore`
  that the shell's single time-window control now drives.
- [0006](0006-recharts-d3-visualization.md) — the chart layer whose chrome is restyled
  while its data encoding is preserved.
- [0015](0015-zero-telemetry-analytics.md) — the zero-egress promise the
  "LOCAL · NO UPLOAD" pill states literally; no telemetry is added.
- [0019](0019-webgl2-hybrid-waveform-rendering.md) — a `[KEEP-TECH]` performance path
  preserved untouched by the restyle.
- [0024](0024-grounded-opt-in-ai-insights-multi-backend-provider.md) — the AI Insight
  drawer restyle keeps its opt-in, privacy-preserving behavior.
- [0025](0025-trends-canvas2d-html-chrome-overlay-crosshair-rendering.md) — a
  `[KEEP-TECH]` performance path preserved untouched by the restyle.
- [0031](0031-per-night-therapy-assessment-two-gate-verdict.md) — the Session Detail
  redesign (#84) whose honest, non-composite clinical presentation this refresh carries
  forward and formalizes app-wide.
