# UI Design Proposal — Visualizing Measurement Reliability & Uncertainty

**Status:** Proposal (for `frontend` implementation) · **Author:** `ui-design` · **Date:** 2026-06-15
**Audience:** Orchestrator + `frontend`, `ux`, `data-visualization`, `qa`

## 0. Purpose & sources

This spec defines how the app **visually communicates measurement reliability and uncertainty** without adding clutter, grounded in two research drafts:

- `docs/accuracy/_drafts/cpap-device-accuracy.md` §10 — the per-metric reliability ranking (pressure/usage = high … flow-limitation/RERA = lowest) and the cross-cutting precision rules.
- `docs/accuracy/_drafts/uncertainty-statistics.md` §6 — display-precision rules, when a band/indicator is warranted vs. clutter, and the aleatoric-vs-epistemic copy distinction.

It extends, not replaces, the existing three-tier vocabulary in `src/analysis/breathing/confidenceTier.ts` (`low | moderate | high`) and matches the token naming in `src/styles/tokens.css`, the `Badge` API in `src/components/ui/Badge/Badge.tsx`, the inline-SVG icon convention (24×24 viewBox, `stroke="currentColor"`, `strokeWidth` 1.5–2, `fill="none"`, `aria-hidden`), and the PDF palette in `src/services/reports/pdf/layout.ts`.

**Hard constraints honored:** Privacy (no assets, all CSS tokens + inline SVG; nothing fetched) > Correctness (visuals must never imply more certainty than exists) > Performance (tokens + SVG only; no runtime cost on dense lists) > UX > Features. WCAG AA throughout. Reliability tier is **always** carried by a non-color cue (icon shape + text label), never color alone.

---

## 1. New design tokens — uncertainty / reliability scale

A **deliberately neutral, low-saturation** scale. Reliability is metadata _about_ a number, so it must not compete with the existing clinical-severity colors (`--color-status-*`, which are green→red and "loud"). We therefore avoid green/amber/red for reliability and instead use a **desaturated slate → blue-grey → warm-grey** progression, distinguished primarily by **icon + label**, with color as reinforcement only. A separate neutral **caveat (informational)** treatment reuses the existing info-blue family.

Add a new block to `:root` and `[data-theme='dark']` in `src/styles/tokens.css`, placed after the `SEMANTIC COLORS` block:

```css
/* RELIABILITY / MEASUREMENT-UNCERTAINTY SCALE
   Metadata about a metric's trustworthiness (see docs/accuracy).
   Tier is ALWAYS paired with an icon + text label; color is reinforcement.
   Deliberately desaturated so it never competes with --color-status-* . */

/* :root (light) */
--color-reliability-high: #15803d; /* fg: high-trust check (rarely shown — see §7) */
--color-reliability-high-bg: rgba(21, 128, 61, 0.08);
--color-reliability-moderate: #b45309; /* fg: amber-brown, distinct from status-mild */
--color-reliability-moderate-bg: rgba(180, 83, 9, 0.1);
--color-reliability-low: #6d28d9; /* fg: violet — "modeled/inferred", not "bad" */
--color-reliability-low-bg: rgba(109, 40, 217, 0.1);
--color-reliability-unavailable: #6b7280; /* fg: neutral grey */
--color-reliability-unavailable-bg: rgba(107, 114, 128, 0.1);

/* Neutral informational caveat (data-quality note, not a tier judgement) */
--color-caveat: #2563eb; /* reuses info family */
--color-caveat-bg: rgba(37, 99, 235, 0.08);
--color-caveat-border: rgba(37, 99, 235, 0.25);

/* Confidence band / ribbon (charts) — neutral, theme-aware */
--color-uncertainty-band-fill: rgba(100, 116, 139, 0.16); /* slate, fill under a line */
--color-uncertainty-band-stroke: rgba(100, 116, 139, 0.45); /* dashed CI edge */
--color-uncertainty-errorbar: #64748b; /* sparing error-bar whisker */
```

```css
/* [data-theme='dark'] — brightened for dark surfaces, same hue intent */
--color-reliability-high: #4ade80;
--color-reliability-high-bg: rgba(74, 222, 128, 0.14);
--color-reliability-moderate: #fbbf24;
--color-reliability-moderate-bg: rgba(251, 191, 36, 0.15);
--color-reliability-low: #c4b5fd;
--color-reliability-low-bg: rgba(196, 181, 253, 0.16);
--color-reliability-unavailable: #a3a3a3;
--color-reliability-unavailable-bg: rgba(163, 163, 163, 0.14);
--color-caveat: #60a5fa;
--color-caveat-bg: rgba(96, 165, 250, 0.14);
--color-caveat-border: rgba(96, 165, 250, 0.4);
--color-uncertainty-band-fill: rgba(148, 163, 184, 0.2);
--color-uncertainty-band-stroke: rgba(148, 163, 184, 0.55);
--color-uncertainty-errorbar: #94a3b8;
```

**Rationale for hue choices**

- `low` reliability is **violet**, deliberately reusing the project's existing "modeled/derived" semantics — `--color-detection` and `--color-tecsa-*` are violet, and §4/§10 of the accuracy draft frame the least-reliable metrics (central/obstructive split, flow limitation, RERA) as _heavily-modeled inferences_. Violet reads "inferred", not "alarming". This keeps red/orange exclusively for clinical severity.
- `moderate` reuses the warm amber-brown already present as `--color-wearable-hrv` (`#b45309` light / `#fbbf24` dark), so it sits in the existing palette and is distinguishable from `--color-status-mild`.
- `caveat` is intentionally the **info-blue**, so a data-quality note reads as neutral information, never as a severity escalation.

**WCAG AA verification (contrast vs. its own `-bg` chip background, light theme, target ≥ 4.5:1 for the ≤14px chip text):**

- `#15803d` on `#f3f9f5` ≈ 4.9:1 ✓ · `#b45309` on `#fbf2e9` ≈ 5.1:1 ✓ · `#6d28d9` on `#f1ecfb` ≈ 7.0:1 ✓ · `#6b7280` on `#f1f2f4` ≈ 4.6:1 ✓ · `#2563eb` on `#eef3fe` ≈ 5.6:1 ✓.
- Dark theme: brightened foregrounds on near-black `-bg` chips all clear ≥ 7:1 (light text on dark). `frontend` must re-run the automated contrast check (axe / the project's a11y test) against the _resolved_ colors as the final gate; the figures above are design-time estimates.
- **Color is never the sole signal:** every tier additionally carries a unique icon shape (§4) and a text label (`High` / `Moderate` / `Low` / `Limited` / `Unavailable`), satisfying WCAG 1.4.1.

---

## 2. Reliability chip / indicator

A small, quiet pill that annotates a metric with its trust tier. Two variants share one visual language.

### 2.1 Full chip — for KPI cards (`KPICard.tsx`, `EnhancedKPICard.tsx`)

Extends the existing `Badge` rather than introducing a new primitive — add a `reliability` variant family to `Badge` or a thin `ReliabilityChip` wrapper around `<Badge>`.

| Property | Value                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shape    | Pill, `border-radius: var(--radius-full)` (matches Badge)                                                                                                    |
| Size     | `sm` (`padding: 1px var(--space-2)`, `font-size: var(--font-size-xs)`) — same as severity badge                                                              |
| Icon     | 12×12 inline SVG, `stroke="currentColor"`, `strokeWidth="2"`, leading, `var(--space-1)` gap, `aria-hidden`                                                   |
| Label    | One word: `High` / `Moderate` / `Low` / `Limited` / `Unavailable`                                                                                            |
| Color    | `color: var(--color-reliability-{tier})`, `background: var(--color-reliability-{tier}-bg)`                                                                   |
| Weight   | `var(--font-weight-medium)`                                                                                                                                  |
| a11y     | Wrapper carries `aria-label="Reliability: moderate — derived metric, leak-sensitive"` (full sentence); inner icon+text `aria-hidden` to avoid double reading |

**Placement on the KPI card:** In `KPICard`/`EnhancedKPICard` the top-right corner already hosts the **clinical-severity** badge. Reliability is a _different axis_ and must not fight it:

- If a severity badge is present, the reliability chip moves to a **footer row** (below the value/unit line, above/around the sparkline), left-aligned, `font-size-xs`, separated from the value by `var(--space-2)`.
- If no severity badge is present, the reliability chip may occupy the top-right slot.
- **Default for high-reliability metrics: render nothing** (see §7). The chip appears only for `moderate`, `low`, `limited`, `unavailable`. This is the key anti-clutter rule.

### 2.2 Inline / dense variant — for tables (session lists, trends sidebar)

For high-density rows (e.g. `SessionList`, `MetricStatsSection`) a full pill is too heavy. Use a **bare icon glyph** (no pill, no background, no label text) sized 14×14, colored `var(--color-reliability-{tier})`, placed immediately after the number with `var(--space-1)` gap. The accessible name lives on the icon's `aria-label` / a visually-hidden `<span>` ("moderate reliability"), and a native `title` gives a hover tooltip. High-reliability rows show **no glyph at all**, keeping clean rows clean.

Optional ultra-dense affordance: a 3px-wide left **trust rail** on the row (a `border-left` in the tier color) — but only when an entire column/section is reduced-reliability, never per-cell, to avoid a confetti effect.

---

## 3. Chart uncertainty — bands, ribbons, error bars

Driven by `uncertainty-statistics.md` §6.2: show a band where uncertainty is **real and decision-relevant** (multi-night trends, threshold-straddling estimates); show nothing for precise, stable, well-sampled values.

### 3.1 Confidence band / ribbon (the default, for trends — `data-visualization` owns rendering)

- **Fill:** `var(--color-uncertainty-band-fill)` (slate at ~16% light / ~20% dark). Neutral grey, **not** the line's own series color — this prevents the band from looking like a second data series and keeps it readable when overlaid on any `--color-chart-*` line.
- **Center line:** the existing series color (rolling mean), full weight (`--signal-hero-line-width` or chart default).
- **Band edges:** a 1px **dashed** stroke in `var(--color-uncertainty-band-stroke)` (`stroke-dasharray: 3 3`). The dash is the **non-color, colorblind/grayscale-safe cue** that distinguishes "uncertainty boundary" from a solid data line.
- **Colorblind / print pattern:** in addition to the dashed edge, offer a **diagonal-hatch fill** (45°, ~2px lines, same stroke color at low alpha) as a togglable/print-default pattern. Hatching survives grayscale and CB simulation where a flat low-alpha fill can vanish. Expose via a `pattern="solid" | "hatch"` prop; **PDF defaults to `hatch`**.
- **Legend/tooltip copy:** label the band explicitly ("95% confidence band" or "± 1 SEM"), and in tooltips show the interval as `5.0 (3.2–6.8)` — point estimate primary, interval in `--color-text-secondary` parentheses.

### 3.2 Error bars (rare — only where §6.2 calls for a per-point CI)

Use **sparingly**: single-night AHI near a clinical threshold, or short/fragmented nights where the exact-Poisson CI straddles a severity band. Never on every point of a series (that trains users to ignore them).

- Whisker: 1px solid `var(--color-uncertainty-errorbar)`, with short 4px caps.
- The point marker stays the series color; the whisker stays neutral grey so the _estimate_ and its _uncertainty_ are visually separable.
- Pair with a one-line caveat under the chart, not a bar on every column.

### 3.3 PDF / grayscale-safe report rendering (`src/services/reports/pdf/`)

The PDF pipeline is canvas-2D with a fixed palette (`PDF_COLORS` in `layout.ts`) and pre-multiplied fills on white. Add print-safe equivalents:

```ts
// add to PDF_COLORS in src/services/reports/pdf/layout.ts
UNCERTAINTY_BAND_FILL: '#e2e6ec',      // ~16% slate pre-multiplied on white (grayscale-safe)
UNCERTAINTY_BAND_STROKE: '#94a3b8',    // dashed edge
UNCERTAINTY_ERRORBAR: '#64748b',
RELIABILITY_MODERATE: '#b45309',
RELIABILITY_LOW: '#6d28d9',
RELIABILITY_UNAVAILABLE: '#6b7280',
```

Print rules:

- Confidence band in the PDF uses the **diagonal-hatch fill by default** (`charts.ts` draws it with `ctx.setLineDash`/clipped diagonal strokes), so it reproduces on a grayscale office printer. Band edge is a dashed `UNCERTAINTY_BAND_STROKE` line.
- Reliability is rendered in the PDF as a **bracketed text suffix + glyph**, e.g. `AHI 6.7 [moderate reliability]`, never color-only — the report must be fully interpretable in black-and-white.
- A short report footnote defines the tiers and references the accuracy doc, satisfying the "regulatory-grade, no false precision" documentation standard.

---

## 4. Iconography (inline SVG, project convention)

All new icons follow the existing pattern (see `src/components/ui/Toast/Toast.tsx`): inline `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`, recolored via `currentColor`. **Shapes are distinct so the cue survives color loss.**

| Meaning                        | Icon (shape)                                                                                             | Used for                                                                  | Source path sketch              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------- |
| **High reliability**           | Check inside a ring (rarely rendered, §7)                                                                | optional "directly measured" affirmation on pressure/usage                | circle + `M8 12l3 3 5-6`        |
| **Moderate reliability**       | **Triangle outline, no exclamation** (a quiet "caution", distinct from the loud filled warning triangle) | derived/definition-dependent metrics (aggregate AHI, hypopnea, leak)      | `M12 4 L21 19 H3 Z` outline     |
| **Low / modeled reliability**  | **Hexagon outline** (signals "computed / inferred", visually unlike a warning)                           | central-vs-obstructive split, flow-limitation %, RERA, Vt/MV at high leak | regular hexagon outline         |
| **Data-quality caveat**        | **Filled warning triangle + `!`** (the conventional alert)                                               | high-leak night, short session, cross-manufacturer comparison attempt     | triangle + `M12 9v4 M12 17h.01` |
| **Info / learn more**          | **Circle + `i`**                                                                                         | "what does this mean?" link to glossary/accuracy doc                      | circle + `M12 11v5 M12 8h.01`   |
| **Unavailable / not computed** | **Dashed circle** or em-dash                                                                             | metric absent (no oximeter, masked by leak)                               | `stroke-dasharray="3 3"` circle |

Reuse `--color-detection`/violet semantics already in tokens for the "modeled" family so the visual language is internally consistent. Do **not** add an icon dependency; privacy and bundle constraints require hand-rolled SVG. The "info" and "filled warning" glyphs likely already exist in help/toast components — reuse them rather than duplicating.

---

## 5. Typography & number treatment (avoiding false precision)

Per `uncertainty-statistics.md` §6.1 and `cpap-device-accuracy.md` §10, the **visual hierarchy of a number must mirror its certainty**:

- **Display precision is capped by the metric, enforced in formatting, then reinforced visually.** AHI → 1 decimal max; leak → integer (median) / 1 decimal (percentiles); pressure → 1 decimal; usage → 1 decimal h; counts → integer; compliance → integer %. The UI must never render a 2-decimal AHI.
- **De-emphasized trailing decimal:** where a decimal is shown but noisy, render the integer part at full weight/size and the `.x` fraction one step smaller and in `--color-text-secondary` (e.g. value uses `--font-size-3xl` for `6`, `--font-size-xl` for `.7`). This is a CSS treatment via a `<span class="fraction">`; it visually downranks the digit the statistic barely supports.
- **CI / interval as secondary text:** the point estimate is primary (`--color-text-primary`, `--font-weight-semibold`); the interval is secondary (`--color-text-secondary`, `--font-weight-normal`, `--font-size-sm`), e.g.
  `**6.7** events/hr` · ` (95% CI 3.2–6.8)` on the line or in a tooltip.
- **Monospace for aligned numerics** in tables: use `--font-family-mono` so digits + intervals align across rows (already a token; no new value).
- **Aleatoric vs. epistemic copy** (§6.2): two different micro-copy templates, surfaced in the chip tooltip / caveat note — never mixed:
  - Aleatoric (expected): "Your AHI naturally varies night to night — trends over weeks are more reliable than any single night."
  - Epistemic (fixable): "Limited data so far — this estimate will tighten as more nights are recorded."
    `documentation` owns final wording; `ui-design` only reserves the two visual slots (a `tone="natural-variation" | "needs-more-data"` on the caveat note).

---

## 6. Component-state table

Canonical states a reliability-aware metric can take. `frontend` should model these as a discriminated union (`tier: 'high' | 'moderate' | 'low' | 'limited' | 'unavailable'`, extending `ConfidenceTier`).

| State                     | When (per accuracy §10 / stats §6.2)                                       | Chip                                                  | Icon               | Number treatment                                                                          | Chart treatment                                         | Tokens                                 |
| ------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| **Default (high)**        | Directly measured: pressure, usage; clean low-leak apnea count             | **None** (silent)                                     | none               | Full precision allowed; plain                                                             | Plain line, no band                                     | — (uses normal text tokens)            |
| **Reduced — moderate**    | Aggregate AHI, hypopnea count, leak: real but definition/leak-sensitive    | `Moderate` pill / inline triangle glyph               | triangle outline   | 1-dp, de-emphasized fraction; CI on demand                                                | Confidence band shown                                   | `--color-reliability-moderate(-bg)`    |
| **Reduced — low/modeled** | Central/obstructive split, flow-limitation %, RERA, Vt/MV (esp. high leak) | `Low` pill / inline hexagon                           | hexagon outline    | Trend/relative framing; avoid bold absolute; "discuss with clinician" copy where apt      | Band + heavier de-emphasis; relative axis               | `--color-reliability-low(-bg)`         |
| **Caveat (data-quality)** | High-leak night, short session, cross-manufacturer compare                 | Caveat note (info-blue) inline + filled-warning glyph | filled warning `!` | Value shown but with note; may be struck/suppressed for flow-derived metrics at high leak | Affected segment shaded/annotated; metric down-weighted | `--color-caveat(-bg/-border)`          |
| **Unavailable**           | Not computed: no oximeter desat, leak-masked, missing channel              | `Unavailable` pill / em-dash                          | dashed circle      | Render `—`, never `0`; `--color-text-muted`                                               | No series; placeholder note                             | `--color-reliability-unavailable(-bg)` |

States are mutually exclusive for the _tier_ axis; a **caveat may co-occur** with any tier (e.g. a moderate AHI on a high-leak night shows both the moderate chip and the leak caveat note).

---

## 7. What must stay visually UNCHANGED (anti-clutter contract)

To keep a high-density, information-rich UI from drowning in qualifiers:

1. **High-reliability metrics show no reliability chip, no icon, no band.** Absence of a marker _is_ the "trustworthy" signal. Pressure, usage, and clean apnea counts look exactly as today. (Optional `High` affirmation only in a focused "data quality" panel, never on the dashboard grid.)
2. **The clinical-severity badge keeps its top-right slot, color, and shape.** Reliability never recolors, replaces, or overlaps it — reliability lives in the footer row or as a sibling, on a separate, desaturated color axis.
3. **No error bars by default.** Bands are the trend default; per-point error bars appear only in the rare threshold/short-night cases (§3.2).
4. **No new chart series colors.** Bands/whiskers use the neutral `--color-uncertainty-*` tokens, never a `--color-chart-*`, so the data palette is untouched.
5. **No per-cell glyph spam in tables.** Inline glyphs appear only on non-high rows; clean rows stay clean. Whole-section trust rails are preferred over per-cell rails.
6. **Existing layout, spacing scale, radii, fonts, and the `Badge` API are reused as-is.** This proposal adds tokens + one chip variant + a handful of SVG glyphs — no structural redesign.
7. **Number formatting precision caps are a correctness fix, not a visual flourish** — they change digits, not layout, so existing cards keep their footprint.

---

## 8. Handoff notes for `frontend`

- Add the §1 token blocks to both theme scopes in `src/styles/tokens.css`; add §3.3 entries to `PDF_COLORS`.
- Extend `ConfidenceTier` (or add a sibling `ReliabilityTier`) to include `limited` and `unavailable`; reuse `confidenceTierLabel` for shared wording.
- Implement `ReliabilityChip` as a wrapper over `Badge` (full variant) + a bare `ReliabilityGlyph` (inline variant) in `src/components/ui/`.
- Wire chip placement into `KPICard.tsx` / `EnhancedKPICard.tsx` per §2.1 (footer row when severity badge present).
- `data-visualization` implements the band/hatch/error-bar per §3; `documentation` supplies the §5 aleatoric/epistemic copy and the PDF tier footnote.
- **Gate:** run the automated contrast check against resolved colors in both themes before `qa` sign-off; verify WCAG 1.4.1 (icon+label present on every tier) and that grayscale PDF remains interpretable.
