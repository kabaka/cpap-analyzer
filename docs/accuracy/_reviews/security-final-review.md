# Security & Privacy — FINAL Review (Measurement Uncertainty / Reliability Display)

**Reviewer:** `security` (review-only) · **Date:** 2026-06-16
**Branch:** `claude/peaceful-mccarthy-takofw` · **Base:** `origin/main`
**Scope:** full branch diff (234 files). Verifies each finding from `security-review.md` was honored.
**Verdict:** **PASS-WITH-NOTES** — privacy envelope intact, all blocking-class safety/content findings honored. One pre-existing devDependency audit failure (not introduced here) and devDependency bumps deviate from the "package.json unchanged" expectation; both are below the user-shipped trust boundary.

---

## 1. Privacy (Core Principle #1) — PASS

- **No network primitive added.** Grep of every `+` line across the diff for `fetch(/XMLHttpRequest/WebSocket/EventSource/sendBeacon/axios/import(<url>)` → **zero** matches.
- **No `<a href>`/`window.open`/`target=_blank`, no external `http(s)` URL, no new `dangerouslySetInnerHTML` in added source.**
- **No remote asset/font.** No `@import`, `@font-face`, or remote `url()` added in CSS/tokens.
- **Citations are inert plain text (P-2 honored).** New `references[]` render in `GlossaryPanel.tsx:326–331` as `<li>{citation}</li>` text nodes. DOIs are substrings of the citation string — not anchors, not fetched. The only `<a href>` in the panel is the internal `#glossary-X` alphabet anchor (`preventDefault`'d). `glossary.ts` header comment explicitly states "any citation is inert text."
- **CSP unchanged (P-3 honored).** `src/buildtime/csp.ts` is byte-for-byte identical to main (diff = 0 added lines); `connect-src 'self'` intact. The only CSP-area change is a `csp.test.ts` refactor for the Vite 8 plugin-hook shape — policy untouched.
- **Privacy IMPROVEMENT — `clearAllUserData.ts`.** The wipe now matches localStorage by prefix (`cpap-`, `cpap.`, `signal-viewer-lanes-`, `signal-viewer-hidden-`), closing a real residual-metadata gap (the dotted `cpap.eventExplorer.savedQueries.v1` key + per-session lane keys were previously missed). Covers IndexedDB, OPFS, both Web Storage areas, in-memory cache, settings; fail-loud (no silent catch). Strengthens Core Principle #1.

## 2. Safety framing — PASS

- **S-1 honored (the headline safety item).** `views/Trends/utils/centralTrend.ts#detectRisingCentralTrend` detects a rising usage-weighted Clear-Airway trend independently of reliability styling. `EventBreakdownChart.tsx:124` renders a persistent, full-opacity, `role="status"` "discuss with your clinician" prompt (`data-testid="central-clinician-prompt"`) OUTSIDE the plot; consumed again in `Dashboard/insights.ts:157`. The low-reliability hatch caveat lowers the _precision_ claim only and never silences the prompt.
  - **Acceptance tests assert it.** `EventBreakdownChart.test.tsx:118` ("keeps the clinician prompt present EVEN THOUGH the split carries a low-reliability caveat") proves co-existence under high-central + low-reliability; further tests assert `role=status`, non-suppression, and that a stable trend shows the caveat but NOT the prompt.
- **S-2 honored.** No therapy/diagnostic imperative tied to a user's own numbers in any new copy (glossary/metrics/articles/chart). The two "you should lower/switch/ASV…" grep hits were false positives (Medicare-adherence and timezone-alignment descriptions). The TECSA/ASV glossary text is a _contraindication caveat_ citing SERVE-HF and states "it does not diagnose" / "never recommends a therapy change" — education, not prescription. `EventBreakdownChart.test.tsx:126` asserts the prompt contains no `ASV`, no `you have/need`, no `diagnos`.
- **S-3 honored.** Aleatoric/epistemic templates kept separate; reassurance is not auto-attached to a boundary-crossing trend (the rising-central path routes to the clinician prompt, not a soothing one-liner).

## 3. Content integrity (D10) — PASS

- **`[?]`-flagged manufacturer figures kept out of logic and copy.** `analysis/uncertainty/constants.ts` documents that FOT ~1 cmH₂O amplitude, ±0.5+4 % pressure tolerance, 0.2 cmH₂O resolution, and the S9-era 42 L/min figure are **deliberately absent**; 42 L/min appears only in a comment confirming its exclusion. The ~1 cmH₂O amplitude does NOT appear in any user copy.
- **24 / 30 L/min presented as device conventions.** `LEAK_NOTICE_LPM = 24` and `LEAK_SUPPRESS_LPM = 30` are documented as ResMed AirSense _reporting conventions, NOT AASM standards_, ResMed-specific, "Pending `resmed-specialist` confirmation," consolidating the ~8 scattered `24` literals (D7).
- **FOT "4 Hz" is permitted, not a violation.** `clinical-review.md:72` states the 4 Hz figure is independently corroborated (Alamdari 2022, `[M]/[P]`) and "may be stated"; glossary states 4 Hz (allowed) and omits the unverified amplitude. (Minor wording note below.)
- **C-3:** the existing "Not a medical document" PDF disclaimer is preserved; new methodology copy reinforces it.

## 4. PDF / export — PASS

- New uncertainty rendering routes through `formatMetric()`, whose output is provably `toFixed(decimals)` of a rounded number or em-dash — `[0-9.—-]` only by construction; **no markup can be smuggled** in. Report/CSV interpolate only this and app-constant metric labels (`m.name` at `ReportService.ts:832` is a hardcoded label string and is a PDF table cell, not the CSV path). CSV path retains its `"…".replace(/"/g,'""')` escaper. jsPDF `doc.text()` renders glyphs, not markup. No user-supplied free text was newly interpolated into PDF/SVG.
- **KaTeX stays `trust:false` (D2 honored).** `MathEquation.tsx` is untouched on this branch; config is `throwOnError:false`, `strict:false`, `trust` unset (default false). Formulas remain author-authored constants.

## 5. Dependencies

- **No new RUNTIME dependency.** The `dependencies` block in `package.json` is identical on main and HEAD; new math (incomplete gamma, Poisson CI, etc.) is hand-implemented in `analysis/math` (D-1 honored). No icon/stats/charting package added.
- **NOTE (low) — package.json/lock DID change, contrary to the task's "unchanged" expectation.** Changes are confined to **devDependencies** (build tooling major bumps: `vite ^6→^8`, `vitest ^3→^4`, `@vitest/coverage-v8 ^3→^4`, `@vitejs/plugin-react ^4→^6`, `vite-plugin-pwa ^0.21→^1.3`, `tsx`), plus a regenerated `package-lock.json`. None reach the user-shipped bundle. This is tooling maintenance riding along with the feature branch, not a feature dependency, but it is a real deviation worth the orchestrator's awareness (and a `devops` confirmation that the major-bump build/CI is green).
- **NOTE (med, pre-existing, not a regression) — `npm audit --audit-level=high` does NOT pass.** One HIGH (`form-data@4.0.5`, CRLF injection) reaches the tree via `jsdom` → Vitest test environment; `npm ls form-data --omit=dev` is empty, so it is **devDependency/test-only and never shipped to users**. The identical `form-data@4.0.5` is already pinned on `origin/main`, so this branch did not introduce it. Also present: `js-yaml` (moderate) and `@babel/core` (low), both dev-tree. The project gate criterion ("`npm audit` must pass at high") is currently red regardless of this branch; flag to `devops` to run `npm audit fix` on a maintenance branch.

## 6. Accessibility-as-safety — PASS

Reliability tiers carry icon shape + text label + hatch patterns (non-colour cues) and render on a desaturated axis separate from clinical green→red severity, avoiding the dangerous "low reliability == low severity" conflation. The clinician prompt is `role="status"` so assistive tech announces it.

---

## Findings summary

| ID                     | Severity         | Status                  | One-line                                                                                                                                     |
| ---------------------- | ---------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1/P-2/P-3            | info             | PASS                    | No network/asset/anchor/CSP change; citations inert text; CSP `connect-src 'self'` unchanged.                                                |
| (new) clearAllUserData | info             | PASS+                   | Wipe broadened (dotted/dynamic keys) — privacy improvement.                                                                                  |
| S-1                    | med→**resolved** | PASS                    | Rising-central clinician prompt is independent, full-opacity, tested incl. co-existence with low-reliability caveat.                         |
| S-2                    | med→**resolved** | PASS                    | No diagnostic/therapy imperative on user's own numbers; asserted by test.                                                                    |
| S-3                    | low→**resolved** | PASS                    | Reassurance not auto-applied to boundary-crossing trend.                                                                                     |
| C-1 / D10              | med→**resolved** | PASS                    | `[?]` figures excluded from logic & copy; 24/30 framed as device conventions.                                                                |
| E-1                    | low              | PASS                    | Export strings numeric/app-constant only; `formatMetric` output charset-safe by construction.                                                |
| D-2                    | low              | PASS                    | KaTeX `trust:false`; MathEquation untouched.                                                                                                 |
| DEP-1                  | low              | **NOTE**                | package.json/lock changed (devDependencies only; no runtime dep; not user-shipped).                                                          |
| DEP-2                  | med              | **NOTE (pre-existing)** | `npm audit` high (`form-data` via jsdom/Vitest) is dev-only and pre-dates this branch; gate is red project-wide.                             |
| LOG-1                  | info             | NOTE                    | `GoogleHealthImportService` `console.warn` logs a user-chosen `file.name` on parse failure — local console only, never transmitted; low-PHI. |

**Net:** the feature is computational + presentational and stays fully inside the privacy envelope. Every earlier blocking-class finding (S-1, S-2, C-1/D10) is honored with code + tests. No source change required from `security`. The two NOTE items (devDependency bumps; pre-existing dev-tree `npm audit` high) belong to `devops`, not this feature; neither affects shipped code or user data.

**VERDICT: PASS-WITH-NOTES**
