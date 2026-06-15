# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Calendar Versioning](https://calver.org/) with the format `YYYY.0M.MICRO`.

## [Unreleased]

### Added

- **Signal Viewer shows what you're hovering.** Moving the pointer over a charted region that contains a device event (apnea, hypopnea, RERA, large leak, …) or an app-computed breathing-pattern candidate (PB / CSR) now surfaces a compact one-line readout in the pinned legend bar — a colour swatch plus the event/candidate type, its start time, duration, and a key stat (e.g. leak for a large-leak event, or confidence / cycle length / duration and a "candidate" label for a detection). The readout sits in the always-visible legend bar rather than a tooltip over the trace, so it never obstructs the waveform you're inspecting; when an event and a candidate overlap, both are shown. Keyboard users get the same context folded into the existing arrow-key data-cursor announcement (one polite live region, no extra screen-reader chatter), and colour is never the sole signal.
- **Explore → Machine Configurations.** A new view at `/explore/configs` for comparing therapy outcomes across periods where machine settings stayed the same — answering "which max pressure gave me the lowest AHI?" without lab equipment. Consecutive nights sharing the same configured min pressure, max pressure, and EPR level are grouped into config periods (mode/ramp/mask intentionally not part of the segmentation key; nights with no recorded settings are bucketed into an honest `unknown` period rather than silently merged, and the legacy ResMed `-1` sentinel row — max pressure ≤ 1 cmH₂O — is partitioned off as `sentinel` and never aggregated). A selectable period table previews AHI, central index, leak, and usage per period with severity dots and an "n < 7 nights" warning badge; up to six periods can be compared at once. The Compare sub-mode renders per-config box-plot distributions for AHI, central index, leak, and usage using identity colours drawn from `--color-chart-1..8`, plus a diff readout for exactly-two selection with redundant ▲/▼ glyph, explicit sign, percent delta, and muted favourability colour (colour is never the sole signal). The Optimize sub-mode plots the chosen outcome against a chosen setting axis (min / max pressure or EPR level), with point area proportional to the number of nights per period. The persistent confounding caveat sits under the comparison: periods differ in season, weight, illness, and adherence — observed differences are associations, not proven effects. Settings-change boundaries detected by `detectSettingsChanges` now also render as faint dashed vertical markers across the synced AHI / leak / pressure / usage / event-breakdown charts in Trends (not just the settings chart), each with a native SVG `<title>` hover summary of the change (e.g. "max 12.0 → 15.0").
- **App-computed breathing-pattern detection surfaced across the app.** The periodic-breathing / Cheyne-Stokes detector and four-class TECSA trajectory classifier (ADR 0017) are now wired into the UI as **candidate flags, never diagnoses**. Surfaces:
  - **Signal Viewer.** Per-session candidate episodes are detected in a background worker after the canvas first-paints (so detection never blocks signals), then rendered on the airflow lane as the existing hatched / dashed-border / confidence-modulated wash. Each episode carries an HTML overlay confidence chip anchored to its start — low / moderate / high tier label plus a numeric percentage and a "PB" or "CSR" short label so colour is never the sole signal. Clicking the chip opens a popover with cycle length, modulation depth, duration, nadir character, a sub-threshold flag, and the persistent "candidate, not diagnosis" disclaimer. A new "Detections" group in the lane legend with a hatched violet swatch toggles the overlay on or off; the toggle persists per session alongside other lane preferences. A matching switch lives in the Lanes drawer for keyboard discoverability.
  - **Explore → Breathing Patterns.** A new view at `/explore/breathing` with three sections. A longitudinal TECSA overview shows the trajectory class (badge + non-colour shape ●◆▲■ + label drawn from the calm cyan→indigo→violet token ramp — never status-severe), early-vs-late CAI, usable-night fraction, a classifier confidence bar, the threshold, an inline CAI-over-time sparkline with a candidate-night marker, and a plain-language explainer keyed off the class. Honest "insufficient history — needs more usable nights" state when the classifier returns `available: false`. A filterable, sortable per-night episode catalog (by pattern, minimum confidence, date / cycle / duration / confidence) streams in night-by-night with a progress counter; each row deep-links into the Signal Viewer centred on the episode. A selected-episode detail panel shows full features with the standing disclaimer banner.
  - **Dashboard.** A new "Breathing stability" insight card surfaces the TECSA trajectory class for the active date range in the calm cyan→indigo→violet detection register (never red — TECSA is a trajectory, not an alarm), with early / late CAI, the threshold, a plain-language explainer, and a deep link to `/explore/breathing`. Honestly reports "insufficient history" when the range is too short or too leak-corrupted to classify.
  - All surfaces share the standard "Detected patterns are statistical candidates, not clinical diagnoses. Discuss with your clinician." disclaimer, the `--color-detection-*` / `--color-tecsa-*` design tokens (themed in light and dark), and the redundant non-colour cues required for WCAG-AA (shape + label + colour, numeric label alongside every confidence bar).
- **Event Explorer.** A new ad-hoc query tool for respiratory-event characteristics at Explore → Event Explorer (`/explore/events`), replacing the former fixed-section Event Analysis. A left-rail query builder combines filters with logical AND — event type(s) (color-dot chips, with a distinct hatched marker for sustained "detection" patterns like Periodic Breathing), and duration / pressure / leak / SpO₂ ranges (dual-thumb sliders always paired with numeric min/max inputs; range filters disable with an explanatory chip when the underlying field has no data in the matched set). A time-of-night window filters by local clock time and can wrap past midnight. A prominent matched-count "trust strip" ("N of M events match K filters") with a proportion bar updates live and is announced via `aria-live`. The full filter state is serialized to the URL (bookmarkable, back/forward-able), and named queries persist to `localStorage` (with four shipped examples). The same matched set drives five swappable views — a duration histogram (adjustable bin width, optional split-by-type stacking), a scatter of duration vs pressure/leak/SpO₂/time-of-night, per-type box/violin small-multiples, an inter-event-interval histogram, and FLG-bridged clustering (strict/balanced/lenient) — beneath a summary-stats strip. A virtualized, sortable event table (windowed for large sets, with a "showing N of M" note) lets you click any row to deep-link into the Signal Viewer centered on that event. The matched set can be exported to CSV or JSON entirely in-browser (with a warning before very large exports); no data leaves the device.
- **Google Health (Fitbit) data import.** Import sleep, heart rate, SpO₂, HRV, respiratory rate, activity, and more from a Google Takeout "Google Health" export. The import wizard now offers two source cards (CPAP SD Card / Google Health), with a scan-and-preview step that shows discovered data types grouped by tier, record counts, and date ranges. Incremental import with duplicate detection is supported. All parsing runs client-side — no data leaves the browser.
- **Cross-Source Analysis view.** New analysis view at Analysis → Integration Analysis with three tabs: Correlation Explorer (Pearson/Spearman with confidence intervals), Correlation Matrix (heatmap of CPAP × wearable metrics with significance highlighting), and Metric Comparison (Bland-Altman agreement analysis and lagged cross-correlation). Includes statistical interpretation text and caveats about correlation vs. causation.
- **Wearable data on the Dashboard.** When wearable data is available, a new panel shows key metrics (Sleep Score, HRV, Resting HR, SpO₂, Readiness, Steps) with 7-day trend indicators, plus a link to the Cross-Source Analysis view.
- **Help documentation for integrations.** Updated the "Importing Data" help article with Google Health instructions and supported data types. Added a new "Cross-Source Analysis" help article explaining correlation methods, interpretation guidance, and statistical caveats.
- **IndexedDB schema v3.** New `integration_timeseries` and `integration_import_history` object stores, plus compound indexes for efficient date-range and type-filtered queries. Automatic migration from v2.
- **Intraday heart-rate import.** Full-resolution (~5-second cadence) heart-rate samples from a Google Health export's `Global Export Data/heart_rate-*.json` files are now parsed and stored per night, in addition to the existing daily resting heart rate. This is the foundation for overlaying heart rate alongside CPAP airflow in the signal viewer and for within-night correlation. Stored at full resolution to preserve short-timescale features (≈0.4–0.6 MB per day); all parsing remains client-side.
- **Wearable health overlays in the signal viewer.** The per-session signal viewer (Sessions → a session → Signals) now overlays intraday wearable health signals alongside the CPAP channels on a shared time axis, so cardiac, respiratory, and sleep-architecture context can be read against airflow and pressure within the same night. New lanes: heart rate (the hero lane, ~5 s resolution), wearable SpO₂, HRV (5-min, step-rendered with sample markers), snoring, and a sleep-stage hypnogram (Wake/REM/Light/Deep as a categorical ribbon). A reorderable, toggleable, collapsible lane stack — accessed via a "Lanes" drawer (keyboard shortcut `L`) — offers presets (Respiratory focus, Cardio focus, Sleep architecture, Everything); lane visibility, order, and collapse state persist per session. A keyboard data cursor (arrow keys) announces a synchronized multi-lane readout at the cursor for screen-reader and keyboard users, and lanes are reorderable from the keyboard. Graceful fallbacks cover both the no-integration case (a hint linking to import) and nights that simply lack wearable coverage. Wearable signals load asynchronously so they never delay the CPAP signal's first paint. Requires a Google Health/Fitbit import containing intraday data for the overlays to appear.
- **In-app help articles for breathing patterns, intraday overlays, and the Event Explorer.** Three new help articles cover the new functionality at regulatory-grade depth: "Breathing Patterns: Periodic Breathing, Cheyne-Stokes & TECSA" documents the airflow-envelope detection method (autocorrelation periodicity, Guyot-style modulation index, harmonic-ratio crescendo-decrescendo morphology, AASM-criteria CSR scoring, Liu-2017 four-class TECSA trajectory), the literature it is grounded in (Berry 2012, Weinreich 2009, Javed 2018, Midelet 2023, Guyot 2019, Liu 2017, Nigam 2016, Kwok 2022), and the non-diagnostic framing (CSR ↔ heart-failure candidate signal, TECSA's ~60–80% spontaneous resolution, the SERVE-HF / Somers 2018 ASV contraindication in HFrEF); "Intraday Health Signals & Overlays" explains the wearable lane stack, the wall-clock-as-UTC alignment convention, how to read sparse vs. dense lanes (step rendering, dashed connectors), and what the overlays physiologically reveal around respiratory events; "Event Explorer" documents the AND-combined filters, the null-field semantics (bounded ranges exclude null fields, unbounded ranges pass nulls), every lens (duration histogram with overflow bin, decimated scatter, per-type box/violin, inter-event intervals, FLG-bridged clusters), URL-serialized and saved queries, and CSV/JSON export. New glossary entries: Periodic Breathing, TECSA, CAI (Central Apnea Index), Forced Oscillation Technique, Hypoxic Burden, Loop Gain, Apneic Threshold, Modulation Index, and Harmonic Ratio.

### Changed

- The Settings → Integrations → Fitbit section now reflects the file-based Google Health import (no longer shows an OAuth access token field). Shows import status, record count, and a link to the import wizard.
- The Analysis Hub's "Integration Analysis" card is no longer disabled/coming-soon.
- Reorganized the "Analysis" section into an intent-oriented "Explore" hub (`/explore`) with three explorations: Event Explorer (`/explore/events`), Correlations (`/explore/correlations`), and Pressure Optimization (`/explore/pressure`). The former Statistical Analysis and Cross-Source (Integration) Analysis are now combined under Correlations as deep-linkable tabs (`?tab=cross-source`). Old `/analysis/*` links redirect to their new locations.
- The Signal Viewer now accepts a `?t=<epochMs>` deep-link parameter that centers the initial viewport (±1 minute) on a given timestamp — used by the Event Explorer's event table to jump from a matched event straight to its waveform context. Targets outside the session's recording are ignored, and the snap applies once so subsequent panning/zooming is preserved.
- **Event deep links now frame the whole event.** Opening an event from the Event Explorer's event table or the Breathing (PB/CSR) episode catalog no longer drops you on a fixed ±1-minute window centered on the event's _start_ — which pushed the rest of a multi-minute periodic-breathing or Cheyne-Stokes episode off the right edge. The Signal Viewer now frames the entire event with comfortable margins, so the episode fills roughly 90% of the view and you can see it end to end at a glance. Very short or point-in-time events are given a sensible minimum window (~30 seconds) so there is always context around them. These links carry the event's full time span; older `?t=<epochMs>` links that encode only a single timestamp still open a centered ±1-minute window as before.
- **Signal Viewer lane labels are now a single, clearer label.** Each lane shows one label instead of two: the lane name is drawn in the lane's own line color, with the units in muted grey and a source tag (CPAP / WEAR / SLEEP) marking where the signal came from. This replaces the previous pair of labels and makes it immediately obvious which trace a label belongs to.
- **Signal Viewer lane controls are simpler.** To collapse or expand a lane, click its name — this replaces the separate collapse chevron button. A hide (✕) button now appears next to the lane's drag handle when you hover the lane (or move keyboard focus to it), so a lane can be removed without opening the Lanes drawer. Reordering is unchanged: drag the handle, or reorder from the keyboard.
- **The Signal Viewer legend bar is pinned and no longer scrolls horizontally.** The wide "Signals" toggle row has been removed from the legend bar — it was the cause of horizontal scrolling — and signal visibility is now managed entirely from the per-lane controls and the Lanes drawer. The DEVICE EVENTS and DETECTIONS legends remain, and the legend bar now stays fixed in place as you scroll.
- **Smoother Signal Viewer zoom and panning.** Wheel-zoom and click-drag scrubbing through high-frequency waveform data are now noticeably smoother, especially on long sessions. Each interactive frame no longer re-resolves event-marker colours per device event or re-runs full-resolution downsampling over the entire visible window: viewport-independent overlays and per-lane styling are computed once and reused, and each CPAP channel is backed by a precomputed multi-resolution pyramid so the work per frame stays bounded no matter how far you zoom out — keeping scrubbing and zooming fluid even on whole-night views with hundreds of events. The displayed waveform is unchanged.
- The Event Explorer's clustering, inter-event-interval, and duration-distribution analyses (formerly fixed sections of Event Analysis) are now selectable lenses over the filtered set. Kaplan-Meier survival analysis was retired with this view; the worker primitive remains available for analyses to reuse.

### Security

- Added an app-wide Content-Security-Policy to production builds, injected as a `<meta http-equiv>` tag at build time (GitHub Pages cannot set HTTP headers). Restricts scripts, styles, workers, connections, and embeds to same-origin; blocks external network calls until opt-in integrations are enabled.

### Fixed

- **Signal Viewer breathing-pattern (PB / CSR) confidence chips no longer overlap the lane label.** The clickable candidate chips were anchored at the very top of the airflow lane, where they collided with the newly repositioned lane label and pill — making the label unreadable and the chip hard to click. The chip band now sits just below the label band, so both are fully readable and clickable, with the chip's keyboard focus outline unclipped.
- **Breathing-pattern candidate detection (Periodic Breathing / Cheyne-Stokes) now produces genuinely measured, per-episode results instead of a single meaningless overlay.** The detector resampled its ventilation envelope incorrectly — ResMed MinuteVent is sampled at 0.5 Hz, but the envelope was zero-filled to a higher rate, producing a degenerate "comb" signal. As a result, every session showed one full-width detection band on the **Signal Viewer** airflow lane, and the **Explore → Breathing** (`/explore/breathing`) episode catalog reported near-identical, meaningless values for every night — confidence stuck around 47%, cycle length pinned to 40.0 s (the search-band floor), and modulation depth pinned to 1.00, all flagged "sub-threshold." The envelope is now resampled correctly (linear interpolation / decimation, never zero-fill), and the autocorrelation cycle-length estimator was hardened so it no longer pins to the search-band floor. Cycle length, modulation depth, and confidence are now measured genuinely per episode, and overlays mark only real candidate spans. These remain statistical **candidates, not diagnoses** — discuss any concerning pattern with your clinician. (The four-class TECSA trajectory classifier was reviewed and confirmed correct; it is unchanged. Because detection runs on demand in the analysis layer, no re-import is required — the corrected values appear on next view.)
- **Google Health import no longer silently imports zero records.** The directory scanner stored bare filenames instead of paths relative to the export root, so the import service could not locate files in their subdirectories. The import service also now resolves the export root directory consistently with the scanner, preventing path mismatches when the user selects a parent directory.
- **Dashboard no longer intermittently fails to load.** An IndexedDB connection failure during startup was cached permanently, causing every subsequent data query to fail silently and the dashboard to show the empty-state import wizard instead of therapy data. The singleton now retries on the next attempt. A contributing cause — unnecessary `transaction.abort()` calls on readonly verification transactions — was also removed.
- **AHI, compliance, and usage hours no longer read 0 for ResMed imports.** A regression caused usage time to be computed as zero for every night, which cascaded to AHI = 0 (usage is its denominator) and a 0% compliance rate — even though events, leak, and pressure were detected correctly. Two causes: (1) the machine's recorded mask-on/mask-off intervals from STR.edf were decoded as minutes-from-midnight when ResMed actually records them as minutes-since-noon (a noon-to-noon "session day"), so the intervals landed ~12 hours off and never matched any session; and (2) once STR mask data was present, a session with no matching interval was treated as authoritative zero usage instead of falling back to pressure-based detection. The STR decoding is corrected, and STR intervals are now used only when they actually overlap a session — otherwise the proven pressure-based usage detector is used — so a night with real therapy data can no longer be silently zeroed. Because nightly metrics are computed and stored at import time, **re-importing affected data is required** to recompute the corrected usage, AHI, and compliance values.
- **ResMed machine settings (min/max pressure, EPR, ramp, mode, mask, humidifier) now display instead of being blank.** The STR.edf `Date` channel was decoded with the wrong epoch — the Excel/Lotus 1900 serial-date origin (1899-12-30) instead of the Unix epoch (1970-01-01) — so each night's settings were keyed to dates in 1955–1956 and never matched any real session. `Session.machineSettings` was therefore always null, leaving the entire machine-settings UI dead. The decoder now uses the correct Unix epoch, so settings align with their sessions. Because settings are computed and keyed at import time, **re-importing affected data is required** for previously-imported sessions to show their settings.
- Help pages (Help home and Help articles) now render their intended card, input, button, and divider borders in both light and dark themes. These borders referenced an undefined `--color-border` design token and were silently invisible; they now use the defined `--color-border-default` token.

### Fixed (Phase 10: Correctness, Performance & UX pass)

- Data import no longer stalls at the start. Previously, starting an import could leave the progress indicator stuck at "0 / n imported" indefinitely, because the EDF parser failed to load in production builds. Imports now begin and progress normally.
- Import no longer fails to store sessions with a "machineId_date uniqueness" error. Multiple sessions on the same calendar day (e.g. a nap plus an overnight, or mask removal and reapplication) are now stored independently instead of colliding. Root cause was a wrongly-unique database index; a v1→v2 schema migration auto-upgrades existing databases losslessly on first launch — no re-import required.
- Empty or header-only ResMed files that contain no events (for example a CSL Cheyne-Stokes annotation file from a night with none) are now skipped quietly during import instead of being reported as errors. The import summary reports how many such files were skipped.
- Session writes are now atomic: a failure partway through writing a session no longer leaves orphaned nightly aggregates, events, or signal chunks behind.
- URL-encoded date ranges no longer shift by one day for users in time zones behind or ahead of UTC. Shared and bookmarked date-range links now resolve to the intended local dates.
- "Learn More" on the empty dashboard now navigates correctly within the app (previously a broken full-page link).
- The Signal Viewer no longer carries one session's hidden-channel selection over into another session; channel visibility is again scoped per session.
- "Delete all data" (in both Settings and the Data Management view) no longer fails with an `OPFS not initialized` error and could previously delete nothing; the OPFS signal-storage service now self-initializes, so a full wipe completes reliably. In Settings, a deletion failure is now surfaced to the user instead of being silently swallowed.
- "Delete all data" now also clears residual app-owned `localStorage`/`sessionStorage` entries — including the per-session Signal Viewer view preferences stored under `signal-viewer-hidden-<sessionId>` keys — so no session metadata survives a full wipe (previously these keys were left behind).

### Changed (Phase 10 — clinical: some displayed numbers will change)

> These corrections improve clinical and statistical accuracy. As a result, several metrics may display different values than in earlier versions. The new values are the correct ones; prior values were affected by the issues described below. This tool is for informational analysis and does not diagnose — discuss any changes that concern you with your clinician.

- **AHI now excludes RERAs (AASM / ICSD-3 correct).** Respiratory effort-related arousals (RERAs) were previously summed into the AHI — that quantity is actually the Respiratory Disturbance Index (RDI), not the AHI. Displayed AHI will be **lower** on nights that had RERAs. A separate **RDI** value (AHI + RERA index) is now reported. This also resolves an internal contradiction with the app's own glossary, which already (correctly) defined RERAs as part of RDI and not AHI.
- **ODI is now event-based.** The Oxygen Desaturation Index is now computed from discrete desaturation events (a fall of ≥3% below a rolling baseline, sustained ≥10 s, counted once per event) per hour of valid oximetry, replacing a per-sample-drop count. ODI values will change and are now clinically valid.
- **Usage time / mask-on detection now uses the machine's recorded intervals.** When ResMed's mask-on/mask-off intervals are present in STR.edf, they are used directly; otherwise an improved hysteresis detector (separate on/off thresholds) is used, replacing the previous fixed 2 cmH₂O instantaneous threshold. Because usage time is the denominator for AHI, ODI, leak-duration, and the CMS 4-hour compliance test, usage hours and these dependent metrics may shift slightly and are now more accurate. Subtherapeutic ramp handling is documented in the Usage Hours glossary entry.
- **T90 (% of time with SpO₂ < 90%) is now time-based**, integrating the duration spent below 90% over valid-oximetry time, with oximetry-dropout periods excluded from both numerator and denominator. An oximetry **coverage %** is now reported so SpO₂ statistics can be read in the context of how much valid signal a night actually had.
- **Missing samples are no longer folded in as real zeros.** Pressure, leak, and respiratory statistics are now computed only over recorded samples; sensor-gap periods are excluded rather than counted as zero, which previously biased means and percentiles downward.
- **Normality test correctly labeled Shapiro–Francia.** The implementation always computed the Shapiro–Francia statistic (the correlation-based variant), not Shapiro–Wilk; the label and the p-value transform are corrected to match.
- **"Median EPAP/IPAP" cards relabeled "Mean EPAP/IPAP"** in Pressure Optimization, because they compute the mean across nights of each night's median pressure (a mean of nightly medians), not a median.
- **Granger causality results now flag exploratory and non-stationary cases.** Selection-affected p-values (from scanning many metric pairs without multiple-comparison correction) and non-stationary inputs are now flagged, since both can produce spurious apparent "causality."

### Added (Phase 10)

- **RDI (Respiratory Disturbance Index)** metric: apneas + hypopneas + RERAs per hour (AHI + RERA index), always ≥ AHI. Includes a dedicated glossary entry and metric tooltip; device-derived RERA counts are noted as proxy estimates.
- **SpO₂ coverage %** metric: the fraction of analyzed time with a valid pulse-oximetry signal, surfaced as a data-quality denominator for all SpO₂ statistics.
- **Granger Causality tab** under Statistical Analysis: tests whether one nightly metric helps predict another (lagged VAR F-test) for a user-chosen metric pair (X→Y), reporting the F-statistic and p-value for that direction only. Granger causality measures predictive precedence, not physical causation, and the result is directional — it does not imply the reverse Y→X relationship.
- The tab surfaces statistical-honesty flags: an **"Exploratory p-value (lag auto-selected)"** badge when the lag is AIC-selected (selection-affected, anti-conservative inference), and a **non-stationarity caution** when an input series shows a significant linear trend. An **inference-mode control** (Exploratory auto-lag vs. Confirmatory fixed-lag) lets users pin a lag to obtain a clean inferential p-value, alongside an **AIC-by-lag chart** for inspecting the order-selection landscape.
- **"Empty files skipped" count** in the import summary, for transparency when header-only/event-free files are encountered.
- Glossary entries for **RDI**, **T90**, and **SpO₂ Coverage**; updated AHI, RERA, ODI, SpO₂, Usage Hours, Compliance, and Normal Distribution entries; help-article updates covering the Shapiro–Francia test, the Mean EPAP/IPAP relabel, Granger causality caveats, missing-data handling, and multiple-sessions-per-day import.
- **In-app help for Granger causality**: a dedicated "Interpreting Granger Causality" help article (with references) plus glossary entries for **Granger causality**, **F-test**, **AIC**, and **stationarity**, surfaced from the Granger Causality tab via a contextual help popover and an "how to read this tab" interpretation guide.
- **Full keyboard navigation for the Statistical Analysis tab strip** (WAI-ARIA APG tabs pattern, manual activation): arrow keys move focus between tabs with wrap-around, Home/End jump to the first/last tab, and Enter/Space activate the focused tab. Benefits all six tabs (Descriptive, Trends, Distribution, Correlation, Granger Causality, Hypothesis).

### Performance (Phase 10)

- Import parsing now runs in parallel across a worker pool, with signal buffers transferred (not copied) across the worker boundary, eliminating duplicate large-array allocations.
- Per-day streaming during import caps peak memory on large multi-year imports, and redundant per-channel sorts were removed. Net effect: faster imports and substantially lower memory use.

### Added (Phase 9: Analysis Views + Visualization Library)

- Analysis views: Statistical Analysis (`src/views/Analysis/StatisticalAnalysis/`), Event Analysis (`src/views/Analysis/EventAnalysis/`), and Pressure Optimization (`src/views/Analysis/PressureOptimization/`) with tabbed layouts following WAI-ARIA APG tabs pattern
- Chart library with interactive charts: ThemedLineChart, ThemedAreaChart, ThemedBarChart, ThemedScatterPlot (Recharts); BoxPlot, ViolinPlot, CorrelationHeatmap, KaplanMeierCurve, QQPlot, STLDecompositionPanel, CalendarHeatmap (D3)
- ChartContainer (`src/components/charts/ChartContainer.tsx`) with PNG export, View as Table toggle, loading skeleton, and error states
- `useAnalysis` hook for executing analysis with AbortController cancellation and result caching
- `useChartColors` hook for theme-aware chart color palette access
- Chart interaction store (`src/stores/useChartInteractionStore.ts`) for synchronized zoom/crosshair across linked charts
- All chart components wrapped in React.memo for render performance
- 87 new unit tests (1062 total) covering chart components, analysis views, hooks, and interaction store
- 132 new E2E tests (450 total across 3 browsers) covering analysis view rendering, chart interactions, parameter changes, and PNG export

### Added

- Event marker legend in signal viewer

### Changed

- Signal data now preloaded into memory for instant zoom/pan
- Crosshair renders via direct canvas calls for zero-lag response
- Channel/event legend always visible above chart

### Fixed

- Passive wheel listener warning in signal viewer
- Timeseries disappearing on zoom in signal viewer
- Loading flicker during pan in signal viewer
- Crosshair lag in signal viewer
- Empty unit parentheses for Snore/FlowLimitation channels
- Event timing offset for multi-file sessions

### Added (Phase 8: Analysis Engine — Advanced Algorithms)

- Shared math utilities module (`src/analysis/math/`) extracting lnGamma, regularizedIncompleteBeta, erf, normalCDF, studentTCDF, inverseNormalCDF, percentileFromSorted, and other helpers from duplicated implementations
- Hypothesis testing module (`src/analysis/hypothesis/`) with Mann-Whitney U test (exact DP for n ≤ 28, normal approximation with tie correction), Wilcoxon signed-rank test, Cohen's d / Hedges' g effect sizes, and paired before/after comparison helper
- Distribution analysis module (`src/analysis/distribution/`) with QQ-normal plot (Hazen formula), Shapiro-Wilk test (Royston approximation), Kolmogorov-Smirnov test (Dallal-Wilkinson p-value), and Gaussian KDE (Silverman bandwidth)
- Event analysis module (`src/analysis/events/`) with FLG-bridged clustering (3 presets: strict/balanced/lenient), K-means++ clustering (Arthur & Vassilvitskii 2007, deterministic PRNG), single-link agglomerative clustering, event duration distribution by type, and inter-event interval analysis
- False-negative event detection (`src/analysis/events/false-negatives.ts`) with heuristic FLG signal analysis and 3 sensitivity presets (conservative/balanced/aggressive)
- Survival analysis module (`src/analysis/survival/`) with Kaplan-Meier estimator, Greenwood variance, log-log transformed 95% confidence intervals, and median survival time
- Pressure analysis module (`src/analysis/pressure/`) with titration helper (optimal pressure range estimation), pressure-response curves, BiPAP EPAP×IPAP effectiveness analysis, and pressure variability metrics
- Granger causality analysis (`src/analysis/correlation/granger.ts`) with VAR model F-test, AIC-based optimal lag selection, and bidirectional causality testing via ml-matrix OLS
- All analysis output interfaces across descriptive, timeseries, and correlation modules marked with `readonly` properties for immutability
- Analysis worker updated with 16 new function exports for all Phase 8 algorithms
- 197 new unit tests (975 total across 49 test files) covering all Phase 8 modules with scipy/R reference validation
- 23 new E2E tests (69 across 3 browsers, 318 total) verifying Phase 8 algorithms execute correctly in real browser JavaScript engines

### Fixed (Phase 8)

- Granger causality F-distribution survival function formula corrected (was computing inverted p-values)
- Session comparison breadcrumb navigation URL pattern now correctly matches URLs with query parameters

### Added (Phase 7: Analysis Engine — Core Algorithms)

- Descriptive statistics module (`src/analysis/descriptive/`) with Welford's online algorithm for mean/variance/skewness/kurtosis, Type 7 interpolated percentiles, Tukey's fences outlier detection, and Freedman-Diaconis histogram binning
- Time-series analysis module (`src/analysis/timeseries/`) with rolling mean/median with confidence intervals, linear trend with t-test significance, LOESS smoothing (tricube kernel), PELT change-point detection, simplified STL decomposition, and ACF/PACF (Durbin-Levinson recursion)
- Correlation analysis module (`src/analysis/correlation/`) with Pearson and Spearman correlation coefficients, Fisher's z-transformation confidence intervals, correlation matrix computation, recursive partial correlation, and cross-correlation with configurable lag
- Analysis pipeline engine (`src/services/analysis/AnalysisEngine.ts`) with cache-first execution, lazy Comlink worker initialization, AbortSignal support, and metric extraction from NightlyAggregate data
- Analysis Web Worker (`src/services/workers/analysis.worker.ts`) exposing all 18 analysis functions via Comlink for off-main-thread execution
- Barrel re-export module (`src/analysis/index.ts`) for unified analysis API access
- 230 new unit tests (778 total) covering descriptive statistics, time-series analysis, correlation analysis, and AnalysisEngine pipeline
- 24 new E2E tests (72 across 3 browsers, 249 total) covering analysis module loading, in-browser algorithm execution, edge cases, and integration scenarios

### Added (initial)

- Initial project scaffolding and repository structure
- Project documentation and design specification
- Agent and skill definitions for AI-assisted development workflow
- CI/CD pipeline configuration via GitHub Actions
- Pre-commit hooks for code quality enforcement
- Complete TypeScript domain type system (`src/types/`) covering sessions, events, signals, analysis, plugins, errors, settings, and storage
- Design token system with CSS custom properties for light and dark themes (`src/styles/tokens.css`)
- CSS reset and base typography styles (`src/styles/reset.css`, `src/styles/base.css`)
- Theme provider with system preference detection, localStorage persistence, and real-time OS preference tracking
- 16 design system components built on Radix UI primitives (Button, Card, Input, Badge, Select, Switch, Tabs, Dialog, Tooltip, Accordion, Toast, Skeleton, Table, DropdownMenu, Popover, Slider)
- Application shell with sidebar navigation layout and responsive design
- React Router v6 routing with lazy-loaded views for all application sections (Dashboard, Sessions, Analysis, Reports, Data Management, Settings, Help)
- Zustand stores for application state (useAppStore), persisted settings (useSettingsStore), and data cache (useDataStore)
- Three-tier error boundary system (Root, Route, Component level) with recovery actions
- Bidirectional URL state sync hook for deep-linkable date ranges and session selection
- 113 unit tests across 15 test files
- E2E tests for navigation, theme switching, and responsive layout
- IndexedDB 7-store schema (`sessions`, `nightly_aggregates`, `events`, `analysis_results`, `settings`, `import_history`, `integration_data`) with full CRUD and cursor-based range queries
- OPFS signal storage service for Float32Array chunk read/write, quota checking, and streaming reads
- LRU cache service for analysis results with hash-based keys and import-triggered invalidation
- Schema migration framework with versioned up/down/verify and dependency resolution
- Comlink worker factory (`src/services/workers/createWorker.ts`) with typed wrappers, structured error marshalling, and timeout support
- Priority-based worker pool (`src/services/workers/WorkerPool.ts`) with round-robin dispatch, idle timeout, crash recovery, and graceful shutdown
- EDF binary parser (`src/parsers/edf/EDFParser.ts`) for fixed headers, per-signal headers, interleaved 16-bit data records, and EDF+ TAL annotations
- ResMed interpreter (`src/parsers/resmed/ResMedInterpreter.ts`) with channel label normalization, event annotation mapping, machine info extraction, and capability detection
- Session builder (`src/parsers/resmed/SessionBuilder.ts`) for multi-file merge, time alignment, session boundary detection, and usage time computation
- EDF validator (`src/parsers/validation/Validator.ts`) with header integrity checks, physiological range validation, AASM compliance, and AHI sanity checks
- Synthetic EDF data generator (`src/test/generators/edf-generator.ts`) for deterministic test data
- Import pipeline service (`src/services/import/ImportService.ts`) with File System Access API support, `<input type="file">` fallback, SHA-256 deduplication, and progress tracking
- EDF parser Web Worker (`src/services/workers/edfParser.worker.ts`) wrapping EDFParser + ResMedInterpreter + Validator behind Comlink interface
- AirSense 11 suffixed channel label support (Flow.40ms, MaskPress.2s, Leak.2s, etc.) in ResMedInterpreter
- Machine info extraction from EDF+ recordingId field (SRN=, MID=, VID= key-value parsing)
- Generic "Apnea" and CSR Start/End event type mapping in ResMedInterpreter
- Automatic leak unit conversion (L/s → L/min) for downstream consistency
- SpO2/Pulse sentinel value filtering (all-zero = no oximeter attached)
- Maximum file size guard (100 MB) in import pipeline
- Buffer bounds validation before signal header parsing in EDFParser
- Synthetic AirSense 11 EDF test fixtures with manifest (`tests/fixtures/edf/`)
- 84 new unit tests (424 total) covering fixture parsing, import pipeline, and interpreter edge cases
- 14 new E2E tests (27 total, 81 across 3 browsers) covering import routes, browser APIs, and fixture handling

### Fixed

- EDF parser now handles `numDataRecords = -1` (unknown record count per EDF spec) by computing actual count from file size
- EDF parser now allows `dataRecordDuration = 0` for EDF+ annotation-only files (EVE, CSL)
- TAL annotation parsing corrected to use `\x14` (not `\x15`) as duration-to-label separator per EDF+ specification
- SessionBuilder channel merge now prefers channels with more samples (not just higher sample rate)
- Validator now accepts `dataRecordDuration = 0` for annotation-only files
- Synthetic EDF generator TAL format corrected to match EDF+ specification
- GitHub Pages deployment now works correctly — configured Vite base path, React Router basename, and 404.html fallback for SPA routing on `/cpap-analyzer/` subpath

### Added (Phase 6: Session Views + Signal Viewer)

- Session list view (`src/views/Sessions/SessionList.tsx`) with filterable search, sortable columns (date, duration, usage, AHI, leak, events), pagination (25/page), and AHI severity badges
- Session detail view (`src/views/Sessions/SessionDetail.tsx`) with AHI breakdown (obstructive/central/mixed/hypopnea/RERA), leak metrics (median/P95/max/duration), pressure metrics (mean/median/P95/max with bilevel support), SpO₂ metrics (mean/min/<90%/ODI), event timeline, and event summary table
- Signal viewer (`src/views/Sessions/SignalViewer.tsx`) with Canvas 2D multi-channel waveform rendering, zoom (mouse wheel + presets: 1m/5m/30m/1h/All), pan (pointer drag), crosshair with time + value readout, event marker overlays, and OPFS signal streaming
- Canvas signal rendering engine (`src/components/charts/canvas/SignalRenderer.ts`) with DPI-aware rendering, multi-channel stacked display, grid lines, dynamic time axis formatting, and requestAnimationFrame coalescing
- Session comparison view (`src/views/Sessions/SessionComparison.tsx`) with session pickers, side-by-side metric table with delta columns (absolute + percentage), color-coded improvement direction, and CSS bar chart
- LTTB (Largest Triangle Three Buckets) downsampling Web Worker (`src/services/workers/downsample.worker.ts`) with min-max downsampling, Comlink.transfer() for zero-copy results
- Signal data hooks (`src/hooks/useSignalData.ts`): `useSessionDetail(sessionId)`, `useEventData(sessionId)`, `useSignalData(params)` with cached OPFS service and lazy worker creation
- Granular import progress reporting during parsing, building, and storing stages with per-file/per-session detail and setTimeout yields for UI repainting
- 80 new unit tests (548 total): LTTB/min-max downsampling correctness, SignalRenderer helper functions and spatial queries, session comparison delta calculations
- 19 new E2E tests (46 total, 138 across 3 browsers): session list rendering/filtering/sorting, session detail metrics and navigation, signal viewer chrome and controls, session comparison flow with deltas, full navigation journey

### Fixed (Phase 6 post-merge)

- Signal Viewer canvas now renders waveform data correctly — ResizeObserver/renderer setup used a `[]`-dependency `useEffect` that ran on mount when the canvas was not in the DOM (loading skeleton shown instead); converted to a callback ref pattern so setup happens when the canvas actually mounts
- Signal Viewer channel colors now match their designated palette — `CHANNEL_COLORS` keys corrected from PascalCase (`Flow`, `MaskPress`, `SpO2`) to camelCase (`flow`, `maskPressure`, `spo2`) matching the ResMed interpreter's output
- Signal Viewer zoom no longer truncates viewport at duration boundary — clamping logic corrected
- Signal Viewer pan no longer desyncs viewport start/end — pointer drag delta applied consistently
- Signal Viewer vertical scrolling no longer blocked — Ctrl/Cmd modifier required for wheel zoom, plain scroll passes through to overflow container

### Added (Phase 6 QA fixes)

- Multi-channel crosshair values on hover — hovering over the signal canvas shows interpolated physical values for all visible channels with coloured readout badges
- Loading indicator for signal data — semi-transparent overlay with spinner shown while channel data is being fetched/downsampled
- Clickable channel legend with persistence — legend buttons toggle channel visibility, hidden state persisted in localStorage per session

### Improved

- Import wizard now shows stage-specific progress labels and percentages during parsing, building, and storing stages (previously showed indeterminate state during CPU-intensive building)
