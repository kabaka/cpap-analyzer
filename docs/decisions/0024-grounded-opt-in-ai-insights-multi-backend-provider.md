# 0024 — Grounded, Opt-In AI Insights via a Multi-Backend Provider Abstraction

## Status

Accepted

## Context

The app already computes a large body of clinical and statistical results
deterministically — 20-plus analyses spanning AHI and its sub-indices, leak,
pressure, compliance (CMS 4-hour threshold, Kaplan-Meier), breathing-pattern
detection ([0017](0017-app-computed-breathing-pattern-detection.md)),
duration-weighted aggregate AHI ([0020](0020-rate-validity-floor-and-duration-weighted-aggregate-ahi.md)),
measurement uncertainty ([0018](0018-measurement-uncertainty-reliability-display.md)),
and sleep-stage / cycle-aware event analysis ([0022](0022-sleep-stage-and-cycle-aware-respiratory-event-analysis.md)).
The numbers are correct and well-tested. What they are not is **explained**.
A technically sophisticated patient can read a Kaplan-Meier curve or a central-index
trend, but turning a screen full of metrics into a few sentences of plain-language
context — "your AHI last night was 3.2, below your 30-day average of 4.1; the two
obstructive events both fell in the first hour, which matches your usual pattern" — is
exactly the kind of synthesis a language model is good at and a chart is not.

`docs/vision.md` §"LLM Integration Strategy" has always framed LLM features as
**optional and additive**: the app must be fully functional without them, and an ADR
was to be written "when LLM features enter the design phase." That phase is now. This
ADR records the architecture for the first such feature: **on-demand, grounded AI
Insights**.

This decision is architecturally significant for the same reason [0022](0022-weather-environmental-data-integration.md)
(weather) was: it sits on top of the app's two hardest invariants — **Privacy** (core
principle #1) and **Correctness** (core principle #2) — and, for some backends, it
crosses the network boundary that the project guards most carefully.

**The Correctness tension.** An LLM that is allowed to _compute_ clinical values is a
liability. Small models have weak numeric reasoning, and **all** models hallucinate; a
model asked "what was the AHI?" may confidently invent a number, miscompute an average,
or misstate a threshold. In a tool that informs health decisions, a fabricated clinical
value is the worst possible failure. Correctness is non-negotiable (#2), so the model
must never be the source of a number.

**The Privacy tension.** Until [0022](0022-weather-environmental-data-integration.md),
the app made **zero external network calls**; weather was the first carve-out, and it
established the template — opt-in, off by default, explicit two-gate consent naming
exactly what is sent and to whom, a minimal non-wildcard `connect-src` whitelist in
`src/buildtime/csp.ts`, and IndexedDB caching. LLM insights must honor
[0001](0001-client-side-architecture.md) (client-side only, no backend to proxy or hide
behind) and [0015](0015-zero-telemetry-analytics.md) (network access permitted _only_
for explicit, user-configured integrations). But unlike weather — where every backend is
a remote fetch — LLM inference can also run **fully on-device**, which means we can offer
a privacy posture _stronger_ than weather's: zero egress.

**The plugin question, settled.** [0007](0007-plugin-architecture.md) named "LLM
insights" as a future _integration plugin_. That runtime plugin registry was
**deferred/abandoned** in the Phase 11 evaluation (`docs/analysis/phase-11-plugin-evaluation.md`):
the project is built entirely by AI agents, there are no third-party plugin authors, and
a registry adds indirection and an API-stability trap for zero external consumers. The
recommendation was to build integrations as **direct first-party service modules**, and
weather followed exactly that pattern (`src/services/import/googlehealth/GoogleHealthImportService.ts`
as the template). AI Insights does the same. This ADR does **not** resurrect plugins.

**Backend landscape (the forces driving the provider abstraction).** No single LLM
backend satisfies every user. The relevant constraints:

- **Privacy-maximalist users** want zero egress, even if quality is lower. This is only
  possible with on-device inference: **WebLLM** (WebGPU, model weights downloaded once
  and run locally) or the browser's **built-in AI** (Chrome's Gemini Nano via the
  Summarizer / Prompt APIs), where the model ships with the browser and nothing leaves
  the device.
- **Quality-maximalist users** accept disclosing a grounded snapshot to a cloud provider
  in exchange for the best phrasing. The two realistic client-side paths are **Claude
  (Anthropic) browser-direct** (the SDK's `anthropic-dangerous-direct-browser-access`
  escape hatch, BYO key) and any **OpenAI-compatible endpoint** (OpenAI, OpenRouter,
  Together, and — importantly — **local servers** like Ollama and LM Studio, BYO key +
  base URL).
- We have **no backend** ([0001](0001-client-side-architecture.md)), so we cannot proxy,
  hold a shared API key, or hide the user's IP. Cloud backends necessarily expose the
  request to the provider and the browser's IP. There is no way around this client-side;
  the design goal is to **minimize and disclose** what is sent, exactly as weather did.

These constraints rule out picking one backend. They argue for a **single interface with
interchangeable implementations**, so the user chooses their own point on the
privacy/quality curve and the rest of the app is agnostic to which one is active.

**Regulatory / safety framing.** The app does not diagnose ([vision.md](../vision.md)
§"Regulatory Stance"); it seeks no medical-device certification. Generative text raises
the bar here: a model can easily drift into diagnostic phrasing ("you have central sleep
apnea"), false reassurance, or sycophantic agreement. The relevant practical frame is the
FDA's Clinical-Decision-Support / "general wellness" distinction — software that
_informs_ and keeps a human in the loop, with transparent, non-directive language, sits
on the wellness side. This is **not legal advice and not a certification claim**; it is a
design constraint on wording and disclosure.

This decision relates to [0001](0001-client-side-architecture.md) (which named LLM
integration as a server re-evaluation trigger — this ADR keeps it client-side and so does
_not_ trip that trigger), [0007](0007-plugin-architecture.md) /
`docs/analysis/phase-11-plugin-evaluation.md` (plugins deferred — service-module pattern),
[0015](0015-zero-telemetry-analytics.md) (network policy, opt-in carve-out), and
[0022](0022-weather-environmental-data-integration.md) (the opt-in + two-gate consent +
minimal-CSP + cache template this feature reuses).

## Considered Options

`docs/vision.md` §"LLM Integration Strategy" listed three integration approaches and,
implicitly, two scope tiers. Both axes were evaluated.

**Integration approach:**

- **(1) Remote MCP server.** Expose CPAP data as MCP tools that the user's _external_ LLM
  client (Claude Desktop, ChatGPT, etc.) calls. **Rejected for now.** It requires either a
  hosted MCP server (a backend — violates [0001](0001-client-side-architecture.md)) or
  pushing the user's data _out_ to a separate app, which inverts the privacy model: the
  data leaves our sandboxed, CSP-pinned origin entirely and lands somewhere we cannot
  constrain. It is also a tool-calling/agentic pattern, which belongs to the deferred
  conversational tier (below).
- **(2) Direct API integration (BYO key).** The app calls an LLM API directly with a
  user-provided key. **Chosen, in part.** This is the only cloud path compatible with
  "no backend": the request originates from the user's browser with the user's own key.
  We adopt it for the two cloud backends (Claude browser-direct, OpenAI-compatible).
- **(3) Local LLM in the browser.** Run a small model via WebLLM / browser built-in AI.
  Fully private, server-free, lower capability. **Chosen, as the default.** It is the only
  approach that preserves the zero-egress guarantee, so it becomes the privacy-default and
  the recommended path.

Rather than treat (2) and (3) as competitors, we adopt **both behind one abstraction** and
let the user choose — local backends are the default; cloud backends are an explicit,
consented upgrade.

**Scope tier:**

- **(A) On-demand grounded insights.** The user is viewing data; they press "Explain";
  the app sends a _fixed, pre-computed_ snapshot of already-computed metrics; the model
  returns prose. No tools, no data access, one request, one response. **Chosen.**
- **(B) Conversational tool-calling analyst.** A chat where the model can _call_ analysis
  functions, query stores, and iterate. Far more powerful, far larger surface: tool
  permissions, prompt-injection-driven tool execution, multi-turn cost/latency, and a much
  harder Correctness story (the model decides _which_ computed values to surface). **Deferred
  to a future ADR.** It is a strict superset of (A) and should be designed on top of the
  grounded foundation this ADR establishes, with its own privacy and safety review.

## Decision

Build **AI Insights** as an **optional, opt-in, off-by-default, additive** feature that
produces natural-language summaries and explanations of the user's _already-computed_
therapy data, implemented as a **first-party service module** (`src/services/llm/`) plus
UI, behind a **single `LLMProvider` interface** with four interchangeable backends. Six
sub-decisions.

**1. Compute-then-narrate (grounding) is mandatory — the model never computes a clinical value.**
The deterministic analysis pipeline computes **all** clinical and statistical values, as it
already does. The LLM is handed a **structured snapshot** of those _finished_ numbers
(metric name, value, unit, the user's relevant baseline/average, the date range, and
plain-language thresholds) and is instructed to **phrase and explain only what is in the
snapshot** — it may not compute, average, infer, or introduce any clinical figure. Where
the model emits a number, that number must be one already present in the snapshot; the UI
anchors claims to the visible figures. Grounding + structured input/output is the accepted
mitigation for weak numeric reasoning and hallucination, and it is what protects core
principle #2. This is the load-bearing decision: **the LLM is a narrator, not a
calculator.**

**2. First-party service module, not a plugin.**
Implement as `src/services/llm/` — a framework-agnostic module (provider implementations +
a snapshot builder + a guardrailed prompt assembler) with dependencies injected for
testability — exactly mirroring the weather service and per the Phase 11
direct-module recommendation. No `PluginRegistry`, no `DataProvider` adapter, no runtime
plugin contract. The plugin registry remains abandoned.

**3. One `LLMProvider` interface, four interchangeable backends.**
All backends implement the same minimal contract (roughly: `id`, `availability()`,
`generateInsight(groundedSnapshot, options) → text/stream`, and a capability descriptor for
egress class and consent requirement). The four backends:

- **WebLLM (in-browser, WebGPU) — the privacy default.** Model weights downloaded once and
  cached; inference runs entirely on the GPU. **Zero egress** after the model is fetched.
  Recommended default where WebGPU is available.
- **Chrome built-in AI (Gemini Nano via Summarizer / Prompt API) — progressive enhancement.**
  No app-side model download (the model ships with the browser). **Zero egress.** Preferred
  when available because it has the lightest footprint.
- **Claude (Anthropic) browser-direct — highest quality, BYO key.** Uses the Anthropic
  SDK's `anthropic-dangerous-direct-browser-access` to call the API straight from the
  browser with the user's own key. **Cloud egress** (grounded snapshot only).
- **OpenAI-compatible endpoint — BYO key + base URL.** Targets OpenAI, OpenRouter, Together,
  and **local servers** (Ollama, LM Studio). A user-supplied base URL means this single
  backend spans both cloud (egress) and loopback/local (no off-device egress) cases.

The active backend is a user setting; the rest of the app is backend-agnostic.

**4. Privacy model: off by default; local backends zero-egress; cloud backends gated by weather-style two-gate consent.**
The feature ships **disabled**. Enabling it and choosing a backend is explicit user action.

- **Local backends (WebLLM, Chrome built-in, loopback OpenAI-compatible) send nothing
  off-device** and therefore require no network consent — they preserve the
  zero-external-call guarantee for the data itself. (WebLLM's _one-time model-weights
  download_ is a fetch from a model host and is disclosed as such, but **no user data** is
  in that request.)
- **Cloud backends (Claude, remote OpenAI-compatible)** require the **same two-gate,
  explicit, weather-style consent** as [0022](0022-weather-environmental-data-integration.md):
  the user is shown, in plain language, **exactly what leaves the device** — the **grounded
  metric snapshot only** (aggregate numbers, units, baselines, and dates) — and **exactly to
  whom** (the named provider host). What is sent is deliberately minimal: **never the raw
  25–50 Hz signal data, never identifiers beyond dates.** Only after consent may a request go
  out, and only to the consented host.

**API key storage.** BYO keys are stored **locally**, never transmitted anywhere except as
the auth header to the user's chosen provider. The threat is **XSS / local storage
exfiltration**; the mitigations are the existing **strict CSP** and the **no-third-party-script**
posture ([0015](0015-zero-telemetry-analytics.md)) that make script injection hard. Given
that, the **recommendation is to keep keys in `sessionStorage` / in-memory by default**
(cleared when the tab closes, smaller exposure window) with an **explicit opt-in to persist**
in IndexedDB/localStorage for convenience — i.e. _persistence is the user's deliberate choice,
not the default_. Keys are never logged and never placed in the grounded snapshot.

**CSP.** `connect-src` in `src/buildtime/csp.ts` is extended **per enabled cloud backend**
to the **specific provider hosts only**, never a wildcard — e.g. `api.anthropic.com` for
Claude, `api.openai.com` for OpenAI, and (if shipped as presets) named OpenRouter/Together
hosts. **The known tension:** a build-injected meta-tag CSP **cannot allowlist a host the
user types at runtime** (an arbitrary OpenAI-compatible base URL) without a wildcard, and a
wildcard `connect-src` is unacceptable — it would re-open the exfiltration surface
[0015](0015-zero-telemetry-analytics.md) and [0022](0022-weather-environmental-data-integration.md)
closed. **Resolution:** (a) ship a curated allowlist of named presets (Anthropic, OpenAI,
OpenRouter, Together) that are covered by the static CSP; (b) explicitly allow
**localhost / loopback** so local servers (Ollama, LM Studio) work out of the box; and
(c) for a truly arbitrary user-typed _remote_ host, **document the limitation** — it cannot
be reached under the meta-tag CSP without a wildcard, so it is **not supported in this phase**
rather than weakening the policy. The runtime `network-policy.ts` allowlist
([0015](0015-zero-telemetry-analytics.md)) is updated in lockstep with the same hosts.

**5. Correctness & safety guardrails (the app does not diagnose).**
The system prompt and UI enforce a **wellness / descriptive** frame, not a diagnostic one:

- **Co-located caveats.** Every generated block carries an inline "**AI-generated —
  verify against the numbers**" caveat next to the output, not buried in settings.
- **Claims anchored to visible numbers.** Output references the figures the user can see on
  screen; the snapshot is the single source of truth.
- **No diagnosis, no directives.** Descriptive ("your central index rose 40% over three
  months") and, at most, a non-directive "_this may be worth discussing with your sleep
  physician_" — never "you have…" / "you should…".
- **Avoid sycophancy and anthropomorphism.** Neutral, factual register; the model does not
  agree-to-please or present itself as a clinician.
- **Prefer categorical over numeric confidence.** "consistent with your usual pattern"
  rather than invented "92% confident"; the model must not manufacture precision.

This is the practical expression of the FDA wellness-vs-CDS framing: informative,
non-directive, human-in-the-loop. It informs wording and disclaimers; it is **not** a
certification claim.

**6. Prompt-injection: low risk for this read-only use, mitigated by structure.**
The grounded snapshot is derived from the user's own data; in principle a field could carry
attacker-influenced text (e.g. a crafted machine/session label) that tries to steer the
model. For this **read-only narration** use the risk is low — **there are no tools and no
data access to hijack**: the worst outcome is mis-phrased prose the user can compare against
the visible numbers. Mitigations: the snapshot is **structured and escaped** (values are
fielded data, not free-form prose handed to the model as instructions), the system prompt is
fixed and instructs the model to treat snapshot content as data, and **no tool execution
occurs in this phase**. Tool-calling — where injection _would_ matter — is the deferred tier
and must carry its own injection review.

**Conversational tool-calling analyst is explicitly deferred** to a future ADR, built on the
grounded foundation here.

## Consequences

### Positive

- **Correctness is structurally protected.** Because the model never computes a clinical
  value — it only narrates a finished, deterministic snapshot — the worst hallucination
  failure mode (a fabricated AHI / threshold) is designed out, not merely discouraged.
- **A privacy posture stronger than weather is possible.** The default backends (WebLLM,
  Chrome built-in) are **zero-egress**: a user can get AI insights with _no_ data leaving
  the device at all — something the weather feature could never offer.
- **User-chosen privacy/quality tradeoff.** One interface, four backends: privacy-maximalists
  stay fully local; quality-maximalists opt into Claude/OpenAI with explicit, minimal,
  disclosed egress. Local servers (Ollama/LM Studio) give a high-quality _and_ local option.
- **Reuses the proven weather template.** Opt-in, off by default, two-gate consent naming
  exactly what is sent and to whom, minimal non-wildcard CSP whitelist, runtime network
  policy in lockstep — all established by [0022](0022-weather-environmental-data-integration.md).
- **Shippable without the plugin registry.** Follows the Phase 11 direct-service-module
  pattern; no resurrection of the abandoned plugin system, no API-stability trap.
- **Additive and removable.** The app is fully functional with the feature disabled, per
  vision.md; nothing in the core pipeline depends on it.
- **Does not trip the [0001](0001-client-side-architecture.md) server re-evaluation trigger.**
  LLM features land client-side with BYO keys; no backend is introduced.

### Negative

- **Cloud backends cross the privacy line again, with no proxy to soften it.** With no
  backend, Claude/remote-OpenAI requests expose the grounded snapshot and the browser's IP
  directly to a third party. Minimized to aggregate numbers + dates, this is still a
  disclosure of health-derived data to a provider the project does not control.
- **API keys are a new local secret with real exfiltration value.** Even with
  session-by-default storage and strict CSP, a stored credential is a higher-value XSS target
  than anything the app held before. The mitigation is preventative (CSP, no third-party
  scripts), not absolute.
- **The CSP cannot follow an arbitrary user-typed remote host.** Genuinely arbitrary remote
  OpenAI-compatible endpoints are unsupported in this phase rather than allowed via a
  wildcard — a real capability limit accepted to preserve the network lockdown.
- **Generative text can mislead even when grounded.** Phrasing can imply causation, drift
  toward diagnostic language, or sound falsely confident. Guardrails reduce but do not
  eliminate this; it is an inherent risk of putting model-authored prose next to health data.
- **Backend fragmentation and new failure modes.** Four backends mean four availability /
  capability / error surfaces: WebGPU absence, large WebLLM weight downloads, Chrome
  built-in-AI availability gating, provider 4xx/5xx/rate limits, key errors, and quality
  variance. The UI must degrade gracefully and never block analysis on insight availability.
- **Quality is uneven and unverifiable in-app.** A small local model phrases less fluently
  than a frontier cloud model; the app cannot tell the user which backend "got it right,"
  only that the numbers are the source of truth.

### Neutral

- **This extends the weather precedent to a second, more capable integration.** It also
  introduces the first **zero-egress** external-capability class, which future ADRs can cite
  when a local-compute option exists.
- **Conversational tool-calling is deliberately left on the table** as a future ADR, with
  its own privacy, tool-permission, and prompt-injection review; this ADR is the foundation
  it would build on.
- **The `LLMProvider` interface is a small, first-party contract**, not a public plugin API;
  it can be refactored freely (Phase 11 rationale) and does not commit the project to
  backward compatibility.
- **Backend availability will shift over time** — Chrome built-in AI is still maturing and
  WebGPU coverage is growing — so the default/recommended backend per environment is expected
  to evolve without changing this architecture.

## More Information

- **Supersedes the LLM-related portion of the Phase 11 integration stub**
  (`docs/analysis/phase-11-plugin-evaluation.md`): the LLM integration is realized as a
  direct service module (`src/services/llm/`), not an integration plugin.
- **Vision alignment:** implements `docs/vision.md` §"LLM Integration Strategy" — adopts
  approaches (2) Direct API and (3) Local LLM behind one abstraction, defers (1) Remote MCP,
  and keeps the feature optional/additive per that section and §"Regulatory Stance."
- **Grounding / hallucination basis:** the compute-then-narrate design rests on the
  well-established findings that LLMs (small models especially) have weak arithmetic/numeric
  reasoning and that all models hallucinate; structured-input + structured-output grounding,
  with computation done deterministically outside the model, is the standard mitigation.
- **Backend maturity references:** WebLLM (WebGPU in-browser inference), Transformers.js,
  and Chrome's built-in AI (Gemini Nano — Summarizer / Prompt API) are the enabling
  technologies for the zero-egress backends; the Anthropic SDK's
  `anthropic-dangerous-direct-browser-access` enables the browser-direct Claude backend.
- **Human-AI UX precedents** informing the guardrails and caveat placement: Google PAIR
  People + AI Guidebook, Microsoft HAX (Human-AI eXperience) guidelines, Apple's Human
  Interface Guidelines for machine intelligence, and consumer-health summary patterns from
  products such as Oura and Google Health — all emphasizing transparency, calibrated
  (non-overconfident) language, and keeping a human in the loop.
- **Regulatory framing:** FDA Clinical-Decision-Support / "general wellness" guidance informs
  the descriptive, non-directive wording at a practical level only. **This is not legal
  advice and the project seeks no medical-device certification.**

## Related Decisions

- [0001 — Client-Side Architecture](0001-client-side-architecture.md)
- [0007 — Plugin Architecture for Extensibility](0007-plugin-architecture.md) (deferred; see
  `docs/analysis/phase-11-plugin-evaluation.md`)
- [0015 — Zero Telemetry and Analytics](0015-zero-telemetry-analytics.md)
- [0022 — Weather & Environmental Data Integration via Open-Meteo](0022-weather-environmental-data-integration.md)
