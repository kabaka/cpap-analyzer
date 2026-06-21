# AI Insights — Visual Design Specification (v1)

> Companion to [`ai-insights-ux.md`](./ai-insights-ux.md) (authoritative for
> behavior, states, and microcopy) and the [`weather-integration-visual-spec.md`](./weather-integration-visual-spec.md)
> precedent. Authored by `ui-design`; the source of truth for tokens, colors,
> component visuals, and required non-color encodings for the AI Insights feature.
>
> All values resolve through existing CSS custom properties in
> `src/styles/tokens.css` unless flagged **NEW TOKEN**. Every new token is defined
> in **both** `:root` (light) and `[data-theme='dark']` so it is theme-aware and
> participates in custom themes like every other token — nothing is hard-coded.
> **WCAG AA: color is never the sole signal anywhere below** — the ✨ glyph is
> always decorative (`aria-hidden`) and a literal text token ("AI" / "On-device" /
> "Connects online") always carries the meaning (1.4.1).
>
> Specs only. No component code. `frontend` implements; reuse existing
> `@/components/ui` primitives (`Dialog`, `Switch`, `Select`, `Button`, `Input`,
> `Badge`) and the weather panel/`ConsentDialog` patterns.

---

## 0. Color-scale collision audit (why a new "AI" hue)

The palette already assigns strong semantic ownership to several hue families.
The AI marker must not collide with any of them:

| Existing scale | Hue | Owns the meaning |
| --- | --- | --- |
| `--color-status-*`, `--color-error`, `--color-warning` | red / orange / amber / green | **Clinical severity** (AHI etc.) and error/warning |
| `--color-success` / `-bg` | green | **Retained-on-device** privacy convention (weather) |
| `--color-info` / `-bg` (= `--color-primary` blue) | blue | **Egress / connects-online** privacy convention (weather) + interactive primary |
| `--color-reliability-*`, `--color-detection-*`, `--color-tecsa-*` | **violet** | **"inferred / derived / measurement-uncertain"** metadata |
| `--color-aqi-*` | green→maroon ramp | air quality |

Violet is tempting for AI (generated text _is_ inferred), but it is already
owned by the reliability/detection axis and an "AI" pill in violet would read as
a reliability chip. The remaining open, high-recognition "generative AI" hue is
**fuchsia / magenta-pink** (a sibling of the existing `--color-chart-7` `#c026d3`).
It is distinct from every scale above, reads unambiguously as "AI/generated" in
the current product idiom, and clears AA on both surfaces. This is the basis for
the **NEW TOKEN** set `--color-ai-*` in §5.

> The fuchsia is **decorative reinforcement only**. Removing all color, the
> feature is still fully legible: the ✨ glyph + the word "AI"/"AI-generated"
> carry 100% of the signal.

---

## 1. The "AI" content marker (reserved for generated content)

A single, instantly recognizable marker that appears **only** on LLM-generated
content and never on deterministic UI. It is the visual counterpart to the UX
spec's hard rule: the ✨ sparkle + "AI" wording is reserved exclusively for
generated content; the deterministic `(?)` glossary-help affordance must stay
visually and behaviorally distinct (UX §4.2, §8.5; Apple HIG disclosure).

### 1.1 The `AiMarker` pill (canonical form)

A small pill: `[✨] AI`.

| Property | Value |
| --- | --- |
| Container | `display: inline-flex; align-items: center; gap: var(--space-1);` |
| Shape | `border-radius: var(--radius-full)` (fully rounded — distinct from the square-ish `(?)` help button) |
| Padding | `1px var(--space-2)` (matches `.onlinePill` / `Badge.sm`) |
| Background | `var(--color-ai-bg)` **NEW** |
| Text color | `var(--color-ai)` **NEW** |
| Font | `var(--font-size-xs)`, `var(--font-weight-semibold)`, `var(--font-family-sans)`, `line-height: var(--line-height-tight)` |
| Label text | literal `AI` (uppercase, never abbreviated to color alone) |
| Glyph | ✨ sparkle, `14px`, `aria-hidden="true"`, `flex-shrink: 0`, sits left of the label |
| Whitespace | `white-space: nowrap` |

Accessible name: the host element carries the meaning in text ("AI", or in
longer contexts "AI-generated"); the ✨ is `aria-hidden`. Where the pill labels a
region, the region uses `aria-label` (e.g. the caveat region in §3.7).

### 1.2 Sizes / variants

- **`pill` (default)** — `[✨] AI`, as above. Used on the panel header, KPI
  explanation headers, and anywhere generated prose is introduced.
- **`tag` (compact)** — glyph + "AI" at `--font-size-xs`, no background fill,
  `color: var(--color-ai)`, for tight inline contexts (e.g. prefixing the
  accordion trigger label, where it reads `✨ AI Insights`). Still text-bearing.
- **`action`** — the `✨ Explain` / `✨ Summarize` affordances are **buttons**,
  not pills (see §1.4); they reuse the ✨ glyph + `--color-ai` for the glyph but
  follow Button visuals so they read as actionable.

### 1.3 Placement rules

- **Leads** the content it marks (left of label / top-left of a region), never
  trailing, so disclosure precedes the generated text.
- One marker per generated unit — do not stack a pill on every paragraph; one
  pill at the unit header plus the inseparable caveat (§3.7) at the foot.
- Reserved exclusively for generated output and the entry-point actions that
  produce it. It must never appear on a deterministic control.

### 1.4 Distinction from the deterministic `(?)` glossary help (mandatory)

These two affordances must be unmistakable at a glance. Concrete encodings:

| | `✨ AI` marker / actions | `(?)` glossary help (existing) |
| --- | --- | --- |
| Glyph | ✨ sparkle | `?` in a circle |
| Color role | `--color-ai` (fuchsia) **NEW** | existing help/`--color-text-muted` / link blue — unchanged |
| Shape | pill (`--radius-full`) or text-button | small circular icon button |
| Wording | always carries "AI" / "Explain" / "Summarize" | "What is this?" / glossary term, never "AI" |
| Behavior | opens the Insight panel (generated prose) | opens deterministic tooltip/popover (glossary/formula) |
| Motion | may stream/animate (reduced-motion aware) | static |

**Rule for `frontend`:** the `(?)` help component keeps its current tokens
untouched. Do **not** introduce `--color-ai` anywhere in the help/glossary path.
`qa` can assert that `--color-ai*` tokens appear only in AI-Insights modules.

---

## 2. Backend privacy badges & dividers (Settings → AI Insights panel)

Reuses the weather two-gate green/blue contract: **green = stays on your device**,
**blue = sends a snapshot online**. The panel itself reuses
`WeatherIntegrationPanel.module.css` structure (`.panel`, `.switchRow`,
`.config`, `.group`, `.groupLegend`). Below are the AI-specific additions.

### 2.1 The two privacy badges (inline, in radio options + accordion pill)

Both are pills, identical geometry to `.onlinePill` / `Badge.sm`
(`padding: 1px var(--space-2); border-radius: var(--radius-full);
font-size: var(--font-size-xs); font-weight: var(--font-weight-medium)`).

| Badge | Glyph (`aria-hidden`) | Text (the accessible signal) | Background | Foreground |
| --- | --- | --- | --- | --- |
| **On-device** | 🟢 | `On-device · Zero egress` | `var(--color-success-bg)` | `var(--color-success)` |
| **Connects online** | 🔵 | `Connects online` | `var(--color-info-bg)` | `var(--color-info)` |

These are existing tokens — **no new tokens for the badges.** The green/blue
mapping is intentionally identical to weather's "what leaves / what never leaves"
so users transfer the mental model. The 🟢/🔵 emoji are `aria-hidden`; the text
("On-device · Zero egress" / "Connects online") is what screen readers announce
and what survives grayscale.

### 2.2 Group dividers ("Stays on your device" / "Sends a metric snapshot online")

The radio group is split into two labelled subgroups by a divider, giving the
privacy contract _before_ the user picks (UX §3.3, HAX G1).

- Render each subgroup as a `<fieldset class="group">` reusing the existing
  `.group` + `.groupLegend` styling (bordered card, uppercase muted legend).
- **Top subgroup legend:** `Stays on your device` — paired with a leading 🟢
  (`aria-hidden`) and tinted `color: var(--color-success)` (overriding the default
  muted legend color). Sub-line in `--font-size-xs`/`--color-text-muted`:
  "nothing is sent anywhere."
- **Bottom subgroup legend:** `Sends a metric snapshot online` — leading 🔵
  (`aria-hidden`), `color: var(--color-info)`. Sub-line: "requires your consent
  and your own API key."
- Legend color is reinforcement; the legend **text** carries the meaning. A 3px
  left accent border on each subgroup card (`border-left: 3px solid
  var(--color-success)` / `var(--color-info)`) echoes the consent-dialog blocks
  (`.egressBlock` / `.retainedBlock`) and the `.privacyNotice` pattern.

### 2.3 Radiogroup option styling (the four backends)

`role="radiogroup"`, roving-tabindex, arrow-navigable (UX §8.1). Each option is a
selectable card, not a native radio row, so it can carry a badge + description +
status. Tokens only; reuse `.group`-like geometry.

**Option card — base/unselected:**

```
display: grid; grid-template-columns: auto 1fr auto; gap: var(--space-3);
align-items: start;
padding: var(--space-3) var(--space-4);
border: 1px solid var(--color-border-default);
border-radius: var(--radius-md);
background: var(--color-surface-primary);
cursor: pointer;
transition: border-color var(--transition-fast), background var(--transition-fast);
```

- **Col 1:** the radio indicator (custom 18px circle; `border: 2px solid
  var(--color-border-emphasis)`; selected → filled `var(--color-primary)` with a
  white/`--color-surface-primary` inner dot). Reuse `accent-color:
  var(--color-primary)` if a native input is retained.
- **Col 2:** label (`--font-size-base`, `--font-weight-medium`,
  `--color-text-primary`) over a one-line description (`--font-size-sm`,
  `--color-text-secondary`) and an inline status line (`--font-size-xs`,
  `--color-text-muted`) — e.g. "Not available in this browser", "Model not
  downloaded", "Key required".
- **Col 3:** the §2.1 privacy badge (On-device green / Connects-online blue).

**Hover (unselected):** `border-color: var(--color-border-emphasis);
background: var(--color-surface-secondary)`.

**Selected:** `border-color: var(--color-primary); background:
var(--color-nav-active-bg); box-shadow: inset 0 0 0 1px var(--color-primary)`
(double-line reads as selected without relying on color alone; the filled radio
dot is the primary non-color cue, and `aria-checked` is authoritative).

**Focus-visible (roving):** `outline: 2px solid var(--color-focus-ring);
outline-offset: 2px;` (matches `ReliabilityChip:focus-visible`). Focus ring is
independent of the selected border so a focused-unselected option is unambiguous.

**Disabled / unsupported** (e.g. WebLLM with no WebGPU, Chrome built-in
unavailable): `opacity: 0.6; cursor: not-allowed;` the option stays visible (UX
forbids silently hiding it) with its inline status line explaining why, and an
inline fallback message rendered below the group (not a toast). The badge still
shows so the privacy posture is readable even when unusable.

### 2.4 Accordion trigger label (panel collapsed)

Reuses `.integrationTrigger` / `.integrationTriggerIcon` / `.onlinePill` from
`Settings.module.css`:

- Disabled: `AI Insights — Disabled` (no pill).
- Enabled, local backend: `✨ AI Insights — On · On-device` + **green**
  `On-device` pill (`.onlinePill` geometry but `--color-success` / `-bg`).
- Enabled, cloud backend: `✨ AI Insights — On · <Backend>` + **blue**
  `Connects online` pill (the existing `.onlinePill`, unchanged).

The leading ✨ uses the §1.2 `tag` variant. Color never sole: each pill carries
its word.

---

## 3. The Insight drawer / card — six states

The panel is a right-side **non-modal** drawer on desktop (≥1024px, reusing the
help-panel drawer pattern) and a full-width expandable section / bottom sheet on
mobile (UX §4.1). Surface tokens:

- Drawer surface: `var(--color-surface-elevated)`; left border / separator
  `1px var(--color-border-default)`; elevation `var(--shadow-lg)`.
- Internal padding `var(--space-5)`; vertical rhythm `gap: var(--space-4)`.
- Header row: scope `<h2>` (`--font-size-lg`, `--font-weight-semibold`,
  `--color-text-primary`, `tabindex="-1"` for focus-on-open) + the §1.1 `✨ AI`
  pill + a Collapse/Close icon button (right-aligned, ≥44×44px touch target).

### 3.0 Shared chrome (all states)

- **Scope subhead:** "Summary of 14–20 Jun 2026" — `--font-size-sm`,
  `--color-text-secondary`.
- **Per-output egress reminder (cloud backends only)** (UX §4.3): a single line
  beneath the header reusing `.syncEgressReminder` styling exactly —
  `background: var(--color-info-bg); border-left: 3px solid var(--color-info);
  border-radius: var(--radius-md); padding: var(--space-3)`. Text: `Sends a
  metric snapshot to <Backend>. No raw data leaves your device.` + a
  `[What's sent →]` link (`--color-text-link`) opening the read-only egress
  contract. Absent for local backends.

### 3.1 Idle / pre-generation

- Scope header + egress reminder (if cloud).
- **Primary action:** `Generate summary` / `Explain` — `Button` primary variant.
- **Suggested-question chips** (UX §7.6) below the action:
  - Container: `display: flex; flex-wrap: wrap; gap: var(--space-2)`.
  - Each chip: `display: inline-flex; align-items: center; gap: var(--space-1);
    padding: var(--space-2) var(--space-3); border-radius: var(--radius-full);
    border: 1px solid var(--color-border-default); background:
    var(--color-surface-secondary); color: var(--color-text-primary);
    font-size: var(--font-size-sm); cursor: pointer; min-height: 44px`
    (44px touch target, UX §8.5).
  - Hover: `border-color: var(--color-ai); background: var(--color-ai-subtle-bg)`
    **NEW** (a very low-alpha fuchsia wash so chips feel "AI" on interaction
    without shouting). Focus-visible: standard `--color-focus-ring` ring.
  - Optional leading ✨ glyph (`aria-hidden`) at `--color-ai` to tie chips to the
    AI affordance; the chip's text label is the accessible signal.
- **Cloud backend, no key:** primary action disabled (`--color-primary-disabled`)
  + the §3.5 "no key" inline notice with an `Open AI Insights settings` deep-link.
- No prose, no caveat yet (nothing generated).

### 3.2 Generating (streaming) — cursor + shimmer, reduced-motion aware

- The action is replaced by the **streaming output region**:
  `var(--color-text-primary)` body text at `--font-size-base` /
  `--line-height-relaxed`.
- **Status line** above the stream: `Preparing your numbers…` → (local first run)
  `Loading model…` → `Generating…`, in `--font-size-sm` / `--color-text-secondary`,
  with a small animated indicator (below).
- **Streaming cursor:** a 1ch-wide caret `▍` appended to the last token,
  `color: var(--color-ai)` **NEW**, blinking via opacity 1↔0.3.
  - Animation: `ai-caret-blink 1s steps(2, start) infinite`.
- **Shimmer (skeleton tail):** while awaiting the next tokens, a shimmering line
  placeholder beneath the streamed text, reusing the app's chart-shimmer idiom
  (UX §loading "shimmer placeholder"). Gradient sweeps `--color-surface-secondary`
  → `--color-surface-tertiary` → `--color-surface-secondary`.
- **The "Based on these numbers" source panel (§3.6) is shown immediately**
  (numbers exist before prose) — accurate content to read while prose streams.
- **The caveat (§3.7) is present from the first streamed token.**
- **Stop button:** `Button` secondary/danger-subtle; cancels immediately;
  partial text retained and labelled `Stopped — partial result.`
  (`--color-text-muted`, `--font-size-xs`).
- **Reduced motion (`prefers-reduced-motion: reduce`) — required behavior:**
  - **No** blinking caret (render a static `▍` at `--color-ai`, or omit).
  - **No** shimmer sweep — replace with a **static** placeholder block at
    `var(--color-surface-tertiary)` (flat, no animation).
  - **No** typewriter flourish — tokens may arrive in **coarser chunks**; the
    container does not animate height/opacity transitions
    (the global reduced-motion rule already zeroes `--transition-*`).
  - Streaming still _functions_; only the motion decoration is removed (UX §8.6).
- **A11y:** the visual region updates per token for sighted users; SR
  announcement is a **separate** coarse `aria-live="polite"` `aria-atomic="false"`
  region flushed at sentence boundaries (~every 1.5 s), `aria-busy="true"` while
  streaming (UX §8.3). Token-by-token is never wired to `aria-live`.

### 3.3 Complete

- Full narrative + inseparable caveat (§3.7) + expanded source panel (§3.6).
- **Action row** (`display: flex; gap: var(--space-2); flex-wrap: wrap;` each
  control ≥44×44px): `Regenerate (↻)`, `Copy`, `Thumbs up` / `Thumbs down`,
  `Collapse/Close`. Icon buttons use `--color-text-secondary`, hover
  `--color-text-primary`; thumbs use neutral tokens (feedback is local-only, no
  success/error coloring implied).
- **Provenance line** (UX §5.3): small footer, `--font-size-xs`,
  `--color-text-muted`, `--font-family-mono` for the timestamp:
  `Claude Sonnet 4.6 · 20 Jun 2026, 21:14`.
- Copy emits prose **with** the caveat footer (UX §7.3) — never naked prose.

### 3.4 Error (per-backend taxonomy, UX §6)

- Rendered **inline** in the panel as `role="alert"` (never a toast).
- Visual: reuse the error-notice idiom — `background: var(--color-error-bg);
  border-left: 3px solid var(--color-error); border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4)`. Title `--color-error`
  `--font-weight-semibold`; body `--color-text-primary` `--font-size-sm`.
- Plain-language message + a concrete **next action** button (`Retry` /
  `Switch to on-device` / `Download model` / `Open settings`). Context preserved
  (never navigates away); no stack traces (console only).
- Cloud-specific failures include the "an on-device backend avoids this" steer as
  a secondary action — reinforcing the privacy-preferring path.

### 3.5 Empty / insufficient data (UX §5.5)

- No model call is made. Render a calm empty state (not an error):
  `background: var(--color-surface-secondary); border: 1px dashed
  var(--color-border-default); border-radius: var(--radius-md); padding:
  var(--space-5); text-align: center`.
- Icon/illustration in `--color-text-muted`; message `--color-text-secondary`
  `--font-size-sm` (UX §7.7 copy) + a concrete fix action (`Widen range` /
  `Import data`).
- The "Based on these numbers" panel still shows whatever exists (possibly
  "No nights in this range").

### 3.6 "Show your work" source-metrics panel (UX §4.4 — under every output)

A collapsible `Based on these numbers ▾` block, **expanded by default** on first
view per session.

- Container: `background: var(--color-surface-secondary); border: 1px solid
  var(--color-border-subtle); border-radius: var(--radius-md); padding:
  var(--space-4)`.
- Disclosure header: `--font-size-sm`, `--font-weight-semibold`,
  `--color-text-primary`, chevron `--color-text-muted`.
- Body is a **definition list / table** (the authoritative accessible
  representation, UX §8.3):
  - Metric name (`--color-text-secondary`) — leader dots — **value**
    (`--font-family-mono`, `font-variant-numeric: tabular-nums`,
    `--color-text-primary`) — severity/qualifier label.
  - Severity qualifiers keep their existing `--color-status-*` token **and** the
    text label ("Normal", "< 5") beside the color (1.4.1), exactly as elsewhere.
    Reuse the `.coverageDate` / `.coverageDash` tabular idiom from the weather
    panel for alignment.
  - Each metric row links to its deterministic glossary `(?)` help (the link is
    the deterministic-blue `--color-text-link`, **not** `--color-ai` — this panel
    is data, not generated text).
- Trend rows show a direction glyph + word (`↓ improving`, `↑ worsening`,
  `→ steady`) — glyph is reinforcement, the word is the signal.

### 3.7 Always-on caveat banner (UX §4.5 — inseparable from every output)

Co-located, legible, **not dismissible**, part of the same component as the prose
so prose can never surface without it.

- Region: `role="note"`, `aria-label="AI disclaimer"`.
- Visual: a quiet banner using **NEW** AI-tinted caveat tokens so it reads as
  "this is the AI's own disclaimer", distinct from clinical error/warning:
  ```
  display: flex; align-items: flex-start; gap: var(--space-2);
  background: var(--color-ai-bg);
  border-left: 3px solid var(--color-ai);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  ```
- Leading the text: the §1.1 `✨ AI` marker (or the `tag` variant). Text:
  **`AI-generated — may be inaccurate. Verify against the numbers above.`**
  (compact variant for inline KPI explanations per UX §7.3).
- It is **never** styled as `--color-error`/`--color-warning` (it is not a
  failure) nor dismissible. Placed at the **foot** of the narrative, immediately
  after the prose, before the action row.
- Medical-disclaimer footer (UX §7.8) sits below in `--font-size-xs` /
  `--color-text-muted`.

---

## 4. Consent dialog (Gate 2 — cloud egress)

Mirror `src/views/Settings/weather/ConsentDialog.tsx` and reuse the
`WeatherIntegrationPanel.module.css` consent classes verbatim
(`.consentBody`, `.egressBlock`, `.retainedBlock`, `.contractTitle`,
`.contractList`, `.contractRow`, `.egressGlyph`, `.lockGlyph`,
`.consentFootnote`, `.consentAck`, `.dialogActions`). Radix `Dialog`: focus trap,
return focus to trigger on close, `Esc`/overlay cancel without persisting.

- **Title:** `Send metric summaries to <Backend>?`
- **What LEAVES your device** block — `.egressBlock`:
  `background: var(--color-info-bg); border-left: 3px solid var(--color-info)`.
  Each row a `.contractRow` with the **↗** glyph in `.egressGlyph`
  (`color: var(--color-info); font-weight: var(--font-weight-bold)`),
  `aria-hidden`. (UX §3.8 / §7.2 lists the exact three rows.)
- **What NEVER leaves your device** block — `.retainedBlock`:
  `background: var(--color-success-bg); border-left: 3px solid
  var(--color-success)`. Each row a `.contractRow` with the **🔒** glyph in
  `.lockGlyph`, `aria-hidden`.
- **Cloud-egress emphasis (the AI-specific delta from weather):** because this is
  the only AI option that egresses, add a one-line emphasis under the description
  reusing `.syncEgressReminder` styling (blue, `border-left: 3px solid
  var(--color-info)`): _"This is the only AI option that sends anything off your
  device. On-device options send nothing."_ This is copy/placement emphasis, not
  a new token.
- **Footnote** (`.consentFootnote`, `--color-text-muted`, `--font-size-xs`):
  re-ask-on-change note (UX §7.2).
- **Acknowledgement** (`.consentAck`): checkbox (`accent-color:
  var(--color-primary)`) gating the **Enable** primary button; **Cancel**
  secondary. `Enable` disabled (`--color-primary-disabled`) until checked.
- No new tokens — entirely existing green/blue contract.

---

## 5. New design tokens

All extend the existing system in `src/styles/tokens.css`, defined in **both**
`:root` and `[data-theme='dark']`. There are **four** new tokens, one new hue
family (`--color-ai`). Everything else reuses existing tokens.

```css
/* :root (light) — add near SEMANTIC COLORS */

/* GENERATIVE-AI MARKER (fuchsia/magenta).
   Owns ONE meaning: "this is LLM-generated content / the affordance that
   produces it." Deliberately off the clinical-severity (red/orange/green),
   privacy (green=retained / blue=egress), and reliability/detection (violet)
   scales so it can never be confused with any of them. Color is reinforcement
   only — the ✨ glyph is aria-hidden and the literal text "AI"/"AI-generated"
   always carries the signal (WCAG 1.4.1). */
--color-ai: #a21caf;            /* fuchsia-700: ≥ 4.5:1 as text on --color-surface-primary (#fff) */
--color-ai-bg: rgba(162, 28, 175, 0.1);   /* pill / caveat-banner fill */
--color-ai-subtle-bg: rgba(162, 28, 175, 0.05); /* chip hover wash */
--color-ai-border: rgba(162, 28, 175, 0.35);     /* optional pill/region hairline */
```

```css
/* [data-theme='dark'] — brightened, same hue intent */
--color-ai: #e879f9;            /* fuchsia-400: ≥ 4.5:1 as text on --color-surface-primary (#0a0a0a) */
--color-ai-bg: rgba(232, 121, 249, 0.15);
--color-ai-subtle-bg: rgba(232, 121, 249, 0.08);
--color-ai-border: rgba(232, 121, 249, 0.4);
```

| Token | Light | Dark | Semantic role |
| --- | --- | --- | --- |
| `--color-ai` | `#a21caf` | `#e879f9` | Foreground for the ✨/AI marker, streaming caret, AI-caveat accent border, chip-hover accent. The "generated content" hue. |
| `--color-ai-bg` | `rgba(162,28,175,0.1)` | `rgba(232,121,249,0.15)` | Fill for the AI pill and the inseparable caveat banner. |
| `--color-ai-subtle-bg` | `rgba(162,28,175,0.05)` | `rgba(232,121,249,0.08)` | Low-alpha wash for suggested-chip hover/active so chips feel "AI" without shouting. |
| `--color-ai-border` | `rgba(162,28,175,0.35)` | `rgba(232,121,249,0.4)` | Optional hairline for the pill / AI regions where a 1px edge improves separation on busy surfaces. |

**Contrast notes for `frontend` to verify (AA):**
`#a21caf` on `#ffffff` ≈ 5.9:1 (passes normal text); `#e879f9` on `#0a0a0a`
≈ 8.6:1 (passes). The `-bg` fills are reinforcement only (text on them uses
`--color-ai`/`--color-text-*`, not the fill as a text color), but the
`--color-ai` foreground on `--color-ai-bg` (pill text on pill fill) must also be
verified ≥ 4.5:1 on both themes; if marginal in dark, render pill text in
`--color-text-primary` and keep fuchsia for glyph + border (the same fallback the
AQI scale uses).

**No other new tokens.** Privacy badges/dividers (§2), the consent dialog (§4),
errors, empty states, and the source panel all reuse existing tokens
(`--color-success*`, `--color-info*`, `--color-error*`, `--color-surface-*`,
`--color-text-*`, `--color-status-*`, `--radius-*`, `--space-*`, etc.).

### 5.1 New animations (motion, reduced-motion gated)

Decorative only; both must be disabled under `prefers-reduced-motion: reduce`
(per §3.2 and the global reduced-motion rule).

```css
@keyframes ai-caret-blink { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }
@keyframes ai-shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }

@media (prefers-reduced-motion: reduce) {
  /* caret static; shimmer replaced by flat --color-surface-tertiary block */
}
```

---

## 6. Handoff checklist for `frontend`

1. Add the four `--color-ai*` tokens to `:root` and `[data-theme='dark']` in
   `src/styles/tokens.css`; verify the AA ratios in §5 (and the dark pill-text
   fallback if marginal).
2. Build a single `AiMarker` atom (`pill` / `tag` variants) — the only place
   `--color-ai*` is consumed in chrome; never reuse it on deterministic `(?)`
   help.
3. Privacy badges/dividers reuse existing `--color-success*` / `--color-info*`
   and the `.group`/`.onlinePill` geometry — no new tokens.
4. The radiogroup option-card states (§2.3) and the six insight states (§3) reuse
   existing surface/border/text/status tokens.
5. Consent dialog reuses the weather `ConsentDialog` classes verbatim plus the
   §4 cloud-egress emphasis line.
6. Gate all new motion (caret blink, shimmer) behind `prefers-reduced-motion`;
   provide the static fallbacks in §3.2 / §5.1.
7. Keep color never-sole everywhere: ✨ is `aria-hidden`; "AI" / "On-device ·
   Zero egress" / "Connects online" / severity labels are always present as text.
```