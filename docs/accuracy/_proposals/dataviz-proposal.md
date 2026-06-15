# Data-Visualization Proposal — Showing Measurement Uncertainty in CPAP Charts

**Status:** Proposal (data-visualization) · **Date:** 2026-06-15
**Author:** data-visualization specialist
**Inputs:** `docs/accuracy/_drafts/cpap-device-accuracy.md` (reliability ranking §10), `docs/accuracy/_drafts/uncertainty-statistics.md` (Poisson AHI CI §3, display-precision §6)
**Priority frame:** Privacy > Correctness > Performance > UX > Features. WCAG AA. Full theming.

> **Guiding rule for "worth the clutter":** show uncertainty only where it *changes the interpretation* (uncertainty-statistics §6.2). A band that trains users to ignore bands is a net negative. Every treatment below is justified against that bar, and several existing charts are deliberately left unchanged.

---

## 0. Where the relevant charts actually live

| Concern | Component(s) |
| --- | --- |
| AHI trend (headline) | `src/views/Trends/charts/AHITrendChart.tsx` (recharts `ComposedChart`) |
| Headline KPI numbers | `src/views/Dashboard/panels/KPIRow.tsx` (`meanAHI.toFixed(1)`) |
| Central / RERA split | `src/views/Trends/charts/EventBreakdownChart.tsx` (stacked `AreaChart`) |
| Leak | `src/views/Trends/charts/LeakRateChart.tsx` (median + P95 band already) |
| Flow-derived metrics (Vt/MV/RR) | `src/views/Sessions/SignalViewer.tsx` + `src/components/charts/canvas/SignalRenderer.ts` |
| Reusable CI band reference impl | `src/components/charts/d3/KaplanMeierCurve.tsx` (`ConfidenceInterval[]` + `d3.area().y0/.y1`) |
| Decimation | `src/components/charts/canvas/decimationPyramid.ts` |
| A11y wrapper (table-behind-chart, PNG export) | `src/components/charts/ChartContainer.tsx`; `src/views/Trends/charts/ChartPanel.tsx` |
| Per-night data source | `NightlyAggregate` in `src/types/session.ts` — carries `ahi`, `eventCount`, `usageHours`, `eventsByType`, `leakP95`/`leakMedian` |

The single highest-value change (per both drafts) is to make the **long-term AHI trend with a 95% confidence band the headline**, and to stop presenting single-night AHI as if it were precise.

---

## 1. Prioritized charts that SHOULD gain uncertainty treatment

### P0 — AHI trend confidence band (`AHITrendChart.tsx`)
- **Uncertainty source:** Poisson counting error per night `(N ± 1.96√N)/H` (stats §3.3) *plus* night-to-night biological variability (accuracy §7; ~20% single-night misclassification). The raw per-night line implies a precision the statistic does not have.
- **Visual treatment:** a **shaded 95% confidence band** behind a **rolling-median (or trailing-mean) center line**, rendered exactly like the Kaplan-Meier `ciBand` (a single filled `<Area>` between `ahiLower`/`ahiUpper`). Keep the existing clinical severity `ReferenceArea`s but drop their opacity slightly so the band reads on top. De-emphasize the raw per-night dots to faint markers (the *trend*, not last night, is the headline).
- **Why it clears the bar:** this is the chart where uncertainty is both real and decision-relevant; a single-night AHI delta of ≤1–2 is usually noise (accuracy §10). Detailed design in §3.

### P0 — KPI AHI card framing (`KPIRow.tsx`)
- **Source:** same Poisson + biological variability; a bare `meanAHI.toFixed(1)` with a trend arrow over-reads small deltas.
- **Treatment:** keep one-decimal value, but (a) append the window CI as secondary text (e.g. "4.2 ±1.1 over 30 nights"), and (b) gate the trend arrow so deltas inside the band render as **"stable"** with a non-color icon, not "up/down". No chart clutter — this is text/sparkline only.
- **Why:** the headline number is the most-viewed surface; a falsely-precise single number is the worst case the research calls out (stats §6.2). Coordinate copy with `ux`/`documentation`.

### P1 — Central-vs-obstructive / RERA breakdown (`EventBreakdownChart.tsx`)
- **Source:** the *least reliable* outputs — obstructive-subtype ICC ≈ 0.16, RERA has no EEG basis, low central counts have low PPV (accuracy §4, §10; stats §2.6).
- **Treatment:** **do not** add per-series bands (a stacked area with five bands would be unreadable and would imply false precision). Instead apply *humility framing*: render Central and RERA series with a **hatch/pattern fill** (redundant, non-color) and a persistent in-chart legend footnote ("Central/RERA are modeled inferences — directional, not exact"). Optionally split RERA off the certainty-implying stack into a separate faint overlay line. Surface a **rising-central annotation** ("discuss with clinician") rather than a precise number.
- **Why:** the clutter cost of five bands fails the bar; pattern + annotation communicates "trend with humility" cheaply (accuracy §10 display guidance).

### P1 — Flow-derived metrics on high-leak epochs (Signal Viewer: Vt / MV / RR / flow-limitation lanes)
- **Source:** leak poisons every flow-derived metric (accuracy §6; stats §2.7) and ResMed disclaims Vt < 100 mL / MV < 3 L/min.
- **Treatment:** **data-quality shading** — a translucent hatched overlay on the time spans where leak exceeds the reliability threshold (confirm exact cutoff with `resmed-specialist`; ~24 L/min unintentional is the working value), with the affected lane's trace drawn at reduced opacity inside those spans. A per-lane "reduced reliability in shaded regions" caption. Do **not** delete data — annotate it.
- **Why:** leak is a first-class data-quality gate; silently showing corrupted Vt at full visual weight is a correctness failure. Shading is a viewport overlay, not a per-sample recompute (see §5).

### P2 — Single-night AHI near a threshold (Session detail / per-night view)
- **Source:** exact Poisson CI for small `N` (stats §3.4) can straddle two severity bands.
- **Treatment:** an **error bar** (or a small CI bracket) on the single-night AHI value, shown **on demand** for nights with `N < 20`, plus a reliability chip driven by `usageHours`, `eventCount`, and leak severity. Use the exact-Poisson interval, not the normal approximation, at small `N`.
- **Why:** decision-relevant only near thresholds and on short nights; gating to `N<20` keeps it from becoming noise on clean long nights.

---

## 2. Charts that should explicitly NOT change

- **Pressure trend / P95 (`PressureChart.tsx`, KPI Pressure card).** Pressure is near ground truth (accuracy §10 rank 1); the device regulates to it. A band here would be clutter that teaches users to distrust the most trustworthy metric. Keep precise, one decimal.
- **Usage / compliance (`UsageChart.tsx`, compliance KPI).** A simple timer (rank 2). No measurement uncertainty worth showing; keep integer/one-decimal.
- **`LeakRateChart.tsx` band mechanism.** It already shows median + P95 as a spread (a *distribution* band, not a CI). Leave the band; only add the data-quality threshold semantics shared with the Signal Viewer. Do not convert it to a CI band — the existing percentile band is the correct uncertainty representation for leak.
- **Raw flow/pressure waveforms in the Signal Viewer (clean epochs).** The 25 Hz trace is the substrate, not an estimate to be banded; never compute CIs on the raw signal (§5). Uncertainty there is conveyed only by the high-leak shading of §1-P1.
- **Distribution charts already encoding spread** (`BoxPlot`, `ViolinPlot`, `QQPlot`, histograms). Their geometry *is* the uncertainty; adding bands would double-encode.

---

## 3. AHI trend confidence-band design (detail)

### 3.1 Computing the band (per-night → rolling window)
Each `NightlyAggregate` already gives `eventCount` (N) and `usageHours` (H). Per night:

- Point AHI = `N / H` (already `aggregate.ahi`).
- Per-night Poisson SE on the count: `u(N) = √N`; on the rate `u(AHIᵢ) = √N / H = √(AHIᵢ / H)` (stats §3.3).
- For small N (N < 20) prefer the **exact Poisson interval** (stats §3.4, χ² form) over the normal approximation, which under-covers and can go negative.

For the rolling window of the last *k* nights (default 7 or 14; biological reliability plateaus ~14 nights, accuracy §7 / stats §4):

- **Center:** rolling median of `AHIᵢ` (robust to outlier nights) — or trailing mean if `ux` prefers symmetry with the band.
- **Band:** combine the **biological + sampling** spread of the window. Practical estimator: `center ± 1.96 · SEM`, with `SEM = s_window / √k` where `s_window` is the SD of the nightly AHIs in the window (this captures the dominant night-to-night variance per stats §4). Where the window is short (k small) the band widens automatically — exactly the desired "limited data → wide band" behavior. Clamp lower bound at 0.
- This is a **per-night-summary** computation (a few hundred points max over years), never touching the 25 Hz signal.

Owner: `data-science` provides/validates the rolling-CI util; `unit-tester` locks the reference values already pre-computed in uncertainty-statistics §7 (e.g. exact Poisson 95% for N=5 → [1.62, 11.67]; N=30,T=6 → [3.37, 7.14]).

### 3.2 Rendering in recharts (`AHITrendChart.tsx`)
The chart is already a `ComposedChart`. Add to the nightly data records two derived keys `ahiLower` and `ahiUpper`, then render the band as the **`LeakRateChart` two-area trick adapted to a floating band**, or more cleanly a single `Area` with an array `dataKey`:

- Preferred: pre-compute `ahiBand: [lower, upper]` per point and render one `<Area dataKey="ahiBand" stroke="none" fill={colors.chart1} fillOpacity={0.15} isAnimationActive={false} />`. Recharts supports a 2-tuple range datum for `Area`, giving a true floating band (no surface-color masking hack needed).
- Draw the rolling-median `<Line>` on top (reuse existing line styling; it becomes the center, not the raw per-night value).
- Keep severity `ReferenceArea`s but lower their `fillOpacity` to ~0.05 so the CI band remains legible.
- Raw per-night value: keep as faint `dot`s (opacity ~0.35) for users who want them, clearly subordinate to the band+median.

For d3 charts that want the same band, reuse the **Kaplan-Meier pattern verbatim**: `d3.area().x(...).y0(d => y(d.lower)).y1(d => y(d.upper))` with `styles.confidenceBand` fill (see `KaplanMeierCurve.tsx` lines 96-109, 150). That is the canonical band primitive in this codebase and should not be reinvented.

### 3.3 Accessibility
- Band fill must satisfy WCAG AA *non-color* redundancy: pair the band with a subtle **diagonal-hatch SVG `<pattern>`** so it survives grayscale/PDF and color-blind viewing; the center line uses the solid theme color.
- ARIA: give the band series an accessible name ("95% confidence band") and the center line ("rolling median AHI"). Wrap in `ChartContainer`/`ChartPanel` which already provides `role="figure"` + `accessibleSummary`.
- Provide the table-behind-chart (`ChartContainer.tableData`) with columns: Date, AHI, Lower 95%, Upper 95%, Nights-in-window — so screen-reader and keyboard users get the exact interval.

### 3.4 Tooltip content
On hover, show: `Rolling AHI 4.2 (95% CI 3.1–5.4)`, the window size (`30-night window`), and the **raw night** value with its own note when it falls outside the band ("this night is unusually high — likely normal night-to-night variation"). One decimal only (stats §6.1) — never two. Distinguish aleatoric ("naturally varies night to night") from epistemic ("limited data") in the copy, per stats §6.2.

---

## 4. Reusable confidence-band approach (don't reinvent per chart)

Two shared pieces:

1. **Math util — `src/utils/stats/confidenceBands.ts`** (new, owned by `data-science`):
   - `poissonRateCI(n, hours, { exact })` → `{ point, lower, upper }` (normal approx for n≥20, exact χ² Poisson for small n).
   - `rollingCIBand(series, { window, z })` → `{ date, center, lower, upper }[]` for trend charts.
   - Pure, synchronous, unit-tested against the reference values in uncertainty-statistics §7. No rendering concerns.

2. **Render primitives — `src/components/charts/uncertainty/`** (new, owned by data-visualization):
   - `ConfidenceBandArea` — a thin recharts wrapper emitting the floating-band `<Area>` (range datum) + optional hatch `<pattern>` + center `<Line>`, theme-aware via `useChartColors`, so `AHITrendChart` and any future recharts trend get identical behavior.
   - `useD3ConfidenceBand` (or just document the KM pattern) — for d3 charts, formalize the `KaplanMeierCurve` `d3.area` band into a shared helper so KM, STL residual bands, and any future d3 band share one code path and one `confidenceBand` CSS class.
   - A shared **`<DataQualityHatch>`** overlay component for the high-leak shading (§1-P1), reused by Signal Viewer lanes and any chart needing epoch-level reduced-reliability shading.

This keeps the band visually consistent (same opacity, same hatch, same theming) and puts the *statistics* in one tested place and the *pixels* in another.

---

## 5. Performance (perf is a core principle)

- **Never compute CIs on the 25 Hz raw signal.** All CI math operates on **per-night summaries** (`NightlyAggregate`): even 5 years ≈ ~1,800 points. Band computation is O(nights), trivially memoizable in the chart's existing `useMemo`.
- **Band data piggybacks on existing nightly arrays** — `ahiLower`/`ahiUpper` are added to the same record objects the line already consumes; no extra passes, no new fetch.
- **Decimation interaction:** the AHI trend is already nightly-granular and is *not* a pyramid consumer, so `decimationPyramid.ts` is untouched. For the Signal Viewer high-leak shading, the shaded *spans* are derived from the ~0.5 Hz leak channel (every 2 s), decimated/segmented into run-length intervals **once** per session load, then drawn as a handful of viewport-clipped rectangles per frame — it must **not** be evaluated per 25 Hz sample. The existing min/max pyramid already preserves leak transients (see `decimateMinMax` NaN/extreme handling), so the shading boundaries remain faithful when zoomed out.
- **Rendering cost:** one extra `<Area>` per banded chart and one `<pattern>` def — negligible. Reduced-opacity raw dots add no geometry beyond existing points. No Web Worker needed for this work.

## 6. Accessibility (cross-cutting)

- **Non-color encoding (mandatory, WCAG AA + correctness):** every uncertainty band carries a redundant **hatch pattern**; high-leak shading uses a distinct diagonal hatch; Central/RERA "low-confidence" series use pattern fills. Color is never the sole signal (CLAUDE.md a11y rule).
- **Print / grayscale / PDF export:** `ChartContainer.handleExport` serializes SVG to PNG — hatches and patterns serialize natively and survive grayscale, unlike opacity-only bands. Verify the band and severity zones remain distinguishable in the exported PNG and in the Reports PDF (coordinate with whoever owns Reports export).
- **Series labels / ARIA:** name every new series ("95% confidence band", "rolling median AHI", "reduced-reliability region"); rely on `ChartContainer`/`ChartPanel` `role="figure"` + summary, and always populate `tableData` with the lower/upper/window columns so non-visual users get the numbers.
- **Reliability chip (KPI / single-night):** three-state good / limited / unreliable with icon + label, never color alone (stats §6.2 principle 3).

---

## 7. Suggested sequencing

1. `data-science`: `confidenceBands.ts` util + tests (reference values already specified).
2. data-visualization: `ConfidenceBandArea` + hatch primitive; wire into `AHITrendChart` (P0).
3. `ux`/`documentation`: KPI AHI copy + tooltip/aleatoric-vs-epistemic wording.
4. data-visualization + `resmed-specialist`: high-leak `DataQualityHatch` in Signal Viewer (confirm leak threshold).
5. data-visualization: EventBreakdown humility framing (pattern fills + footnote).
6. `qa` + `security` review (rendering of derived content), `e2e-tester` for the table-behind-chart and export paths.

---

### Open dependencies
- Exact ResMed large-leak reliability threshold → `resmed-specialist`.
- Rolling-window default (7 vs 14) and center statistic (median vs trailing mean) → `data-science` + `ux`.
- Detection-error term `u_detect` is a placeholder (stats §7); band currently rests on Poisson + biological variance only, which is defensible and conservative.
