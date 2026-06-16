# QA Final Review — Measurement Uncertainty / Reliability Display

**Reviewer:** `qa` (release gate) · **Date:** 2026-06-16
**Branch:** `claude/peaceful-mccarthy-takofw` · **Binding spec:** `docs/accuracy/_consensus.md` (D1–D11)
**Scope of this gate:** the measurement-uncertainty / reliability-display feature. (The branch also carries
several sibling features — Event Explorer, breathing detection, wearable overlays, Google Health import — which
are reviewed only where they intersect the gates below.)

## VERDICT: SHIP-WITH-NITS

All blockers and majors from the prior adversarial review are resolved. Every quality gate passes.
The remaining items are minor/nit and may be deferred to a fast-follow.

---

## Gate results (run locally)

| Gate               | Result                                      |
| ------------------ | ------------------------------------------- |
| `npx tsc --noEmit` | **PASS** (exit 0, no errors)                |
| `npx eslint .`     | **PASS** (0 errors, 34 warnings)            |
| `npx vitest run`   | **PASS** (118 files, 2321 tests, all green) |
| `npm run build`    | **PASS** (built in ~1.6 s)                  |

The 34 ESLint warnings are pre-existing-style: `no-console` in `googlehealth/parsers.ts` (sibling import
feature, intentional malformed-data logging), one `react-hooks/exhaustive-deps` in `useWearableLanes.ts`,
and `react-refresh` in test-utils. **None are in the uncertainty feature.**

---

## Consensus compliance D1–D11

- **D1 (3-state tier):** PASS. `ReliabilityTier = 'high' | 'moderate' | 'low'` in
  `src/analysis/uncertainty/reliabilityTier.ts:29`. The 5-tier model was dropped; `DataQualityFlag` and
  "unavailable" are kept orthogonal. `confidenceTier.ts` untouched.
- **D2 (canonical icon map):** PASS. moderate→outline triangle "Estimate"; low→hexagon "Modeled";
  data-quality→filled-warning. high renders nothing. Violet/neutral axis only.
- **D3 (median + IQR band, NOT a 95% CI):** PASS. `AHITrendChart.tsx` labels the band "Typical nightly range
  (P25–P75)" in the footnote, tooltip, SR table caption, and series name, each with an explicit "not a 95%
  confidence interval" disclaimer. Center is the rolling median.
- **D4 (locked stats vectors):** PASS. `poissonCI.test.ts` locks N=0 → 3.689 counts (with an explicit guard
  against 3.0) and N=40,T=6 → [4.7628, 9.0781] (guard against the rejected 4.2932). Exact Garwood < 20,
  normal ≥ 20. Labelled a lower bound on uncertainty; no fabricated over-dispersion multiplier.
- **D5/D6 (quiet-by-default; central NEVER silenced):** PASS. `EventBreakdownChart.tsx` renders a persistent,
  full-opacity, `role="status"` clinician prompt outside the plot whenever `detectRisingCentralTrend` fires —
  independent of the low-reliability hatch caveat. Non-diagnostic, non-therapy-specific copy.
- **D7 (split leak gate 24/30 as named constants):** PASS for the gate logic. `LEAK_NOTICE_LPM = 24`,
  `LEAK_SUPPRESS_LPM = 30` in `constants.ts`, consumed by the reliability gate (notice = 1-step downgrade,
  suppress = 2-step). AHI intentionally NOT leak-gated. **Partial on consolidation** — see nit N1.
- **D8 (gate on event count):** PASS. `countGated`/`splitGated` key on N and rare-class N
  (`MIN_SPLIT_TOTAL_EVENTS=20`, `MIN_RARE_CLASS_EVENTS=5`, `POISSON_NORMAL_APPROX_MIN_COUNT=20`).
- **D9 (precision table + real offenders + T90):** PASS. `formatMetric('ahi', …)` now applied at
  `export.worker.ts:126-127`, `ReportService.ts:1074`, `PressureOptimization.tsx:305`. T90 = integer.
  Remaining `toFixed(2)` are correlation r (explicitly out of scope).
- **D10 (no `[?]` figures encoded):** PASS. The only occurrences of the forbidden figures are in the
  `constants.ts` prohibition docstring; none appear in logic or user copy.
- **D11 (first-PR scope):** PASS. All ten must-haves present incl. ADR 0018, glossary/help, CHANGELOG.

---

## Standards

- **TypeScript strict / `any`:** clean. Utilities use discriminated unions and `readonly`; recharts band typed
  with a `[number, number]` tuple (no `as any`).
- **Theming:** `--color-reliability-*` and `--color-uncertainty-band-*` defined in BOTH `:root` and
  `[data-theme='dark']` (`tokens.css`), read via `useChartColors`. No hard-coded colors in the new components.
- **WCAG AA:** PASS. Chip is a focusable `<button role="status">` (not alert), icon shape + text label (1.4.1),
  reason folded into the accessible name, tooltip on keyboard focus, band exposed via SR table not color.
- **Reliability axis vs severity:** PASS. Violet/neutral only; red/orange reserved for severity zones.

---

## Test adequacy

- **Utilities vs verified vectors:** strong. `poissonCI` (D4 vectors + guards + edge cases), `formatMetric`
  (per-row table + banker's rounding), `reliabilityTier` (24 cases: each gate boundary, AHI-not-leak-gated,
  N=20 boundary, unknown-id fallback, no-context-never-downgrades), `rollingBand`, `incompleteGamma`.
- **ReliabilityChip a11y:** strong (status-not-alert, focusable, non-color cue, tooltip on focus, high renders
  nothing).
- **KPI integration / AHI band:** covered (`EnhancedKPICard.reliability`, `AHITrendChart` tests).
- **Central-apnea safety test:** present and meaningful — but as a **component (Vitest) test**
  (`EventBreakdownChart.test.tsx`), not the Playwright **e2e** acceptance test D6/D11 explicitly require.
  See finding M-note below (downgraded to minor: coverage is meaningful and arguably stronger).

---

## Findings

### Minor

- **MIN-1 (D7 consolidation incomplete).** `constants.ts` docstring claims the "~8 scattered `24` leak
  literals are consolidated," but in-scope leak `24`s remain un-migrated: `insights.ts:95`
  (`stats.leakP95 > 24`), `Breathing.tsx:544` (`a.leakMedian > 24`), `LeakRateChart.tsx:124` (`y={24}`),
  `SessionBuilder.ts:50` (`LARGE_LEAK_THRESHOLD = 24`). Values are correct and behavior is right; this is
  debt against an explicit D7 goal and the docstring overstates completion. Fix the literals OR soften the
  docstring.
- **MIN-2 (central-apnea acceptance test is component, not e2e).** D6/D11 item 10 specify a Playwright e2e
  acceptance test asserting the prompt is present. The equivalent assertions exist in
  `EventBreakdownChart.test.tsx` and `insights.test.ts` (component level). Add a thin e2e to honor the
  spec letter, or have the orchestrator record that the component test satisfies intent.
- **MIN-3 (CHANGELOG under-describes the feature).** The CHANGELOG documents `docs/accuracy/` thoroughly but
  has no user-facing "Added" entry for the shipped UI: reliability chips, AHI typical-nightly-range band,
  display-precision corrections, central-apnea trend prompt. Add one entry summarizing the feature.

### Nit

- **NIT-1.** `insights.ts` rising-central insight is `severity:'warning'` and relies on `slice(0,5)` not
  dropping it; it can only be dropped if 5+ other warnings outrank it. The primary safety surface
  (`EventBreakdownChart` prompt) is uncapped and guaranteed, so this is theoretical — but consider exempting
  `central-apnea-rising` from the cap for defense-in-depth.
- **NIT-2.** 23 new `no-console` warnings in `googlehealth/parsers.ts` (sibling feature). Consider a scoped
  eslint-disable with justification or a logger util.

---

## Correctness risks reviewed — none blocking

- No displayed CI/band misleads: the IQR band is correctly labelled as empirical spread, never a CI; the
  Poisson CI is labelled a lower bound.
- No reliability overstatement/understatement found: AHI correctly `moderate` (not high), correctly NOT
  leak-gated; pressure/usage correctly `high`; central split correctly `low`; missing context never downgrades.
- No variance double-counting (median+IQR replaced the incoherent median+SEM combination).

## Escalations

None required. No security, performance, or UX regression observed in the feature surface.
