# AI Insights — On-Device Model Download UX (Revamp)

**Status:** Spec (interaction + accessibility + token-level visual treatment). Implementation is a separate pass.
**Owner:** `ux`
**Pairs with:** `docs/design/ai-insights-visual.md` (visual system), `docs/design/ai-insights-ux.md` (parent state machine), `ui-design` (final visuals), `frontend` (build), `e2e-tester` (flows).
**Core principles touched:** Privacy (1), Correctness (2), UX (4).

---

## 1. Problem & goal

The first time an on-device (WebLLM) backend runs, the model weights (~0.9–2.0 GB) download with almost no feedback. The drawer sits in its `generating` state showing only a tiny `"Loading model… NN%"` line above an empty streaming area with a blinking caret — which reads as a **stalled "generating"**, not a multi-minute download. Users conclude the app is broken and that `Stop` is dead (the Stop-during-download failure is a separate provider bug; this spec defines the affordance the user sees).

The signal to fix this **already exists but is unused by the UI**: `ModelLoadProgress` (`src/services/llm/types.ts`) carries `phase: 'downloading' | 'loading'`, `fraction: number | null`, and a model-authored `text`. The hook (`useAiInsight`) already surfaces it as `progress`. Today the drawer only branches on the coarse hook `phase` (`'preparing' | 'loading' | 'generating'`) and shows a bare `%`.

**Goals**

1. **Proactive download in Settings** — let the user fetch the model *on their terms* with visible progress, so the first insight is instant.
2. **Reassuring in-drawer first-use download state** — if they trigger an insight before downloading, show an unmistakable "Preparing the on-device model" block that is *visually separate from token streaming*.
3. Calm, privacy-forward, accurate microcopy for every state, including a working **Cancel**.
4. WCAG AA throughout.

**Research grounding.** Microsoft HAX **G1** ("Make clear what the system can do") and **G3** ("Time services based on context") motivate disclosing the one-time download *cost* up front rather than mid-spinner. NN/g progress-indicator guidance: show a **percent-done** indicator for waits over ~10 s, and a looped/indeterminate indicator only when the total is genuinely unknown — hence the indeterminate fallback **only** while `fraction === null`, snapping to determinate as soon as a fraction arrives. NN/g also: keep the user informed, set expectations, and always offer an escape (Cancel). Progressive disclosure (the storage/why-this-takes-long detail) keeps the default surface calm for our power-user audience without hiding the controls.

---

## 2. Reuse vs. build (component inventory)

**Reuse as-is:**

- **`ProgressBar`** (`src/components/ui/ProgressBar/ProgressBar.tsx`) — already does everything we need: `role="progressbar"`, `aria-valuemin/max/now`, `aria-valuetext`, `indeterminate` (omits `aria-valuenow`, sweeping shimmer), `paused` (non-colour hatch so a stopped bar never reads as complete — WCAG 1.4.1), `label`/`labelledBy`, ref-applied fill width (no per-tick re-render), reduced-motion gating in its CSS. **This is the single primitive for both surfaces.** Do not hand-roll a bar (the weather `SyncSheet` still has an inline one — do not copy that; prefer `ProgressBar`).
- **`Button`** (`src/components/ui`) — Download (`variant="primary"`), Cancel/Retry (`variant="secondary"`).
- **Throttled `aria-live` region** — copy the pattern already in `Breathing.tsx` (`role="status"` + `aria-live="polite"`, announces phase/milestones only) and `SyncSheet.tsx`. Do not announce every percent.

**Build (small, shared):**

- **`ModelDownloadProgress`** — one presentational component used by *both* the Settings `WebLLMConfig` and the drawer. Props: `phase: 'downloading' | 'loading'`, `fraction: number | null`, `statusText?: string` (the model's `progress.text`), `sizeLabel: string`, `modelLabel: string`, `onCancel: () => void`, `variant: 'settings' | 'drawer'`. It composes `ProgressBar` + the phase copy (§5) + the throttled live region + a Cancel button. Centralising it guarantees the two surfaces stay consistent and accessible, and keeps the milestone-announcement logic in one place.
- **State wiring only** in `WebLLMConfig` (Settings) and `InsightDrawer` (drawer) — they own the *trigger* and the *download lifecycle state*; `ModelDownloadProgress` owns the *presentation*.

**Provider/hook dependency (not this spec, flag for `frontend`/`resmed-specialist`):** Settings has no download path today — `WebLLMProvider` exposes `checkAvailability()` and `generate()` but no standalone "fetch weights" entry point, and `useAiInsight` only drives full insight runs. A small **`download()`/`prefetch(modelId, { signal, onProgress })`** affordance (re-using WebLLM's existing engine-load + `onProgress` plumbing, ending before any generation) is required to power the Settings button. The Stop-during-download fix (the provider must honour `signal` *during* weight download, not only during generation) is the same plumbing.

---

## 3. Surface A — Proactive download in Settings (`WebLLMConfig`)

`WebLLMConfig` (`src/views/Settings/ai/AiInsightsPanel.tsx`) currently shows the model `Select`, a storage note, and a status line — but **no way to download**. Add an explicit Download action and a download lifecycle below the existing status line. The model picker stays; downloading is gated on a chosen model.

### 3.1 States

A single `downloadState` drives this block: `idle-needs-download → starting → downloading → loading → done | error | cancelled`.

```
┌─ On-device model ───────────────────────────────────────────────┐
│ Model  [ Llama 3.2 3B Instruct — ~1.9 GB — Balanced…   ▼ ]       │
│                                                                  │
│ This model downloads about ~1.9 GB and is stored in your        │
│ browser so it can run fully on-device. It counts toward the     │
│ storage shown in Privacy & Storage, and you can remove it       │
│ any time.                                                        │
│                                                                  │
│ ── state-dependent region (below) ──                            │
└──────────────────────────────────────────────────────────────────┘
```

**`idle-needs-download`** (availability `needs-download`, a model selected):
```
  Needs a one-time download (~1.9 GB).            [ Download model (~1.9 GB) ]
```
- Primary `Button`. Disabled with hint `Choose a model to continue.` when `modelId === null`.

**`starting`** (download requested, `fraction` still `null` — pre-first-byte / connection):
```
  Starting download…                                          [ Cancel ]
  ▓▓▓▓▓▓▓▓░░░░░░░░░░  (indeterminate sweep)
  Setting up — this can take a few minutes the first time.
```

**`downloading`** (`progress.phase === 'downloading'`, fraction known):
```
  Downloading model — 42%                                     [ Cancel ]
  ▓▓▓▓▓▓▓▓▓░░░░░░░░░  (determinate, value=fraction)
  One-time download, ~1.9 GB. Runs on your device — nothing is uploaded.
  · <model's own progress.text, e.g. "Fetching param 12/38"> (muted, optional)
```

**`loading` / warm-up** (`progress.phase === 'loading'`):
```
  Preparing the model on your device…                         [ Cancel ]
  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░  (determinate if fraction known, else indeterminate)
  Almost ready — warming up the model. No more downloading.
```

**`done`** (availability flips to `available`):
```
  ✓ Downloaded — ready. Runs entirely on your device.
```
- Replaces the Download button. Reuses the existing `statusReady` treatment.

**`cancelled`** (user cancelled mid-download):
```
  Download cancelled. The partial download is discarded.      [ Download model (~1.9 GB) ]
  ▓▓▓▓▓░░░░░░░░░░░░  (paused hatch — never reads as complete)
```
- Returns cleanly to `idle-needs-download` semantics; button re-offers the download.

### 3.2 Errors & retry (Settings)

Map from `BackendAvailability` / `LLMError.kind`. Each shows a `role="note"`/`role="alert"` block and an actionable button:

| Cause (`kind` / availability) | Message | Action |
|---|---|---|
| `webgpu-unsupported` (state `unsupported`) | *On-device AI (WebLLM) needs WebGPU, which this browser or device doesn't support.* (existing copy) | (no Download; offer Chrome/cloud — existing fallback note) |
| `network-blocked` during download | **The model download was interrupted. Check your connection and try again — it resumes from where browsers cache it, so you won't always re-download everything.** | `[ Try again ]` |
| `model-load-failed` (OOM during warm-up) | **This model couldn't load on this device — it may need more memory. Try a smaller model below.** | `[ Try again ]` + focus the model `Select` |
| `unknown` | **The download ran into a problem. Try again.** | `[ Try again ]` |

> On OOM, do **not** silently switch models (Correctness/agency) — point the user at the picker and let them pick a smaller `sizeLabel` (Llama 3.2 1B `~0.9 GB`).

---

## 4. Surface B — In-drawer first-use download state (`InsightDrawer`)

If the user triggers an insight before downloading, the drawer must show a **distinct "Preparing the on-device model" block — not the `generating` streaming layout.** Today the `state === 'generating'` branch renders the status line + the empty prose area + caret + Stop. We **split** the visual treatment of `generating` so that, *while a model load is in progress* (`progress !== null` and no tokens have streamed yet), the drawer renders the download block **instead of** the prose/caret. The caret and prose belong only to *actual* token generation.

### 4.1 Gating rule (deterministic, no flicker)

Within `state === 'generating'`:

- **Model-load sub-state** when `progress !== null` **and** `text === ''` (nothing generated yet). Render `ModelDownloadProgress` (`variant="drawer"`). **Hide** the caret and the empty prose paragraph.
- **Streaming sub-state** when `text !== ''` (first token arrived) **or** `progress === null` for a non-WebLLM backend. Render the existing prose + caret + Stop. Once a token streams, the download block is gone for good this run.
- The coarse hook `phase` is a fallback: if `progress === null` but `phase === 'preparing' | 'loading'` (warm-up with no fraction), show the block in its indeterminate form.

This means a cloud backend (which never emits `progress`) goes straight to the streaming layout — unchanged.

### 4.2 Drawer download block

```
┌──────────────────────────────────────────────┐
│ ⏳  Preparing the on-device model            │
│                                              │
│ Downloading model — 42%                      │
│ ▓▓▓▓▓▓▓▓▓░░░░░░░░░  (determinate)            │
│                                              │
│ First-time, one-time download (~1.9 GB).     │
│ It runs on your device — nothing is          │
│ uploaded — and can take a few minutes. The   │
│ model stays cached for next time.            │
│ · <progress.text> (muted, optional)          │
│                                              │
│            [ Cancel ]                        │
└──────────────────────────────────────────────┘
```

- **Heading** "Preparing the on-device model" (`<h3>` / `styles.title`-scale). The non-colour glyph (⏳) is `aria-hidden`; meaning lives in the heading, never colour alone.
- Phase line + bar from §5, identical copy to Settings (shared component).
- **Indeterminate fallback** when `fraction === null` (the `starting` / null-fraction window): copy **"Starting download…"**, `ProgressBar indeterminate`.
- **Warm-up** (`phase === 'loading'`): copy **"Preparing the model on your device…"** + **"Almost ready — warming up the model. No more downloading."**
- The egress reminder shown for cloud backends is **not** shown here (on-device = zero egress); instead the privacy reassurance is baked into the block copy.
- `SourcePanel` / `InsightCaveat` are **not** shown during model load (no insight exists yet) — they appear only once streaming/complete, exactly as today.

### 4.3 Cancel (drawer) — the affordance behind the "Stop doesn't work" report

- Label is **`Cancel`** here (not `Stop`) — we are cancelling a download, not stopping generation. `Stop` returns only in the streaming sub-state. This wording change itself reduces the "it's broken" feeling: the user sees they cancelled a *download*.
- On click: calls `stop()` (which aborts the run's `AbortController` → provider should abort the in-flight download; the provider fix lands separately). Resulting drawer state: **return to `idle`** (the drawer's idle: Generate button + chips), **not** an error screen. Rationale: the user explicitly backed out of a long download; dropping them on a red "Generation stopped" error would feel like a failure they caused. (`useAiInsight` currently routes `aborted` → `error` state with copy "Generation stopped." The drawer should special-case an abort that occurs *during model load* — `progress !== null && text === ''` at abort time — and present idle instead. Flag to `frontend`: detect "aborted before any token" and map to idle rather than the error branch.)
- **No confirmation dialog.** Cancel is cheap and reversible (re-trigger re-starts; browser cache means it won't always re-download from zero). A confirm step would add friction to an escape hatch — NN/g: escape hatches should be frictionless.

---

## 5. Exact microcopy (single source of truth)

Used verbatim by `ModelDownloadProgress` in both surfaces. Tone: calm, factual, privacy-forward. Always state **one-time**, **size**, **on-device / nothing uploaded**, **a few minutes**.

### 5.1 Settings buttons & status
- Download button: **`Download model ({sizeLabel})`** → e.g. `Download model (~1.9 GB)`
- Download button (no model chosen): disabled, hint **`Choose a model to continue.`**
- Idle status (needs download): **`Needs a one-time download ({sizeLabel}).`**
- Done: **`Downloaded — ready. Runs entirely on your device.`** (prefix with a `✓` glyph, `aria-hidden`)
- Cancelled: **`Download cancelled. The partial download is discarded.`**

### 5.2 Phase lines (shared, both surfaces)
- Starting / null-fraction: **`Starting download…`**
- Downloading (determinate): **`Downloading model — {pct}%`**
- Warm-up (`loading`): **`Preparing the model on your device…`**

### 5.3 Context lines (shared)
- Downloading context: **`One-time download, {sizeLabel}. Runs on your device — nothing is uploaded.`**
- Starting context: **`Setting up — this can take a few minutes the first time.`**
- Warm-up context: **`Almost ready — warming up the model. No more downloading.`**
- Drawer block (fuller, since it's the first-use surprise surface): **`First-time, one-time download ({sizeLabel}). It runs on your device — nothing is uploaded — and can take a few minutes. The model stays cached for next time.`**
- Model's own status (optional, muted, `--color-text-muted`): render `progress.text` verbatim prefixed `· ` only when it is non-empty and not already a duplicate of the phase line.

### 5.4 Drawer heading
- **`Preparing the on-device model`**

### 5.5 Cancel
- Drawer & Settings in-progress: **`Cancel`**
- (Streaming sub-state keeps the existing **`Stop`**.)

### 5.6 Errors — see §3.2 (Settings). The drawer, on a *non-abort* failure during load (e.g. `model-load-failed`), uses the existing drawer `error` branch with the existing `useAiInsight` mapped copy (`pick-smaller-model` → "Open AI Insights settings"). No new drawer error copy needed; only the **abort-before-token → idle** special case (§4.3).

---

## 6. Accessibility (WCAG AA)

Applies to `ModelDownloadProgress` in both surfaces.

- **Progress bar:** use `ProgressBar`. Determinate → it emits `role="progressbar"` + `aria-valuemin=0`, `aria-valuemax=100`, `aria-valuenow={round(fraction*100)}`. Pass percent-scaled `value`/`max` (or fraction×100 / 100) so `aria-valuenow` and the visible `%` agree. Indeterminate (`fraction === null`) → pass `indeterminate` so the component **omits `aria-valuenow`** and announces via `aria-valuetext` only. Cancelled (Settings) → pass `paused` for the non-colour hatch.
- **`aria-valuetext`:** always pass a human sentence, e.g. `Downloading the on-device model, 42 percent.` / `Starting the on-device model download.` / `Warming up the on-device model.` — screen readers read this, not "42 / 100".
- **`aria-busy`:** the drawer's `<aside>` already sets `aria-busy={isGenerating}`; that remains correct during load. The Settings block sets `aria-busy` on its container while downloading/loading.
- **Live announcements (throttled):** a single `role="status"` / `aria-live="polite"` region announces **milestones only** — on phase change (`downloading → loading`), at ~10% buckets, on done, on cancel, on error. Reuse the bucketing pattern from `SyncSheet.handleProgress` (`Math.floor(fraction*10)`) and `Breathing.tsx`. **Never** announce every percent (token/percent storm). Errors use `role="alert"` (assertive).
- **Keyboard:** Download, Cancel, Try again are real `Button`s — Tab-reachable, Enter/Space-activated, visible focus ring (inherited). On the drawer, when the block replaces the prose, **move focus** to the Cancel button is *not* required (it would steal focus from the heading the drawer already focuses on open); instead ensure Cancel is the next logical Tab stop. On Settings OOM error, move focus to the model `Select` (so the user can immediately pick smaller). On drawer Cancel → idle, focus the idle primary `Generate` button.
- **Touch targets:** Cancel/Download ≥ 44×44 px on mobile (Button already meets this at default size; do not use `size="sm"` for these primary escape actions on the drawer bottom-sheet).
- **Colour is never the sole signal:** phase is carried by *text* (the phase line), not bar colour; `done` uses a `✓` glyph + words; `cancelled` uses the `paused` hatch + words; errors use an icon + heading + words.
- **Reduced motion:** `ProgressBar`'s CSS already disables the fill transition and the indeterminate sweep under `prefers-reduced-motion: reduce` (the indeterminate bar becomes a static full-width bar — acceptable, since the live region carries state). No extra animation may be introduced. The drawer caret is already reduced-motion-aware and is *absent* during load anyway.

---

## 7. Token-level visual treatment

Reference `src/styles/tokens.css`; defer final visuals to `ui-design`. All values are tokens, not literals.

**Shared `ModelDownloadProgress` block**
- Container: padding `--space-4`; gap `--space-2` between rows; `border-radius: --radius-lg`; background `--color-surface-secondary` (drawer) so it reads as a distinct panel separate from prose; Settings variant has no extra surface (sits inline in the `fieldset`).
- Drawer heading: `--font-size-base`, weight 600, `--color-text-primary`; glyph `--color-text-secondary`, `aria-hidden`.
- Phase line: `--font-size-sm`, `--color-text-primary`; the `{pct}%` may use `--color-text-secondary`.
- Context line(s): `--font-size-sm`, `--color-text-secondary`.
- Model `progress.text` (optional): `--font-size-xs`, `--color-text-muted`.
- `ProgressBar`: default height (8px), track `--color-surface-tertiary`, fill `--color-primary` (its defaults). Spacing above/below `--space-2`.
- Done status: reuse `statusReady` (success treatment, `--color-success`) + `✓`.
- Cancelled: `paused` hatch (already token-driven via `--color-surface-primary` stripes) + `--color-text-secondary` copy.
- Buttons: `Button` primary (`--color-primary`) for Download; secondary for Cancel/Try again.

**Settings error block:** reuse the existing `fallbackNotice` / `cspNotice` `role="note"` treatment in `AiInsightsPanel.module.css` (background `--color-warning-bg`, text `--color-text-primary`) for interrupted/OOM, so it matches the panel's established notice style. A true failure may use `role="alert"`.

**Transitions:** width via `--transition-base` (already in `ProgressBar`, reduced-motion-gated). No new keyframes.

---

## 8. Flows (for `e2e-tester`)

**F1 — Proactive download, happy path.** Settings → enable AI Insights → WebLLM selected → pick model → status `Needs a one-time download (~1.9 GB)` → click `Download model (~1.9 GB)` → indeterminate `Starting download…` → determinate `Downloading model — N%` (bar `aria-valuenow` increases) → `Preparing the model on your device…` → `Downloaded — ready.` Assert: `role="progressbar"` present during, absent after; `aria-valuenow` monotonic; live region announced milestones not every %.

**F2 — Cancel in Settings.** During `downloading`, click `Cancel` → `Download cancelled. The partial download is discarded.` + paused bar + Download button re-offered. Assert bar carries the paused (non-colour) cue and never shows 100%.

**F3 — In-drawer first use (the reported bug).** No prior download → trigger an insight → drawer shows **`Preparing the on-device model`** block with a real progress bar and download copy, **not** an empty prose+caret. Assert: no caret while `text === ''`; `progressbar` present; copy contains "one-time" and "nothing is uploaded".

**F4 — Drawer Cancel → idle.** During the drawer download block, click `Cancel` → drawer returns to **idle** (Generate button + chips), **not** an error screen. Assert no `role="alert"`; focus on the `Generate` button.

**F5 — Streaming separation.** After load completes and the first token streams, the download block is gone and the prose + caret + `Stop` appear. Assert the download block unmounts on first token.

**F6 — OOM / smaller model.** Force `model-load-failed` → Settings shows the smaller-model message + `Try again`, focus moves to the model `Select`; drawer routes via the existing error branch to "Open AI Insights settings". No silent model switch.

**F7 — WebGPU unsupported.** No Download button; existing unsupported note shown.

---

## 9. Acceptance checklist

- [ ] Settings `WebLLMConfig` offers `Download model (~N GB)` whenever the selected model is `needs-download`.
- [ ] Settings download shows: indeterminate `starting` → determinate `downloading` → `loading` → `Downloaded — ready`, with a working `Cancel` and `cancelled`/error/retry states.
- [ ] Drawer first-use renders a distinct **`Preparing the on-device model`** block (no caret/prose) while `progress !== null && text === ''`.
- [ ] Distinct copy for `downloading` vs `loading`; indeterminate fallback when `fraction === null`.
- [ ] Every state states one-time + size + on-device/nothing-uploaded + can-take-minutes; cached for next time.
- [ ] Drawer `Cancel` during load returns to **idle**, not an error.
- [ ] `ProgressBar` used (not a new bar); `role="progressbar"` + `aria-valuenow`/min/max/valuetext correct; `aria-valuenow` omitted when indeterminate.
- [ ] Throttled `aria-live` milestones only; errors `role="alert"`.
- [ ] Keyboard-operable Download/Cancel/Try-again; ≥44×44 px; visible focus; sensible focus moves (OOM → Select, drawer cancel → Generate).
- [ ] Colour never the sole signal (text phase line, `✓`, paused hatch, error icon+words).
- [ ] Reduced-motion honoured (inherited from `ProgressBar`; no new animation).
- [ ] All visuals are tokens; no literal colours/spacing.

---

## 10. Hand-off notes

- **`frontend`:** build `ModelDownloadProgress`; wire `WebLLMConfig` download lifecycle + drawer load/stream split (§4.1) + abort-before-token → idle (§4.3). Needs the provider `download()`/`prefetch` entry point and signal-honouring download (coordinate with `resmed-specialist`/provider owner — separate task, but blocks Surface A).
- **`ui-design`:** confirm the drawer block surface (`--color-surface-secondary`), the `✓`/⏳ glyphs, and that the block is visually unmistakably *not* the streaming area.
- **`security`:** confirm the download path performs zero egress beyond the model CDN already permitted by `connect-src`, and that `progress.text` (model-authored) is rendered as plain text (no HTML) — it appears in the muted line in both surfaces.
- **`documentation`:** the "one-time, on-device, ~N GB, cached" explanation should also live in AI Insights help; this spec's copy is the canonical short form.
