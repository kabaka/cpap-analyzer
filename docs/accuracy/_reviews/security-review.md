# Security & Privacy Review — Measurement Uncertainty / Reliability Display

**Reviewer:** `security` (review-only) · **Date:** 2026-06-15
**Scope:** `docs/accuracy/_proposals/{ux,ui-design,dataviz,datascience}-proposal.md`, the three `_drafts/*.md` dossiers, and the code surfaces they touch (analysis utils, KPI/chart components, help/glossary content, PDF pipeline).
**Verdict:** No blocking security issues. The feature is computational + presentational and stays inside the privacy envelope. Findings below are mostly content-integrity and safety-framing concerns for `documentation`/`qa` to own, plus a few low-severity hardening notes.

---

## 1. Privacy — no data leaves the browser

**Finding P-1 (info, pass).** None of the four proposals introduces a network call, telemetry, analytics, external font, or remote asset. All work is in-browser: pure stats utils (`src/analysis/uncertainty/`, `src/utils/stats/confidenceBands.ts`), recharts/d3 rendering, CSS tokens, and inline SVG. UI-design §0/§4 and dataviz §6 explicitly forbid asset/icon dependencies ("hand-rolled SVG", "tokens + SVG only; nothing fetched"). This is consistent with Core Principle #1.

**Finding P-2 (info, pass — but verify at implementation).** The research drafts cite ~40 external URLs (DOIs, FDA, manufacturer help pages). These live only in `docs/` markdown and as **plain-text citation strings** in `src/content/help/glossary.ts`. Confirmed the render path: `GlossaryPanel.tsx` (lines 305–321) maps each citation into `<li>{citation}</li>` as a **text node — no `<a href>`, no fetch, no `dangerouslySetInnerHTML`**. So citations are inert text, exactly as required.
- **Remediation/guard:** when `documentation` adds the new `uncertainty`/`reliability` copy, citations must stay **plain-text strings**, never `<a href>` to DOIs/manufacturer pages and never runtime-fetched (e.g. no CrossRef/DOI resolution, no PMID lookups). If clickable links are ever desired, that is a separate review (would need `rel="noopener noreferrer"`, and external navigation is itself a minor privacy leak via Referer — prefer not to).

**Finding P-3 (info).** CSP (`src/buildtime/csp.ts`) currently pins `connect-src 'self'`. Nothing in this feature requires relaxing it. Confirm the build-injected CSP is unchanged by this PR (regression-tested by `csp.test.ts`).

---

## 2. Correctness-as-safety — uncertainty framing must not create a NEW hazard

This is the highest-value section. The proposals are unusually careful here, but two real risks remain.

**Finding S-1 (MED) — "low reliability" must never suppress or downplay a genuinely dangerous reading.**
The central/clear-airway and high-leak paths are the danger zone. A rising Clear-Airway (central) index can signal emergent/complex central sleep apnea — a clinically serious pattern. The proposals correctly say to label the *type split* `low`/"Indicative" (ICC ~0.16 obstructive subtype). The hazard is that a user reads "low reliability → ignore it" and dismisses a real central trend, or that a high-leak `DataQualityNotice` visually buries a high event count.
- The proposals already mitigate this well: UX §3.1/§3.5 says **"surface a *rising* Clear-Airway index as a clinician-conversation flag — never as a diagnosis,"** and UX §4 keeps **pressure/usage/apnea-count clean even on high-leak nights** rather than blanket-warning. Datascience §2.4 down-weights *type attribution*, not the *total count*.
- **Remediation (make it explicit and testable):** The reliability tier must qualify **classification/attribution confidence**, never the **existence or magnitude** of events. Copy must distinguish "we are unsure this event was *central vs obstructive*" from "this reading is unimportant." The "low reliability" label on the type split must **co-exist with**, not replace, an honest "central events appear to be rising — discuss with your clinician" signal. `qa`/`documentation` should add an explicit acceptance criterion: a high central trend under a `low` tier still produces a visible, non-dismissed clinician-conversation prompt. Add an e2e/edge-state test for "high central index + low reliability" to prove the dangerous reading is not silently softened.

**Finding S-2 (MED) — "discuss with your clinician" framing is correct, but watch the line into medical advice.**
"Discuss with your clinician" is the *safe* framing and should be kept (it is advice to seek care, not a diagnosis or treatment instruction). The line is crossed if copy starts recommending **actions** ("your central apnea may need ASV instead of CPAP," "consider lowering your pressure"). The glossary `apnea` detailed entry already edges toward this ("requiring different therapy (ASV vs. CPAP)") — acceptable as general education, but the **new** uncertainty copy must not pair a *specific user's* reading with a *specific therapy recommendation*.
- **Remediation:** Keep all new reliability/uncertainty copy descriptive + "discuss with clinician"; prohibit imperative treatment guidance tied to the user's own numbers. `documentation` owns wording; `qa` gates against diagnostic/therapeutic imperatives.

**Finding S-3 (low) — reassurance asymmetry.** Aleatoric copy ("your AHI naturally varies night to night") is reassuring; if mis-applied to an epistemic problem (or to a genuinely worsening trend) it could falsely calm a user. The proposals already require keeping the two templates separate (UI §5, UX §5). Ensure the aleatoric "this is normal variation" template is **never** auto-attached to a value that is trending across a severity boundary; defer to the trend band, not a soothing one-liner.

**Finding S-4 (info).** Honest-vs-reassuring balance is otherwise well handled: no error bars on solid metrics, no hard severity flip from one night, no imputation of missing data (UX §6, dataviz §2). These are correctness-positive and reduce the chance of misleading the user.

---

## 3. Content integrity — unverified numbers and medical-claim wording

**Finding C-1 (MED → enforce) — do not encode `[?]`-flagged manufacturer numbers as fact.**
Datascience §5 already inventories the unverified figures and (correctly) says they must not be hard-coded: ResMed "±0.5 cmH₂O + 4%", 0.2 cmH₂O display resolution, FOT ~1 cmH₂O, patent numbers, and the **24 L/min large-leak gate `[?/C]`** (the one that *feeds logic*). The risk is two-fold and security-relevant because it is a correctness/integrity issue:
  1. **In logic:** the 24 L/min leak gate drives the reliability tier and high-leak shading. If wrong, the app mislabels trustworthy nights as unreliable (or vice-versa).
  2. **In help copy:** asserting `[?]` figures as fact in glossary/footnotes is an integrity/liability concern.
- **Remediation:** (a) every threshold a **named constant** in one `RELIABILITY_THRESHOLDS` object with `[?]`/provenance comments, blocked on `resmed-specialist` sign-off before merge (already the datascience handoff). (b) Help copy must hedge unverified figures ("community-reported," "approximately") and never state them as manufacturer specification. (c) `documentation` should do the citation spot-check datascience requested (Lechat/Nigro/Iftikhar PMIDs) before any number enters user-facing copy. (d) Honor datascience §5: do **not** lock the `u_detect=10%` placeholder, the `1.254` worked figure, or the contested N=0 "3.0" value (use two-sided 3.689) into either logic or copy.

**Finding C-2 (low) — race/skin-tone pulse-oximetry bias content.** `wearable-accuracy.md` §102–107 documents occult-hypoxemia disparity in darker skin (a genuine, well-cited safety issue). If surfaced in help, frame it as a **measurement-bias caveat** ("consumer SpO₂ may overestimate true oxygen saturation, with larger errors at low saturation and in people with darker skin — do not rely on it to rule out hypoxemia"), not as race-based clinical advice. This is a safety-positive caveat worth including; just keep it descriptive and cited.

**Finding C-3 (low) — "Not a medical document" disclaimer.** The PDF already prints "For informational purposes only. Not a medical document." (`layout.ts:199`). The new "How to read this report" methodology footnote (UX §3.4) is consistent with this and should reinforce, not contradict it. Ensure no new copy implies the report is diagnostic.

---

## 4. PDF / export — injection & data-leak surface

**Finding E-1 (low) — user-controlled strings into PDF/SVG.** The new exports render reliability suffixes (`AHI 6.7 [moderate reliability]`), CI text (`5.0 (3.2–6.8)`), and footnotes. Reviewed the sinks:
  - **PDF:** jsPDF `doc.text()` / canvas `fillText()` (`layout.ts`, `charts.ts`) render strings as **glyphs** — there is no markup/script interpretation, so no classic injection. Tier labels and numbers are app-generated, not user-typed, which further limits the surface.
  - **SVG export:** `ChartContainer.handleExport` serializes SVG→PNG. New ARIA series names ("95% confidence band", "reduced-reliability region") are app constants, not user input.
- **Residual risk:** if any reliability/caveat string ever interpolates **user-supplied free text** (e.g. a device nickname, a configuration label, an imported session name) into a chart label or PDF cell, that text is untrusted (it originates from imported EDF/JSON, which crosses a trust boundary). Today's tier/CI strings are app-generated, so this is **low**.
- **Remediation:** keep reliability/CI strings composed only from numeric values + fixed label vocabulary. If a user-named field is ever shown alongside them, route it through the existing display-escaping path and cap length; do not concatenate raw imported strings into SVG `<text>`/PDF cells without bounding. Add a unit test asserting `formatMetric` output contains only `[0-9.,()%/ a-zA-Z–-]` so a malformed imported value can't smuggle markup into export.

**Finding E-2 (info).** No data-leak surface: export is local (blob/data: URIs already in CSP `img-src`); nothing is transmitted.

---

## 5. Dependencies — supply chain

**Finding D-1 (info, pass).** No new runtime dependency is implied. Everything is buildable on the existing set: `jspdf@4.1.0`, `recharts@2.15.0`, `d3@7.9.0`, `katex@0.16.28`. UI-design §4 and dataviz §4 explicitly forbid adding an icon library ("Do not add an icon dependency; privacy and bundle constraints require hand-rolled SVG"). The new math (inverse-χ², regularized incomplete gamma, t-quantile) is to be **hand-implemented** in `math/`, not pulled from a stats package — this *reduces* surface area and is the right call.
- **Remediation:** keep it dependency-free; if any contributor proposes a stats/icon/charting package mid-implementation, route back to `security`. Run `npm audit --audit-level=high` at the gate as usual (no change expected).

**Finding D-2 (low) — KaTeX path note.** Datascience adds new LaTeX formulas to glossary `detailed`/`formula`. These render via `MathEquation.tsx` using `katex.renderToString` + `dangerouslySetInnerHTML`. Current config is `throwOnError:false`, `strict:false`, and KaTeX's `trust` option is left at its **default (false)**, so `\href`/`\url`/`\includegraphics` are disabled — good, no link/asset injection via formulas. The formulas are author-authored constants (not user input), so risk is low.
- **Remediation:** do **not** set `trust:true` for the new formulas, and keep formula content author-controlled (never render a user-supplied LaTeX string through this component). The `strict:false` setting is acceptable for trusted authored content.

---

## 6. Accessibility-as-safety (color-only risk signaling)

**Finding A-1 (info, pass).** Because reliability gates a *health* signal, color-only encoding would be a safety problem, not just a WCAG miss. All four proposals already mandate **icon shape + text label** on every tier and **hatch patterns** (not opacity alone) for bands/shading, surviving grayscale/PDF/colorblindness (UX §5, UI §1/§4, dataviz §3.3/§6). The choice to render reliability on a **separate desaturated axis** from the green→red clinical-severity colors is correct and avoids a dangerous conflation of "low reliability" with "low severity." No action; verify the automated contrast check runs against resolved colors in both themes at the `qa` gate (UI §8).

---

## Severity summary

| ID | Severity | Area | One-line |
|----|----------|------|----------|
| S-1 | **med** | Safety framing | "Low reliability" must qualify event *attribution*, never suppress a real high/rising central trend; add edge-state test. |
| S-2 | **med** | Safety framing | Keep "discuss with clinician"; prohibit therapy-specific advice tied to the user's own numbers. |
| C-1 | **med** | Content integrity | `[?]` manufacturer numbers (esp. 24 L/min gate) blocked on `resmed-specialist`; never assert as fact in logic or copy. |
| S-3 | low | Safety framing | Don't auto-apply "normal variation" reassurance to a boundary-crossing trend. |
| C-2 | low | Content integrity | SpO₂ skin-tone bias: include as a measurement caveat, framed descriptively. |
| C-3 | low | Content integrity | New report footnote must reinforce existing "not a medical document" disclaimer. |
| E-1 | low | PDF/export | Tier/CI strings are app-generated (safe); guard against ever interpolating raw imported user text into PDF/SVG. |
| D-2 | low | Dependency | Keep KaTeX `trust:false`; formulas author-controlled only. |
| P-1/P-2/P-3, S-4, D-1, E-2, A-1 | info | Privacy/deps/a11y | No network/telemetry/asset/new-dep introduced; citations stay inert plain text; CSP unchanged. |

**Net:** privacy and supply-chain are clean; the substantive work for the team is in **safety framing (S-1, S-2)** and **content integrity (C-1)** — all owned by `documentation`/`data-science`/`resmed-specialist` with `qa` gating, no code changes from `security`.
