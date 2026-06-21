# AI Insights — UX / Interaction Specification

**Owner**: UX
**Status**: Specification for implementation (frontend builds against this)
**Audience**: `frontend`, `ui-design`, `e2e-tester`, `documentation`, `security`, `qa`
**Supersedes**: the disabled "LLM Assistant — Coming soon" accordion stub in `src/views/Settings/Settings.tsx` (the `llm` integration item, lines ~335–387).

---

## 0. Scope and Non-Goals

**This spec defines** the interaction design, information architecture, states, accessibility, and exact microcopy for an opt-in **AI Insights** feature: natural-language **summaries and explanations of metrics the app has _already computed_**.

**Architecture is "compute-then-narrate".** Every number is computed deterministically by the app's existing analysis pipeline. The LLM only **phrases** those numbers into prose. The LLM is never the source of any metric, threshold, classification, or recommendation. This is the single most important framing constraint and it cascades into every trust-and-safety decision below.

**Additive and removable.** The application must remain fully functional and complete with AI Insights disabled (the default). No core flow may depend on it. When disabled, AI surfaces are entirely absent (not greyed-out teases).

**Non-goals (explicitly out of scope):**

- Free-form chat / open-ended Q&A over arbitrary data. (We offer a fixed, safe set of summary/explanation actions and suggested chips — not a chatbot.)
- The LLM computing, deriving, estimating, or correcting any metric.
- Any diagnostic, prescriptive, or treatment-changing output.
- Backend/model engineering (owned by `frontend` + a future `llm` service layer); this is interaction design only.

---

## 1. Research Precedents (why these choices)

These external precedents justify the trust-and-safety decisions throughout. They are cited inline where they drive a specific requirement.

- **Google PAIR — People + AI Guidebook (Explainability + Trust):** calibrate user trust to actual model reliability; "explain for understanding, not for blind confidence"; let users give feedback and correct course. Drives: show-your-work, thumbs feedback, categorical-not-false-precision confidence.
- **Microsoft Human-AI eXperience (HAX) Guidelines** — the specific guidelines we lean on:
  - **G1 "Make clear what the system can do."** Drives the panel intro copy and the per-output scope label.
  - **G2 "Make clear how well the system can do what it can do."** Drives the persistent "may be inaccurate" caveat and categorical confidence.
  - **G9 "Support efficient invocation."** Drives "Explain this" affordances co-located with the metric they explain.
  - **G10 "Support efficient dismissal."** Drives easy collapse/close of any insight, and never auto-expanding.
  - **G11 "Make clear why the system did what it did."** Drives the "Based on these numbers" source-metric panel under every output.
- **Apple HIG — Generative AI / Machine Learning:** disclose generated content clearly; set expectations; give people control and an off switch; design for graceful failure. Drives: the persistent "AI" label, opt-in default-off, comprehensive error states.
- **Oura / Google Health (no-diagnosis framing):** consumer health insights use wellness/descriptive language, defer to clinicians, and never diagnose. Drives: descriptive-verb vocabulary, "prepare to talk with your clinician" framing, the medical disclaimer.

A short "Why these guardrails" note in the feature's help article (owned by `documentation`) should restate these in user-facing terms.

---

## 2. Information Architecture

### 2.1 Where it lives

| Surface | Location | Behaviour when AI disabled |
|---|---|---|
| Configuration | Settings → **Integrations** tab → **AI Insights** accordion item | Item present, toggle off, collapsed; no AI elsewhere |
| Night/Range summary entry point | Dashboard header action + Session Detail header action | Action hidden entirely |
| "Explain this" affordances | Dashboard KPI cards, trend charts, session-detail metric tables | Affordance hidden entirely |
| Help article | Help → User Guides → Integrations → "AI Insights" | Always present (educational) |

The **AI Insights** accordion item replaces the current `llm` stub and sits **after** Weather in the Integrations accordion, because (per Core Principle 1, Privacy) the cloud backends make it the most privacy-sensitive integration and it should read last, after the user has seen the weather precedent for the two-gate pattern.

### 2.2 The opt-in posture (Apple HIG control + off switch)

- Default state: **disabled**. Persisted flag `insights.enabled = false`.
- While disabled, **no** AI affordance renders anywhere in the product. There are no "✨ Try AI" nags, no disabled buttons with tooltips, no upsells. Discovery happens only via Settings and the help article. This honours HAX G10 (dismissal) at the product level and the project's "out of the way when disabled" requirement.
- Disabling later removes all surfaces immediately and offers to delete cached insights (see §4.6).

---

## 3. Settings → Integrations → "AI Insights" Panel

Mirror the structure and lifecycle of `WeatherIntegrationPanel.tsx`: a switch row at top (Gate 1), config revealed only when enabled, and a consent dialog as Gate 2 for the subset that egresses.

### 3.1 Accordion trigger label

Match the weather trigger pattern (icon + label + state + online pill):

- Disabled: `AI Insights — Disabled`
- Enabled, local backend: `✨ AI Insights — On · On-device` with a green **On-device** pill (reuse the `onlinePill` slot styling but with the green/retained-local convention).
- Enabled, cloud backend: `✨ AI Insights — On · <Backend>` with the blue **Connects online** pill (identical to weather's `onlinePill`).

Color is never the sole signal: the pill always carries text ("On-device" / "Connects online"), satisfying WCAG 1.4.1. (`ui-design` to specify exact tokens; green = retained-local convention, blue = egress convention, reused from the weather contract.)

### 3.2 Gate 1 — Enable toggle (switch row)

Top of panel, identical layout to weather's `switchRow`:

- **Label:** `Enable AI Insights`
- **Description:** see §7.1 microcopy.
- **Switch:** `insights.enabled`.

Toggling **on** does **not** immediately enable cloud egress. It enables the feature and reveals config with the **privacy-preferring local backend pre-selected** (see §3.3). A purely local backend (WebLLM / Chrome built-in) requires **no** consent dialog because nothing leaves the device — this is the key difference from weather, where any enablement egressed. **The two-gate consent dialog appears only when the user selects (or switches to) a cloud backend** (§3.8).

Toggling **off** → immediately stop any in-flight generation, hide all AI surfaces, and open the disable/cleanup prompt (§4.6).

### 3.3 Backend selector

A labelled radio group (`role="radiogroup"`, keyboard arrow-navigable) — **not** a `<select>` — so each option can carry an inline privacy badge, description, and availability state. Four options, ordered privacy-first:

| # | Option label | Badge | Default? | Egress |
|---|---|---|---|---|
| 1 | **In-browser (WebLLM)** | 🟢 `On-device · Zero egress` | **Yes (default)** | None |
| 2 | **Chrome built-in AI** | 🟢 `On-device · Zero egress` | If available | None |
| 3 | **Claude (your API key)** | 🔵 `Connects online` | No | Cloud (BYO key) |
| 4 | **OpenAI-compatible / Ollama (your key + URL)** | 🔵 `Connects online` | No | Cloud unless URL is localhost |

Requirements:

- The two **on-device** options are visually grouped above a subtle divider labelled **"Stays on your device"**; the two cloud options below a divider labelled **"Sends a metric snapshot online (consent required)"**. This mirrors the weather "What leaves / what never leaves" green/blue convention and gives the user the privacy contract _before_ they pick (HAX G1, "make clear what the system can do" — including its data footprint).
- Default selection is **WebLLM** (zero egress). If WebGPU is unsupported (§3.4) and Chrome built-in is available, default to Chrome built-in; if neither local backend is available, leave the selector with WebLLM selected but in its unsupported state and surface the fallback message rather than silently defaulting to a cloud backend. **Never auto-select a cloud backend** — cloud is always an explicit user choice gated by consent.
- Each radio shows a one-line backend description and its current availability/status inline (e.g. "Not available in this browser", "Model not downloaded", "Key required").
- The badge text is always present (color-independent). The 🟢/🔵 glyphs are `aria-hidden`; the textual badge ("On-device · Zero egress" / "Connects online") is the accessible signal.

### 3.4 WebLLM backend config

Shown when WebLLM is selected.

**WebGPU capability detection (run on selection):**

- **Supported:** show the model picker and download UX below.
- **Unsupported:** replace config with the fallback message (§7.4 "WebGPU unsupported"), keep the radio selected but disabled-for-generation, and point the user to Chrome built-in or a cloud backend. Do not crash; do not hide the explanation behind an error toast — render it inline (UX guideline: "Browser incompatibility → feature detection with clear message about what's missing").

**Model picker:** a `Select` of curated models, each row showing: display name, parameter size, **download size on disk**, and a one-line "best for / speed vs quality" note. Example rows (final list owned by `frontend`/`performance`):

- `Llama 3.2 3B Instruct (q4) — ~1.9 GB — fast, lighter prose`
- `Qwen2.5 7B Instruct (q4) — ~4.7 GB — slower, richer prose`

**Storage-size disclosure (mandatory, before download):** a persistent inline note stating the on-disk size and that it is stored in the browser (OPFS/cache), counts against the same storage budget shown in Settings → Privacy & Storage, and can be removed any time. Microcopy in §7.4. This respects the project's storage-transparency norms and avoids a surprise multi-GB download.

**Download / progress UX:**

- A primary **Download model** button. On click → progressive download with a determinate progress bar showing **percent + downloaded/total (e.g. "1.2 GB / 1.9 GB") + an estimate** when available, plus a **Cancel** button. Never block the rest of Settings while downloading (background-capable; UX guideline "Never block the entire UI").
- States: `not-downloaded` → `downloading` (cancellable, resumable on retry) → `ready` → (`error` with retry; see §6).
- A **Remove downloaded model** (and free N GB) action once ready, with a confirm step. After removal the backend returns to `not-downloaded`.
- Progress is announced to screen readers at coarse intervals (every ~10%, not every frame) via a polite live region (see §8.4).

**First-generation note:** the first run after download may include model load/warm-up; the generating state (§5.2) shows "Loading model…" before "Generating…" so the user understands the one-time delay.

### 3.5 Chrome built-in AI backend config

Shown when Chrome built-in is selected.

**Availability detection (run on selection):** feature-detect the on-device model API.

- **Available & model ready:** show a short "Ready · runs on-device, nothing leaves your browser" status and any model-download/availability hint the API exposes (some states require a one-time on-device model provision; surface that with the same progress affordance as §3.4 when applicable).
- **Available but model must be provisioned:** show a **Set up on-device model** action with progress + the storage note.
- **Unavailable:** render the unavailable state inline (§7.4 "Chrome built-in unavailable") explaining it needs a supporting browser/flag, and steer the user to WebLLM or a cloud backend. No raw API error strings.

### 3.6 Claude backend config (BYO key, cloud)

Shown when Claude is selected. **Cloud — requires consent (§3.8) before first generation.**

- **API key** field: `type="password"`, label `Claude API key`, hint that it is stored locally only and never sent anywhere except Anthropic's API on requests you trigger. A "show/hide" toggle for the field. Empty key → generation disabled with the "no key" affordance (§6).
- **Model selector:** `Select` with exactly: **Claude Opus 4.8** (highest quality, slowest, highest cost), **Claude Sonnet 4.6** (balanced — recommended default), **Claude Haiku 4.5** (fastest, lowest cost). Default to **Sonnet 4.6**.
- **Cost note:** a non-alarming inline note that each summary sends a small metric snapshot and incurs usage cost on the user's own Anthropic account, and that local backends are free. Microcopy §7.5. Categorical ("small request, low cost") not a fabricated dollar figure — we cannot know their pricing tier, so we do not invent precision (PAIR: avoid false precision).
- Key validity is **not** pre-checked with a silent network call (privacy: no egress before consent). The first real generation is the validation; auth failures map to the "no/invalid key" error (§6).

### 3.7 OpenAI-compatible / Ollama backend config (BYO key + URL, cloud)

Shown when this backend is selected. **Treated as cloud (consent required) unless the base URL is localhost/loopback** (see note).

- **Base URL** field: label `Endpoint base URL`, placeholder `https://api.openai.com/v1` with hint that a local URL like `http://localhost:11434/v1` (Ollama) keeps data on-device.
- **API key** field: `type="password"`, optional for local Ollama (hint: "Leave blank for a local endpoint that needs no key").
- **Model** field: free-text `Model name` (e.g. `gpt-4o-mini`, `llama3.1`) since OpenAI-compatible servers expose arbitrary model ids.
- **Localhost detection for consent gating:** if the base URL resolves to `localhost`, `127.0.0.1`, `[::1]`, or a `*.local` loopback, treat as **on-device** (green badge, no consent dialog). Otherwise treat as **cloud** and require the two-gate consent (§3.8). Re-evaluate whenever the URL changes; switching from a local to a remote URL re-triggers consent. (`security` to confirm the loopback allowlist and that CSP `connect-src` permits the configured origin; see §6 CSP error.)

### 3.8 Gate 2 — Cloud egress consent dialog (mirror weather's `ConsentDialog`)

Reuse the exact structure, ARIA, and two-block green/blue contract of `src/views/Settings/weather/ConsentDialog.tsx`: a blue "What leaves your device" block (↗ glyph rows), a green "What never leaves" block (🔒 glyph rows), a footnote, an acknowledgement checkbox that gates the **Enable** button, and Cancel/Esc/overlay all reverting via `onCancel` without persisting.

**When it appears:** when the user selects a cloud backend (Claude, or OpenAI-compatible with a non-local URL), or switches the OpenAI-compatible URL from local to remote, and consent for that exact contract has not been recorded. It does **not** appear for local backends.

**What egresses — must be named exactly (this is the privacy contract; `security` to audit):**

What **leaves** your device (↗):
- A **compact, aggregate metric snapshot** for the night or range you ask about — the same summary numbers shown on screen (e.g. AHI, median/95th-percentile leak, usage hours, pressure summary, event counts, trend direction). Rounded/aggregate values, not raw waveform samples.
- The **calendar date or date range** of what you asked about.
- Your **chosen units and thresholds** so the wording matches your settings.

What **never leaves** your device (🔒):
- **Raw signals** — no flow, pressure, leak, or SpO₂ time-series; no 25–50 Hz data; no EDF files.
- **Any identifier** — no name, email, machine serial number, or account. There is no CPAP-Analyzer account; requests carry only your own provider API key.
- **Any data from nights you did not ask about.**

**`consentAt` + re-consent:** on acknowledged Enable, persist `insights.consentAt` (ISO timestamp) **and** a `insights.consentContractVersion` (or a hash of the egress-contract text). If the set of fields that can egress ever changes, bump the version; on mismatch, re-show the dialog before the next cloud generation (mirrors weather's "re-ask if what gets sent ever changes" footnote and satisfies the project's "re-consent if what-is-sent changes" requirement). Switching between two cloud backends does not require re-consent if the contract version is unchanged and already accepted, but the per-output egress reminder (§4.3) still applies.

**Exact dialog microcopy:** §7.2.

---

## 4. In-App Insight Surfaces

All surfaces are **absent** when `insights.enabled === false`.

### 4.1 Primary entry point — "Summarize this night / range"

- **Dashboard header:** a secondary button `✨ Summarize range` (range = current date-range selection). Placed in the dashboard header action cluster, not competing with the primary date navigator.
- **Session Detail header:** a secondary button `✨ Summarize this night`.
- Activating opens the **Insight panel** (§5) anchored as: a right-side drawer on desktop (≥1024px) reusing the help-panel drawer pattern (`@radix-ui/react-dialog` as a non-modal side panel so the user can still see their data — HAX G11 "show why" requires the numbers to stay visible), and a full-width expandable section / bottom sheet on mobile.
- The panel header states the **scope** explicitly ("Summary of 14–20 Jun 2026" / "Summary of the night of 20 Jun 2026") — HAX G1.

### 4.2 "Explain this" affordances (HAX G9, efficient invocation)

A small, consistent **"✨ Explain"** affordance co-located with the thing it explains:

- **Dashboard KPI cards:** an `✨ Explain` text-button in the card's overflow/secondary area (not covering the value). Explains _that_ KPI for the current range (e.g. "Explain my AHI").
- **Trend charts:** an `✨ Explain trend` action in the chart's toolbar (next to existing chart controls). Explains the trend the chart already shows (direction, magnitude, any change-point the analysis pipeline already detected — never a new computation).
- **Session-detail metric table rows:** an `✨ Explain` affordance per metric group (reusing the existing per-metric help `(?)` adjacency so AI explanation sits beside, and visually distinct from, the deterministic glossary help).

Each opens the Insight panel scoped to that single metric/chart. The affordance is keyboard-reachable and labelled (`aria-label="Explain my AHI for the selected range"`).

**Distinction from the existing help system:** the deterministic `(?)` tooltip/popover help (glossary, formulas) is **not** AI and must remain visually and behaviorally distinct from the `✨ AI` affordance. The ✨ sparkle glyph + "AI" wording is reserved exclusively for generated content (Apple HIG: clearly disclose generated content). Glossary help never carries the sparkle.

### 4.3 Per-output egress reminder (cloud backends only)

When a cloud backend is active, the Insight panel header carries a small persistent line: `Sends a metric snapshot to <Backend>. No raw data leaves your device. [What's sent →]` where the link re-opens the read-only egress contract (the §3.8 content, view-only). This is a continuous reminder of egress at the point of use, not just at setup (PAIR trust calibration; Apple HIG expectation-setting).

### 4.4 The "Show your work" source panel (HAX G11 — mandatory under every output)

Directly beneath every generated narrative, a collapsible **"Based on these numbers"** block lists the exact source metrics the narration was built from, with their on-screen values and units, e.g.:

```
Based on these numbers ▾
  AHI ................. 4.2 /hr   (Normal, < 5)
  Median leak ......... 12 L/min  (Normal)
  95th-pct leak ....... 21 L/min  (Normal)
  Usage ............... 7 h 12 m
  Nights in range ..... 7
  AHI trend ........... ↓ improving vs prior 7 nights
```

Requirements:

- Values are the app's computed numbers, formatted identically to how they appear elsewhere (tabular figures, same precision, same severity coloring **with** its text label per 1.4.1).
- Each row links to that metric's deterministic glossary help.
- Default **expanded** on first view per session (anchoring the prose to data builds calibrated trust — PAIR), collapsible thereafter (HAX G10). The narrative must never assert a number that is not present in this block; if narration and source disagree, that is a correctness bug (Core Principle 2) — `qa`/`unit-tester` should assert the narrator only receives, and only restates, these values.

### 4.5 Always-on caveat (Google Health pattern — co-located with EVERY output)

Every generated narrative — in the panel, in any KPI explanation, anywhere — is wrapped so the caveat is **inseparable** from the text (cannot be copied/displayed without it):

> **AI-generated — may be inaccurate. Verify against your data above.**

This is rendered as a labelled region (`role="note"`, `aria-label="AI disclaimer"`), with the ✨/AI label, and is part of the same component as the prose so it is impossible to surface narration without the caveat. Microcopy variants in §7.3.

### 4.6 Disable / cleanup prompt

On toggling the feature off (Gate 1) — mirror weather's on-disable deletion prompt with **Keep** as the default/focused action:

- Title: `AI Insights disabled`
- If cached insights and/or a downloaded local model exist, offer: **Keep** (default, autofocus) / **Delete cached insights** / (separately, if a model is downloaded) **Remove downloaded model (free N GB)**.
- API keys: offer **Forget saved API keys** as a distinct option (default Keep). Never silently retain or silently wipe credentials.

---

## 5. Insight Component States

The Insight panel/inline component is a small state machine. All states share: the scope header, the ✨ AI label, and (for cloud) the egress reminder.

### 5.1 Idle / pre-generation

- Shows the scope, a primary **Generate summary** (or **Explain**) button, and the **suggested chips** (§7.6) the user can pick to scope the request.
- For a cloud backend with no key, the primary action is disabled and the "no key" affordance (§6) is shown with a **Open AI Insights settings** deep-link.
- No prose, no caveat yet (nothing has been generated).

### 5.2 Generating (streaming, token-by-token)

- Replaces the button with a **streaming output region** (§8.3) that renders tokens as they arrive.
- A status line transitions: `Preparing your numbers…` → (local first run) `Loading model…` → `Generating…`. A subtle animated indicator (respecting reduced-motion, §8.5).
- A **Stop** button cancels generation immediately; partial text is retained and labelled "Stopped — partial result."
- The "Based on these numbers" source panel (§4.4) is shown **immediately** (the numbers exist before the prose; showing them first reinforces compute-then-narrate and gives the user something accurate to read while prose streams).
- The caveat (§4.5) is present from the first streamed token.

### 5.3 Complete

- Full narrative + inseparable caveat + expanded source panel.
- Action row: **Regenerate** (↻), **Copy** (copies prose **with** the caveat and a "Generated by AI from your CPAP data on <date>" line — never naked prose), **Thumbs up / Thumbs down** feedback (§5.6), and **Collapse/Close** (HAX G10).
- Timestamp + backend/model used, shown small ("Claude Sonnet 4.6 · 20 Jun 2026, 21:14"), so the user knows provenance (Apple HIG disclosure).

### 5.4 Error

Per-backend error taxonomy in §6. Every error state: a plain-language message, a concrete next action, a **Retry/Regenerate** affordance, and it preserves the user's context (never navigates away; UX guideline error rules). No stack traces in UI (log to console).

### 5.5 Empty / insufficient data

- When the scoped range has no nights, or too few data points to say anything meaningful (e.g. a single night for a "trend"), do **not** call the model. Show the empty state (§7.7) explaining what's missing and how to fix it (widen range / import data). The "Based on these numbers" panel shows whatever is available (possibly "No nights in this range").
- This guards correctness (Principle 2): we never ask the model to narrate a trend that the analysis pipeline did not compute.

### 5.6 Feedback (thumbs + regenerate)

- **Thumbs up / down** are local-only, stored locally, **never transmitted** (Privacy Principle 1 — no telemetry). Down-thumb optionally reveals a local-only free-text note and a quick **Regenerate** nudge. Tooltip on the control clarifies "Saved on your device only."
- Purpose: lets the power-user audience track which framings they found accurate and reinforces the "you are the judge" stance (PAIR: user correction/feedback).

---

## 6. Per-Backend Error States

| Error | Trigger | Message (see §7) | Primary action |
|---|---|---|---|
| **No / missing key** | Cloud backend selected, key empty | "Add your <Backend> API key in settings to use this." | Deep-link to AI Insights settings |
| **Invalid / unauthorized key** | 401/403 from provider on generate | "Your <Backend> API key was rejected. Check it in settings." | Open settings (key field focused) |
| **Network blocked by CSP / connection failed** | `connect-src` blocks the origin, or fetch fails | "Couldn't reach <Backend>. Your browser blocked the connection or you're offline. On-device backends don't need a connection." | Retry · Switch to on-device |
| **WebGPU unsupported** | WebLLM selected, no WebGPU | §7.4 fallback | Choose Chrome built-in / cloud |
| **Model not downloaded** | WebLLM selected, model absent | "This on-device model isn't downloaded yet (~N GB)." | Download model |
| **Model load failed / OOM** | WebLLM/WASM/GPU OOM | "The on-device model couldn't load on this device — it may need more memory. Try a smaller model." | Pick smaller model · Switch backend |
| **Rate-limited** | 429 from provider | "<Backend> is rate-limiting requests. Wait a moment and try again." | Retry (with a brief disabled cooldown) |
| **Timeout / aborted** | Slow or user Stop | "Generation stopped." / "This took too long and was stopped." | Regenerate |
| **Insufficient data** | §5.5 | §7.7 | Widen range / Import |

Common rules: messages are descriptive **and** actionable (WCAG-aligned), name the backend, and — wherever the failure is cloud-specific — remind that an **on-device backend avoids it**, reinforcing the privacy-preferring path. Errors render **inline** in the panel (`role="alert"`), not as transient toasts that a screen-reader user could miss.

For the **CSP** case specifically: cloud backends require their origin in `connect-src`. `security` and `frontend` must ensure the configured Claude/OpenAI/Ollama origins are permitted (or the request will fail silently at the network layer); when blocked, surface the message above rather than a generic failure. Localhost Ollama likewise needs `connect-src` to allow the loopback origin.

---

## 7. Microcopy (exact, recommended)

> Voice rules for all AI copy: **descriptive/wellness verbs only** ("shows", "indicates", "stayed within", "trended down", "may be worth discussing"); **never** diagnostic/prescriptive verbs ("diagnoses", "you have", "treats", "you should set your pressure to", "this proves"). **No first-person-intimate or anthropomorphic phrasing** ("I think", "I'm worried about you", "let me help you", "I noticed you"); the assistant has no persona. Frame as helping the user **understand their own data and prepare to talk with their clinician**. (Oura/Google Health no-diagnosis; Apple HIG.)

### 7.1 Settings — panel intro / enable description

> **Enable AI Insights**
> Turn computed metrics into plain-language summaries and explanations. The app does all the math; the AI only puts your existing numbers into words — it never calculates, diagnoses, or changes your therapy. Choose an on-device option to keep everything on your device, or a cloud option (your own API key) for higher-quality wording. AI output can be wrong; always check it against your data.

Backend-group divider labels:
> **Stays on your device** — nothing is sent anywhere.
> **Sends a metric snapshot online** — requires your consent and your own API key.

### 7.2 Cloud consent dialog (Gate 2) — exact copy

**Title:** `Send metric summaries to <Backend>?`
**Description:** `To write summaries with <Backend>, a small snapshot of your already-computed numbers is sent to <Backend> using your own API key. This is the only AI option that sends anything off your device. On-device options send nothing.`

**What leaves your device** (↗):
- `A compact summary of the metrics already shown on screen — values like AHI, leak, usage, pressure and event counts for the night or range you ask about. Rounded, aggregate numbers.`
- `The calendar date or date range you asked about.`
- `Your chosen units and thresholds, so the wording matches your settings.`

**What never leaves your device** (🔒):
- `Raw signals — no flow, pressure, leak, or SpO₂ waveforms, and no EDF files. None of it is sent.`
- `Any identifier — no name, email, or machine serial number. Requests carry only your own API key; there is no CPAP Analyzer account.`
- `Anything about nights you didn't ask about.`

**Footnote:** `Requests go only to <Backend>, on your own account and key. We save the date you agreed so we can re-ask if what gets sent ever changes.`

**Acknowledgement:** `I understand a summary of my computed metrics will be sent to <Backend>, and I want to enable this.`

**Buttons:** `Cancel` (secondary) · `Enable` (primary, disabled until acknowledged).

### 7.3 Always-on caveat (co-located with every output)

- Primary (panel summary): **`AI-generated — may be inaccurate. Verify against the numbers above.`**
- Compact (inline KPI explanation): **`AI-generated — verify against your data.`**
- Copied-text footer (appended on Copy): `— Generated by AI from your CPAP Analyzer data on <date>. May be inaccurate; verify against your data. Not medical advice.`

### 7.4 Local-backend states

- **Storage disclosure (before download):** `This model downloads about <N GB> and is stored in your browser so it can run fully on-device. It counts toward the storage shown in Privacy & Storage, and you can remove it any time.`
- **WebGPU unsupported:** `On-device AI (WebLLM) needs WebGPU, which this browser or device doesn't support. You can use Chrome's built-in AI if available, or a cloud option with your own API key. Nothing here changes your data or therapy.`
- **Chrome built-in unavailable:** `Chrome's built-in AI isn't available in this browser. It needs a recent Chrome with on-device AI support. You can use the in-browser (WebLLM) option or a cloud option instead.`
- **Downloading:** `Downloading model… <downloaded> / <total> (<pct>%)` with `Cancel`.
- **Ready (on-device):** `Ready — runs entirely on your device. Nothing leaves your browser.`

### 7.5 Claude cost note

> Each summary sends a small metric snapshot to Anthropic and uses your own API account, so it has a small cost per request. On-device options are free. Opus is highest quality and costs the most per request; Haiku is fastest and cheapest; Sonnet is a balanced default.

### 7.6 Suggested summary / question chips (4–6, safe-by-construction)

These scope a request to something the analysis pipeline already answers. They are **descriptive prompts, not diagnostic questions.**

1. `Summarize this night in plain language`
2. `How did my AHI trend over this range?`
3. `Explain my leak numbers`
4. `What changed compared to the previous period?`
5. `Summarize my usage and consistency`
6. `Help me prepare what to ask my clinician`

(Chip #6 produces a neutral, organized recap of the visible metrics framed as discussion points — never advice, never "you should". `documentation`/`data-science` to vet that each chip maps to already-computed outputs.)

### 7.7 Empty / insufficient-data states

- **No nights in range:** `There's no data in this range to summarize. Pick a range that includes nights with data, or import more sessions.`
- **Too few for a trend:** `A trend needs at least a few nights. This range has only <n>. Widen the range to see a trend summary.`
- **Metric unavailable for this night:** `This night doesn't include <metric>, so there's nothing to explain here.`

### 7.8 Medical disclaimer (in panel footer + help article)

> This is not medical advice, a diagnosis, or a treatment recommendation. AI Insights only rephrases metrics this app computed from your data and can be inaccurate. Always confirm against the numbers shown and consult your healthcare provider about your therapy.

(Consistent with the app-wide disclaimer in `docs/ux-guidelines.md` §"Disclaimers".)

---

## 8. Accessibility (WCAG AA)

### 8.1 Keyboard flow

- **Settings panel:** every control reachable and operable by keyboard. Backend selector is a `radiogroup`: `Tab` to enter, `↑/↓`/`←/→` to move selection (single-tab-stop roving). Download/Remove/Set-up buttons are normal buttons. The consent dialog (Radix `Dialog`) traps focus, returns focus to the trigger on close, and `Esc`/overlay cancels (inherited from weather's `Dialog`).
- **Insight entry points:** `✨ Summarize` / `✨ Explain` are buttons with descriptive `aria-label`s; reachable in normal tab order beside the element they describe.
- **Insight panel (desktop drawer):** **non-modal** — focus is **not** trapped, so the user can tab back to the underlying data while reading (this is intentional and is why we don't use a modal dialog for the panel; it directly serves HAX G11 "see why"). On open, move focus to the panel heading. On close, return focus to the invoking affordance.
- **Within the panel:** logical order — heading → egress reminder link → generate/chips → (on complete) action row (Regenerate, Copy, Thumbs, Collapse). `Esc` collapses/closes the panel and restores focus.
- **Stop** during streaming is focusable and operable; activating it leaves focus on a sensible nearby control (the Regenerate button).

### 8.2 Focus management for dynamic content

- Opening the panel: focus → panel `<h2>` scope heading (programmatically focusable, `tabindex="-1"`).
- Transition idle→generating must not yank focus away from a control the user is on unless they initiated it; the streaming region is announced via live region, not by stealing focus.
- Errors set focus to the inline `role="alert"` only if the user initiated the action that failed; otherwise announce politely.

### 8.3 Streaming text + screen readers (the hard part)

Streaming token-by-token is hostile to screen readers if naively wired to `aria-live` (every token would be announced, producing gibberish). Required handling:

- The visual streaming region is a normal element that updates per token for **sighted** users.
- Screen-reader announcement uses a **separate strategy**: the live region is `aria-live="polite"` `aria-atomic="false"` but is updated **coarsely** — buffer tokens and flush to the live region at sentence boundaries (or ~every 1.5 s), not per token. This yields intelligible phrase-level announcements instead of a token storm. (PAIR/HAX: the experience must be usable, not just technically live.)
- While streaming, expose `aria-busy="true"` on the region; set `aria-busy="false"` on completion and announce a terminal cue: "Summary complete."
- Provide a **"Read full summary"** affordance: on complete, the entire prose is available as a single static, fully labelled block so a screen-reader user can navigate it normally rather than relying on the streamed announcements.
- The **source panel (§4.4)** is the authoritative accessible representation of the underlying data (mirrors the app's "data tables are the accessible representation of charts" rule) — it is plain semantic markup (a definition list / table), fully navigable.

### 8.4 Progress + status announcements

- Model download progress: a polite live region announcing coarse milestones ("Downloading model, 30 percent") — not every percent.
- Generation status changes ("Loading model", "Generating", "Complete", "Stopped") announced politely.

### 8.5 Color is never the sole signal

- **AI label:** the ✨ glyph is decorative (`aria-hidden`); the literal text **"AI"** / **"AI-generated"** always accompanies it. Never rely on a purple "AI" tint alone (1.4.1).
- **On-device vs cloud:** always carries text ("On-device · Zero egress" / "Connects online") in addition to green/blue (1.4.1).
- **Confidence:** we use **categorical** wording, not numeric scores, and never color-only. Preferred: **omit confidence entirely** and rely on the persistent caveat + source numbers; if a categorical hint is shown, render it as text (e.g. "based on 7 nights") not a colored dot. We deliberately avoid a fabricated numeric confidence percentage (PAIR: don't manufacture precision the model can't justify; the model only phrases — it has no calibrated confidence about the user's health).
- **Severity values** echoed in the source panel keep their text label (Normal/Mild/Moderate/Severe) beside any color (1.4.1), reusing the app's existing convention.
- Focus indicators: visible high-contrast focus ring on all controls (2.4.7), including chips and the Stop button.
- Touch targets ≥ 44×44px for all AI controls on mobile (chips, Explain buttons, thumbs).

### 8.6 Reduced motion

- Respect `prefers-reduced-motion`. When reduced: **no** typewriter/streaming animation flourish, no spinner pulse, no progress-bar shimmer. Behaviour change: text may appear in **larger coarse chunks** or, at minimum, without animated cursor/fade; the determinate progress bar updates value without animated transitions. Streaming still functions (content still arrives incrementally) but without motion decoration. (Consistent with `docs/ux-guidelines.md` motion rules and `documentation-strategy.md` reduced-motion CSS.)

---

## 9. Trust & Safety Summary (acceptance checklist for `qa` / `e2e-tester`)

A build is non-compliant if any of these fail:

1. **Off by default; invisible when off.** No AI surface renders with `insights.enabled=false`. (Apple HIG control.)
2. **Compute-then-narrate enforced.** The narrator receives only already-computed values; every number in the prose appears in the §4.4 source panel. (Principle 2.)
3. **Caveat is inseparable** from every output and from copied text. (Google Health.)
4. **No diagnostic/prescriptive/first-person-intimate language** in any shipped microcopy or system prompt scaffolding. (Oura/Google Health; Apple HIG.) `qa` greps shipped strings for banned verbs.
5. **Cloud egress is gated** by the two-gate consent that names exactly the §3.8 contract; `consentAt` + contract version persisted; re-consent on contract change. (Mirrors weather; Privacy Principle 1.)
6. **No egress before consent**, including no silent key-validation calls. Local backends never egress. (Principle 1.)
7. **"Show your work" present and expanded by default**; links to deterministic help. (HAX G11.)
8. **Per-output egress reminder** on cloud backends. (PAIR trust calibration.)
9. **Every error state** is plain-language, actionable, inline (`role="alert"`), preserves context, and points to the on-device alternative where applicable.
10. **Accessibility:** radiogroup keyboard nav; non-modal panel focus handling; coarse `aria-live` streaming (no token storm); reduced-motion honored; color-never-sole for AI label / online-state / severity / confidence; 44px targets; visible focus.
11. **Feedback/thumbs and all preferences are local-only** — zero network. (Principle 1.)
12. **Disable flow** offers Keep-default cleanup of cached insights, downloaded model, and saved keys.

---

## 10. Handoff Notes

- **`ui-design`:** specify exact tokens for the ✨/AI label treatment, the green "On-device" vs blue "Connects online" pills (reuse weather's egress/retained convention), the source-panel styling, streaming-region typography (monospace optional for the in-progress cursor; reduced-motion variants), and the suggested-chip component. Confirm the AI label is distinguishable from glossary `(?)` help.
- **`frontend`:** implement against this; reuse `Dialog`, `Switch`, `Select`, `Button`, `Input`, `SegmentedControl` from `@/components/ui` and the `ConsentDialog` two-gate pattern. New persisted settings shape (coordinate with `database`/`settings.ts`): `insights: { enabled, backend, consentAt, consentContractVersion, webllm: { model, downloadState }, chromeAi: {...}, claude: { apiKey, model }, openaiCompat: { baseUrl, apiKey, model } }`. The current `llm` stub type (`src/types/settings.ts` line 154) is replaced.
- **`data-science` / `resmed-specialist`:** define the exact, bounded **metric snapshot schema** that may be handed to the narrator (the only thing that can egress) and confirm each suggested chip maps to an already-computed output. This schema is the privacy contract's machine form and must match §3.8 / §7.2.
- **`security`:** audit the egress contract, the localhost/loopback allowlist for the OpenAI-compatible backend, `connect-src` CSP entries for each cloud origin, key storage at rest, and that the snapshot can never include raw signals or identifiers.
- **`documentation`:** author the "AI Insights" help article (what it does / can't do, the four backends, the privacy contract, "why these guardrails" restating §1 precedents) and add glossary cross-links from the source panel.
- **`e2e-tester`:** cover the flows in §9 — enable→local (no consent, no egress), enable→cloud (consent gate, revert on cancel), generate/stream/stop/regenerate/copy, every error in §6, empty/insufficient data, disable→cleanup, and the accessibility assertions in §8.
```
