# 0025 — Trends Charts: Canvas2D + HTML Chrome + Overlay-Crosshair Rendering (No WebGL)

## Status

Proposed

## Context

The **Trends** view (`src/views/Trends/`) stacks six synchronized charts —
`AHITrendChart`, `UsageChart`, `EventBreakdownChart`, `LeakRateChart`,
`PressureChart`, `SettingsChart` (`src/views/Trends/charts/`) — over a shared
time x-axis (`SharedXAxis.tsx`). Each is a Recharts composition wrapped in a
`ResponsiveContainer` rendering to SVG. They plot **per-night
`NightlyAggregate[]`**: a few hundred to a few thousand **static** points,
already reduced from the 25 Hz signal upstream. The only interactions are a
**synced hover-crosshair** across the stack and **click-to-navigate** to a
night's session detail. Trends never pans or zooms high-frequency data.

The page feels sluggish, and a quick read of the cause matters because it
determines the fix. The sluggishness is **Recharts/SVG overhead**, not GPU
texture upload:

- Six `ResponsiveContainer` SVG charts emit a large number of DOM nodes
  (every tick, gridline, area, line vertex, and reference band is an SVG
  element). Layout and paint over that many nodes is inherently expensive.
- The stack is **hover-synced**: moving the pointer updates shared hover state,
  which re-renders the whole React/SVG chart stack on **every pointer move**.
  A hover that should repaint a 1 px crosshair instead reconciles and repaints
  the entire SVG tree.

This is a **different problem** from the one [0019](0019-webgl2-hybrid-waveform-rendering.md)
solved for the Session Signals viewer. ADR 0019 is GPU-bound: a real-browser
trace showed **1,127 ms of GPU time** spent **re-uploading full-size DPR-2
canvas textures every frame** while panning/zooming **hundreds of thousands of
25 Hz samples**. Trends has none of those forces — no per-frame re-upload, no
high-frequency sample stream, no continuous zoom. The expensive thing in 0019
(streaming dense geometry to the GPU each frame) simply does not occur here.

What **is** reusable from the signals work is the **architectural pattern**, not
the WebGL2 implementation:

1. **Canvas2D for the heavy series pixels** — draw the lines, bands, bars, and
   stacked areas once, imperatively, to a single canvas instead of thousands of
   SVG nodes.
2. **HTML/SVG retained for cheap, crisp chrome** — axis ticks and labels,
   tooltips, the screen-reader data tables, ARIA structure, and the
   `EventBreakdown` safety prompt. These are few in number, must stay
   text-crisp and accessible, and cost almost nothing in the DOM.
3. **A transparent overlay canvas for the crosshair** — so a hover repaints
   essentially nothing: clear and redraw a 1 px line on a small overlay, leaving
   the series canvas and all chrome untouched. This is the same
   overlay-crosshair split that made Session Signals hover cheap.

This is a rendering-architecture decision for the project's second most
chart-dense surface. It refines [0006](0006-recharts-d3-visualization.md)
(Recharts/D3 as the default for standard charts) by carving out Trends as a
bespoke-Canvas exception, in the same spirit that 0019 carved out the Signal
Viewer — but **explicitly without WebGL**.

**Hard product-owner constraint:** appearance and features must **not** change.
This is a rendering-substrate swap, not a redesign. Every chart must look and
behave as it does today (colors, bands, bars, step lines, tooltips, navigation,
accessibility).

## Decision Drivers

Resolved against the project priority order (Privacy > Correctness >
Performance > UX > Features):

- **Privacy.** Canvas2D executes entirely in the local browser; no data egress.
  Trivially satisfied, identical to SVG and to 0019.
- **Correctness (dominant).** Trends shows clinical trends. The substrate swap
  must not alter a single plotted value, band, or gap. In particular, no
  decimation or sampling step may fabricate, smooth, or hide a statistic. Null
  nights must remain **gaps**, never `0`.
- **Performance.** A synced hover must repaint **essentially nothing** (overlay
  crosshair only); the full series redraw happens only on data/size change, not
  on pointer move. This is the Sessions-level smoothness target, achieved by
  removing SVG-stack re-render, not by rendering fewer data points.
- **UX / fidelity.** No visible change to any chart — same look, same tooltips,
  same click-to-navigate, same accessibility. Chrome stays text-crisp because
  it stays in HTML/SVG.
- **Minimal dependencies.** Raw Canvas2D, no new rendering library.

## Considered Options

### A. Canvas2D + HTML chrome + overlay-crosshair (chosen)

Render the heavy series pixels of each Trends chart to a **Canvas2D** layer;
keep **axis ticks/labels, tooltips, screen-reader tables, ARIA, and the
EventBreakdown safety prompt in HTML/SVG**; draw the synced crosshair on a
**separate transparent overlay canvas** so a hover repaints only the overlay.

- **Pro.** Directly removes both measured costs: the SVG node explosion (one
  canvas draw replaces thousands of DOM nodes) and the per-hover SVG-stack
  re-render (the overlay isolates the crosshair). Reuses the proven Session
  Signals pattern. No new dependency. Chrome stays crisp and accessible because
  it is unchanged HTML/SVG. Appearance is reproducible 1:1 because Canvas2D
  draws the same primitives Recharts does (lines, filled bands, bars, stacked
  areas, step lines) with the same theme colors.
- **Con.** Series rendering becomes **imperative drawing code** the team now
  owns per chart type (line, band/area, bar, stacked count, step). DPR handling,
  theme-color wiring, hit-testing for click-to-navigate, and gap semantics must
  be reimplemented off Recharts. A pixel-level appearance-fidelity bar must be
  met to honor the "appearance must not change" constraint.

### B. Full WebGL2 port, like Session Signals (rejected)

Port Trends onto the WebGL2 hybrid renderer from
[0019](0019-webgl2-hybrid-waveform-rendering.md).

- **Con.** Solves a problem Trends does not have. Trends is **not** GPU-bound;
  there is no per-frame re-upload to eliminate because there is no pan/zoom of
  dense geometry. It would force **bars, stacked areas, hatch fills, and
  percentile bands** through a shader pipeline — shapes that are awkward in
  WebGL and carry **high appearance-fidelity risk** at DPR 2 against a strict
  "must look identical" constraint. It imports the full 0019 robustness tax
  (context-loss handling, a permanent Canvas2D fallback, a pixel-diff fidelity
  gate) for **no measurable gain** on a few-thousand-point static dataset.
  **Rejected.**

### C. Stay on Recharts and micro-optimize (rejected)

Keep the SVG charts and tune them: memoize series, throttle hover, move
synced-hover state out of React, virtualize ticks.

- **Con.** Does not reach Sessions-level smoothness. Even with hover state
  hoisted out of React, a synced crosshair that visually tracks the pointer
  still drives **re-render/repaint of the SVG stack** (the crosshair and active
  tooltip are SVG nodes inside each chart). The fundamental cost — thousands of
  SVG nodes laid out and painted, re-touched on hover — is structural to the
  SVG substrate, not a tuning parameter. **Rejected.**

## Decision Outcome

Adopt **Option A**: migrate the six Trends charts off Recharts/SVG onto a
**Canvas2D + HTML-chrome + separate overlay-canvas-crosshair** architecture —
the **same architectural pattern** as Session Signals
([0019](0019-webgl2-hybrid-waveform-rendering.md)), but **without WebGL**.

- **Canvas2D draws the heavy series pixels** of each chart: AHI rolling-median
  centre line + P25–P75 band + faint raw per-night line; usage bars; stacked
  event counts; leak/pressure lines + P95 bands; settings step lines and change
  markers.
- **HTML/SVG retains the chrome**: axis ticks and labels, tooltips, the
  screen-reader data tables, ARIA structure, visible focus, and the
  EventBreakdown safety prompt. These stay text-crisp and accessible.
- **A transparent overlay canvas owns the synced crosshair**, so a hover clears
  and redraws only the overlay; the series canvas and chrome are untouched.
  Click-to-navigate is handled by hit-testing the nearest night to the pointer.
- **No WebGL.** Raw Canvas2D only; no new rendering dependency; no context-loss
  fallback machinery (Canvas2D has no analogous loss mode for this use).
- **Appearance and features do not change.** This is a substrate swap. The
  output must be visually indistinguishable from the current Recharts charts.

### Honesty sub-decision: per-pixel min/max envelope applies to exactly one series

The signal renderer's **column-envelope reduction** (per horizontal pixel
column, draw the min **and** max of the samples falling in that column so a
spike can never fall _between_ sampled pixels and vanish) is a correctness
technique for **overplotted raw data**. It is borrowed here under a strict,
narrow rule:

- **Apply it to exactly one series:** the **faint raw per-night AHI line in
  `AHITrendChart`** — and **only when `nights > horizontalPixels`** (more than
  one night maps to a single pixel column). This is the **only** raw,
  un-aggregated, overplotted series in Trends where a single-night spike could
  otherwise be dropped by naive per-pixel sampling and silently disappear.
- **Do not apply it to anything else.** Specifically **not** to: rolling-median
  centre lines, percentile bands (AHI P25–P75; Leak/Pressure P95), usage bars,
  stacked event counts, or settings step lines. These are **already aggregated
  statistics**; running a min/max envelope over them would **fabricate or
  misrepresent** the statistic (e.g. turning a median into an apparent
  min–max ribbon, or widening a percentile band beyond its computed bounds).
  That would violate **Correctness**, the dominant driver.
- **Null nights stay gaps, never `0`.** A missing night is a break in the line /
  an absent bar, exactly as today. The envelope must skip gaps, not interpolate
  or zero-fill across them.

This sub-decision exists because the envelope technique is **safe only for raw
overplotted series** and **dangerous for aggregates** — and Trends is mostly
aggregates. Naming the single legitimate use prevents the technique from
spreading into series where it would lie about the data.

## Consequences

### Positive

- **Removes the structural cost.** One Canvas2D draw replaces thousands of SVG
  nodes per chart; the per-hover SVG-stack re-render is gone because the
  crosshair lives on an isolated overlay.
- **Sessions-level hover smoothness.** A synced hover repaints only the small
  overlay canvas — essentially nothing — so the crosshair tracks the pointer
  without touching the series or chrome.
- **No appearance or feature change.** By design the charts look and behave
  exactly as today; the product-owner constraint is honored.
- **Chrome stays crisp and accessible.** Axes, labels, tooltips, ARIA, and the
  screen-reader tables remain HTML/SVG — text-crisp, themeable, and keyboard-
  and screen-reader-friendly with no Canvas accessibility workarounds.
- **No new dependency, no privacy cost.** Raw Canvas2D, local only.
- **Right-sized vs 0019.** Gets the reusable win (the rendering _pattern_)
  without the WebGL robustness tax that 0019's data shape justified but this one
  does not.

### Negative

- **Per-chart imperative drawing code to own.** Lines, bands/areas, bars,
  stacked counts, and step lines must each be drawn in Canvas2D, with DPR
  scaling, theme-color wiring, gap handling, and hit-testing for
  click-to-navigate — logic Recharts previously provided.
- **A pixel-level appearance-fidelity bar.** Because appearance must not change,
  the Canvas output must match the current Recharts look closely enough to be
  indistinguishable; this needs verification (visual diff / owner sign-off),
  and the sandbox cannot render-verify pixels.
- **Accessibility must be re-wired deliberately.** Canvas is not in the
  accessibility tree, so the screen-reader data tables and ARIA that Recharts
  partly implied must be authored explicitly in the retained HTML chrome.
- **Two chart substrates in the codebase.** Trends (Canvas2D) and the remaining
  Recharts charts diverge; contributors must know which surface uses which.

### Neutral

- **The renderer is a hybrid, by design** — Canvas2D pixels, HTML/SVG chrome,
  overlay-canvas crosshair — mirroring 0019's split, minus WebGL.
- **No fallback machinery.** Unlike 0019, there is no context-loss path: plain
  Canvas2D has no comparable loss mode here, so no permanent secondary renderer
  is maintained.
- **Recharts remains the project default** ([0006](0006-recharts-d3-visualization.md)).
  Trends joins the Signal Viewer as a bespoke-Canvas exception; this does not
  change the default for other charts.
- **The min/max envelope is deliberately scoped to one series.** Its absence on
  aggregates is a correctness choice, not an oversight.

## Confirmation

How adherence to this decision is verified:

- **Appearance-fidelity check (blocking).** Visual comparison of each migrated
  Trends chart against the current Recharts rendering (visual-diff where
  feasible, plus product-owner confirmation in production, since the sandbox
  cannot verify Canvas pixels). Colors, bands, bars, step lines, and gaps must
  match.
- **Hover-repaint check.** Assert that a synced hover repaints only the overlay
  canvas — the series canvas and HTML chrome are not redrawn on pointer move.
- **Envelope-scope test.** Assert the per-pixel min/max envelope is applied to
  the raw per-night AHI line **only** when `nights > horizontalPixels`, and to
  **no** aggregated series (medians, percentile bands, bars, stacked counts,
  step lines). Assert null nights render as gaps, never `0`, on every series.
- **Accessibility check.** Keyboard navigation, ARIA, visible focus, and the
  screen-reader data tables work on the retained HTML chrome (WCAG AA);
  click-to-navigate hit-testing is reachable without a pointer.
- **`data-science` / `data-visualization` review.** Confirm no plotted statistic
  is altered by the substrate swap or the envelope.
- **`qa` gate.** No merge to `main` until the appearance-fidelity check, the
  envelope-scope tests, and accessibility verification pass; QA can block.

## Related Decisions

- [0019 — WebGL2 Hybrid Rendering for Dense Signal-Viewer Waveform Lanes](0019-webgl2-hybrid-waveform-rendering.md)
  — the source of the Canvas-for-pixels / HTML-for-chrome / overlay-for-crosshair
  **pattern** and the min/max column-envelope technique reused here; this ADR
  applies the pattern **without WebGL** because Trends is not GPU-bound.
- [0006 — Recharts + D3 for Visualization](0006-recharts-d3-visualization.md)
  — the default this refines; Trends becomes a bespoke-Canvas exception
  alongside the Signal Viewer.
- [0008 — Web Workers for Heavy Computation](0008-web-workers-heavy-computation.md)
  — `NightlyAggregate[]` reduction happens off the main thread; the Canvas
  renderer consumes the already-reduced aggregates.
- [0015 — Zero Telemetry and Analytics](0015-zero-telemetry-analytics.md)
  — Canvas2D is local; no new data egress.
