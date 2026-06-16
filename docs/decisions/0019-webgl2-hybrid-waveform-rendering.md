# 0019 — WebGL2 Hybrid Rendering for Dense Signal-Viewer Waveform Lanes

## Status

Accepted

## Context

The Signal Viewer (`src/views/Sessions/SignalViewer.tsx`, drawing via
`src/components/charts/canvas/SignalRenderer.ts`) renders stacked CPAP waveform
lanes as Canvas2D. Pan and continuous wheel-zoom over whole-night data feel
sluggish, and prior optimization work did not fix it.

A real-browser (Microsoft Edge) performance trace of a single **1,213 ms
drag-pan** localized the bottleneck precisely:

- **Renderer main thread busy: 74 ms.** The main thread is essentially idle.
- **GPU process main thread busy: 1,127 ms (~93% of the interaction).**
- **~9 fps**, **31 dropped frames**, **~266–333 MB GPU memory** during the pan.

So pan/zoom is **GPU-bound, not main-thread bound.** The root cause is how
Canvas2D reaches the screen: the signal canvas is sized to the **full stacked-lane
content height at `devicePixelRatio` 2**, and a 2D canvas **re-uploads its entire
backing texture to the GPU on every change**. Each pan frame we redraw the whole
canvas — and, since the crosshair was split onto its own full-size overlay canvas
in a prior PR, we now re-upload **two** full-size DPR-2 textures per frame. The
limiter is **GPU texture-upload bandwidth**, not drawing time.

This explains why earlier shipped work moved the needle on the wrong metric.
rAF-coalescing, the zero-allocation LTTB scratch-buffer reuse, the min/max
envelope, and the crosshair-overlay split all reduced **main-thread** cost — which
the trace shows was never the limiter (74 ms). Pan/zoom feel was unchanged because
none of them reduce per-frame texture upload. Two follow-on caveats define the
problem space:

- A pure transform-pan (CSS-translating an already-rasterized canvas during a
  drag) can avoid re-upload **for panning**, but a CSS translate cannot fake a
  **rescale** — so **continuous/live wheel-zoom** still re-renders and re-uploads
  every step. Zoom is the case the cheap fix cannot fully solve.
- The extrema-preservation contract (the decimation pyramid in
  `src/components/charts/canvas/decimationPyramid.ts` preserves min/max at every
  level so a 1-sample spike or notch is never hidden), the gap/break semantics,
  and the exact DPR-2 look (a ~1.2 px anti-aliased, round-joined line; thin
  envelope ribbons) are **correctness requirements**, not aesthetics. Any new
  renderer must reproduce them.

This is a rendering-architecture decision for the project's most data-dense
surface, building on [0006](0006-recharts-d3-visualization.md) (Recharts/D3 for
standard charts; the Signal Viewer is the bespoke Canvas exception) and
[0008](0008-web-workers-heavy-computation.md) (pyramid/envelope geometry is
prepared off the main thread).

## Decision Drivers

Resolved against the project priority order (Privacy > Correctness > Performance >
UX > Features):

- **Privacy.** WebGL executes entirely in the local browser/GPU; no data egress.
  Trivially satisfied, same as Canvas2D.
- **Correctness / fidelity (dominant).** This is health data. A new renderer must
  match the current look at **DPR 2**, preserve the **extrema-preservation
  contract** and **gap/break semantics**, and match theme colors exactly
  (sRGB-correct). Fidelity outranks performance — so the fast path may not ship as
  default until it is objectively proven to match the reference.
- **Performance.** Target **60 fps for pan _and_ continuous zoom** on whole-night,
  full-resolution data; the win must come from **eliminating per-frame texture
  re-upload**, not from rendering fewer pixels.
- **UX.** Crisp, responsive interaction with no visible regression in line quality,
  crosshair behavior, or accessibility overlays.
- **Minimal dependencies.** Prefer raw platform APIs over a new rendering library.

**Hard constraint:** keep `devicePixelRatio` 2 (full crispness). Lowering DPR was
ruled out by the product owner.

## Considered Options

These options were synthesized from two specialist design reports.

### A. Canvas2D structural fixes (transform-pan + viewport-sized canvas)

Keep Canvas2D but fix how it reaches the GPU: **transform-pan with overscan**
(CSS-translate the already-rasterized canvas during a drag, re-render only on
settle), a **viewport-sized canvas** (not full-content height), and **skip the
crosshair-overlay re-upload during drags**.

- **Pro.** Lowest risk; byte-exact fidelity (it _is_ the current renderer); zero
  new dependencies; fast to ship; directly removes the per-frame upload for panning.
- **Con.** A CSS translate cannot fake a rescale, so **continuous/live wheel-zoom
  still re-renders and re-uploads per step** — the single case it structurally
  cannot solve. Leaves zoom GPU-bound.

### B. WebGL2 hybrid renderer (chosen)

Render the **dense waveform lanes** (the zoomed-out min/max envelope and the
zoomed-in per-sample line) in **WebGL2**, with the waveform geometry living in
**GPU vertex buffers**. Pan **and** zoom become a change to a transform uniform
plus a scissor rectangle — **no per-frame re-upload**. **Everything else stays on
Canvas2D**: axes, grid, tick/time labels, event-marker rectangles, detection
washes, the hypnogram ribbon, sparse/step lanes, and the crosshair overlay.

- **Pro.** Solves pan **and** continuous zoom in one architecture; eliminates the
  measured 1,127 ms re-upload; lower GPU memory; the min/max envelope maps
  naturally to **triangle strips** (GPU-friendly) and the existing pyramid keeps
  vertex counts tiny. The pyramid/envelope/worker geometry is renderer-agnostic
  and is reused unchanged — the extrema contract lives **outside** the renderer.
- **Con / risk.** **Fidelity risk at DPR 2:** matching the 1.2 px anti-aliased,
  round-joined line requires **instanced-quad line expansion with shader
  feathering**; thin envelope bands need a **min-thickness clamp**; theme-color /
  sRGB must match exactly. **Robustness tax:** WebGL **context-loss handling**, a
  permanent **Canvas2D fallback**, and a mandatory **objective fidelity gate**
  before it can become default. Text stays on Canvas2D (WebGL text rendering is the
  known pain point and offers no benefit here).

### C. OffscreenCanvas in a Web Worker

Move Canvas2D drawing off the main thread into a worker via OffscreenCanvas.

- **Con.** It relocates **drawing**, but the trace shows drawing (74 ms) is not the
  limiter — the limiter is GPU compositing/upload, which OffscreenCanvas does not
  address. **Rejected.**

### D. Reduce devicePixelRatio

Render the canvas at DPR 1 (or adaptively during interaction) to cut texture size.

- **Con.** Trades fidelity for speed on a health-data view; sacrifices crispness.
  **Rejected by the product owner** on fidelity grounds.

## Decision Outcome

Adopt **Option B: a WebGL2 hybrid renderer.**

- **WebGL2 renders only the dense waveform lanes** — the zoomed-out min/max
  envelope (triangle strips) and the zoomed-in per-sample line (instanced quads
  with shader feathering). Pan and zoom are a transform-uniform + scissor change
  with **no per-frame texture re-upload**.
- **Canvas2D renders everything else and remains the permanent fallback** — axes,
  grid, tick/time labels, event-marker rectangles, detection washes, the
  hypnogram ribbon, sparse/step lanes, and the crosshair overlay. When WebGL2 is
  unavailable or the context is lost, the Signal Viewer renders entirely on
  Canvas2D with no loss of function.
- **The implementation is raw WebGL2 — no new rendering dependency** — per the
  minimal-dependencies driver.
- **The pyramid, envelope, and worker geometry are reused unchanged.** The
  extrema-preservation contract and gap semantics live outside the renderer, so
  both rendering paths consume the same geometry and inherit the same guarantees.

The choice is **conditioned**, because correctness/fidelity outranks performance:

1. **Canvas2D fallback is retained permanently** (not a transitional shim), and is
   selected **automatically at runtime** when WebGL2 is unavailable or the GPU
   context is lost — this is graceful degradation, **not** a feature flag.
2. **No build/user feature flag.** This is a two-user FOSS app; gating machinery is
   unwarranted ceremony. WebGL2 is the default waveform renderer; if it ever
   regresses in production it is reverted at the PR level, not toggled.
3. **A mandatory objective fidelity gate must pass in CI before merge:**
   pixel-diff against the Canvas2D reference within a defined tolerance, **SSIM**,
   a **spike-survival** check (the extrema contract holds end-to-end through the
   GPU path), and **gap-break** tests — all at DPR 2 — plus production verification
   by the owner (the sandbox cannot render WebGL).

The product owner selected WebGL2 hybrid over the cheaper Option A specifically
because Option A leaves **continuous zoom GPU-bound**, while WebGL2 solves pan and
zoom in a single architecture. The conditions above are what make that defensible
under the priority order.

## Consequences

### Positive

- **Removes the measured bottleneck.** Eliminates the per-frame texture re-upload
  that consumed the 1,127 ms GPU time; pan and zoom become uniform/scissor changes.
- **60 fps pan _and_ continuous zoom** ceiling on whole-night, full-resolution data
  at DPR 2 — without lowering DPR.
- **Lower GPU memory** and headroom to scale to many stacked lanes.
- **Reuses existing geometry.** The decimation pyramid, min/max envelope, and
  worker preparation are renderer-agnostic and reused unchanged; the
  extrema-preservation contract is preserved by construction because it lives
  outside the renderer.
- **No privacy cost.** WebGL is local; nothing leaves the browser.
- **No new rendering dependency.** Raw WebGL2 keeps the dependency surface minimal.

### Negative

- **A new rendering primitive on health data.** WebGL drawing of clinical waveforms
  requires a `security` sign-off and broadens what can go subtly wrong visually.
- **Robustness tax.** WebGL **context-loss handling** plus a maintained **Canvas2D
  fallback** is real, permanent complexity (two paths to keep in sync).
- **Fidelity-matching effort at DPR 2.** Reproducing the 1.2 px anti-aliased,
  round-joined line (instanced quads + shader feathering), the thin-band
  min-thickness clamp, and exact sRGB theme colors is non-trivial shader work.
- **A permanent pixel-diff fidelity test suite** (pixel-diff + SSIM +
  spike-survival + gap-break) must be authored and maintained as a standing gate.
- **Sandbox/CI caveat.** WebGL output cannot be visually verified in the headless
  sandbox; correctness is validated via CI (with a GPU-capable runner where
  available) and in production, and guarded by the fidelity gate.

### Neutral

- **The renderer is a hybrid, by design.** Text and chrome stay on Canvas2D
  because WebGL text rendering offers no benefit here and is the known pain point;
  the two surfaces are composited deliberately.
- **Canvas2D is the permanent fallback, not a deprecated path.** It remains a
  first-class, fully functional renderer that the automatic runtime fallback
  (unsupported WebGL2 / context loss) relies on indefinitely.
- **No feature flag; the fidelity gate guards merge, not a toggle.** WebGL2 is the
  default once the CI fidelity gate passes and the owner has confirmed in
  production; there is no opt-in flag to maintain.
- **Option A's transform-pan idea is not foreclosed.** Should it ever be needed as
  a further Canvas2D fallback optimization, it remains compatible with this
  architecture; it was set aside because it cannot solve live zoom, not because it
  is wrong.

## Confirmation

How adherence to this decision is verified:

- **Objective fidelity gate (blocking, before default-on).** Automated pixel-diff
  of the WebGL output against the Canvas2D reference within tolerance, plus SSIM,
  at DPR 2, across themes.
- **Spike-survival test.** Asserts a 1-sample spike/notch survives end-to-end
  through the WebGL path (the extrema-preservation contract holds in the GPU
  renderer, not only in the pyramid).
- **Gap-break test.** Asserts gap/break semantics render identically on both paths.
- **Context-loss / fallback test.** Forces WebGL context loss and asserts the
  Signal Viewer falls back to Canvas2D with no loss of function.
- **`security` sign-off.** Required because this introduces a new rendering
  primitive over imported health data.
- **`qa` gate.** No merge to `main` until the fidelity gate and the automatic
  Canvas2D fallback are verified; QA can block.

## Related Decisions

- [0006 — Recharts + D3 for Visualization](0006-recharts-d3-visualization.md) — the
  Signal Viewer is the bespoke Canvas/WebGL exception to the Recharts default.
- [0008 — Web Workers for Heavy Computation](0008-web-workers-heavy-computation.md) —
  the pyramid/envelope geometry consumed by both rendering paths is prepared off
  the main thread.
- [0015 — Zero Telemetry and Analytics](0015-zero-telemetry-analytics.md) — WebGL
  is local; no new data egress.
