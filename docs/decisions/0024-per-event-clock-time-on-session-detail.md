# 0024 — Surfacing Per-Event Wall-Clock Time on the Session Detail Page

## Status

Accepted

## Context

The **Session Detail** page (`src/views/Sessions/SessionDetail.tsx`) is the
canonical surface for reviewing a single night of therapy. A common, concrete
question a reviewer asks there is: **"At what clock time did this apnea (or other
respiratory event) occur?"** — e.g. to correlate an obstructive cluster with a
remembered awakening, a bed-partner observation, or a wearable signal.

Today the Session Detail page cannot answer that question directly. It presents
two event surfaces, neither of which exposes a per-event clock time:

- **`EventSummaryTable`** (`SessionDetail.tsx`) — an aggregate table grouped by
  event _type_ (count, total duration, average duration). It is a per-type roll-up
  and carries no timestamp for any individual event.
- **`EventTimeline`** (`SessionDetail.tsx`) — a strip of colored bars positioned
  by offset within the session. Each bar has a `Tooltip` whose content is
  `` `${label}: ${duration}s` `` (line 170) — type and duration only, **no clock
  time**. The tooltip is also transient (hover-only), not scannable across all
  events, not sortable, not copyable, and not reachable by keyboard.

Per-event clock time _does_ already exist, but only on two other surfaces, both of
which require leaving the per-night review context:

1. **Signal Viewer crosshair readout** (`src/views/Sessions/hoverReadout.ts` —
   `eventReadoutText` / `formatClockTime`). Reads the time for the single event
   currently under the crosshair. Requires drilling into the waveform view and
   hovering precisely over each event one at a time.
2. **Event Explorer `EventTable`** (`src/views/Explore/EventExplorer/EventTable.tsx`).
   A virtualized, sortable table with a **Time** column and deep-links into the
   Signal Viewer (`/sessions/:sessionId/signals?t=<epochMs>[&te=...]`). But this is
   a **cross-session analytical tool** in the Explore area — using it to read the
   time of a single night's event is a poor information-architecture fit and an
   awkward detour from the night the user is already looking at.

So the data is present; it is simply not surfaced where single-night review
happens. This is an information-architecture and UX gap on the most-used review
surface.

There is a second, **correctness-critical** wrinkle in how these surfaces format
time. The project's convention for CPAP and wearable timestamps is
**wall-clock-as-UTC** (`src/utils/wallClock.ts`): timezone-less local clock
components are fed to `Date.UTC`, and the displayed clock is recovered with **UTC
getters** on a wall-clock epoch. This makes a record render identically on any
machine and in CI, independent of the viewer's local timezone — a requirement for
Correctness and reproducibility.

The existing surfaces are **inconsistent** about this:

- The Signal Viewer readout is correct: `formatClockTime` (`hoverReadout.ts`,
  lines 36–42) uses `getUTCHours/Minutes/Seconds` on a wall-clock epoch derived
  via `sessionWallClockEpoch` (`src/views/Sessions/signalLanes.ts`), and so its
  times match the chart axis and crosshair exactly.
- The Event Explorer `EventTable` is **not**: `formatLocalTime` (`EventTable.tsx`,
  lines 41–51) calls `Date.toLocaleString(undefined, …)`, formatting the epoch
  against the **viewer's machine timezone**. For a session whose wall-clock epoch
  was constructed as UTC, this re-applies a local offset and can render a different
  clock time than the Signal Viewer for the very same event.
- Even the Session Detail timeline's axis labels take yet another path
  (`formatTime(new Date(sessionStart).toISOString())`, `SessionDetail.tsx` lines
  194–195).

Any new per-event time we add must not deepen this divergence.

This ADR records **where and how** to surface per-event clock time for single-night
review. It builds on the wall-clock-as-UTC convention (`src/utils/wallClock.ts`),
the event-presentation primitives (`src/components/events/eventTypeMeta.ts`,
`EventTypeSwatch`), and the deep-link contract established by the Event Explorer
(`EventTable.tsx`).

## Decision Drivers

Resolved against the project priority order
(Privacy > Correctness > Performance > UX > Features):

- **Privacy.** No effect. All event data is already on the device; this is a
  presentation change only. Satisfied by construction.
- **Correctness (decisive).** A clock time shown for an event MUST match the time
  the Signal Viewer shows for that same event. That means using the
  **wall-clock-as-UTC** convention (UTC getters on a wall-clock epoch via
  `formatClockTime` / `sessionWallClockEpoch`), **not** `Date.toLocaleString`
  against the viewer's local timezone. Two surfaces disagreeing on when an event
  occurred is a clinical-correctness defect, not a cosmetic one.
- **Performance.** A single night can contain a large number of events (a severe,
  long session can reach hundreds to low thousands). Rendering a per-event list
  must stay responsive and must not regress the Session Detail page.
- **UX.** The answer to "when did this happen" should be **scannable, sortable,
  keyboard-accessible, and copyable** — properties a transient tooltip cannot
  provide — and it should sit on the page the user is already reviewing.
- **Features.** A richer per-event view is welcome but must not compromise the
  above, and should reuse existing primitives rather than fork new ones.

## Considered Options

### A. Do nothing — rely on the Signal Viewer and Event Explorer (status quo)

Keep per-event time only on the crosshair readout and the cross-session table.

- **Pro:** Zero work; no new surface to maintain or test.
- **Con:** Forces the user to leave single-night review to answer a single-night
  question — either by hovering events one-by-one in the waveform view, or by
  detouring into a cross-session analytical tool in Explore. Poor information
  architecture for per-night review; the gap that motivated this ADR. **Rejected.**

### B. Add clock time only to the `EventTimeline` tooltip

Enrich the existing bar tooltip from `` `${label}: ${duration}s` `` to also include
the wall-clock time.

- **Pro:** Tiny change; immediately useful when hovering a bar.
- **Con:** Tooltips are **transient** (hover-only), so the user cannot scan all
  events' times at once, cannot sort them, cannot copy them, and — critically —
  cannot reach them by keyboard (the timeline is a single `role="img"`). This helps
  but does not actually deliver a reviewable, accessible answer. **Partial — kept
  as a cheap complement (see Option C), not as the primary solution.**

### C. Add a per-event list/table to Session Detail, and also enrich the timeline tooltip (chosen)

Add a per-event list directly on the Session Detail page with a **Time** column (and
type/duration, with room for per-event metrics), reusing the patterns and primitives
already proven in the Event Explorer `EventTable` — `eventTypeMeta` /
`EventTypeSwatch` for type presentation and the `?t=<epochMs>[&te=...]` deep-link
into the Signal Viewer for "show me this on the waveform." Sorting (at least by
time and duration) follows the `EventTable` model. **In addition**, enrich the
`EventTimeline` tooltip to include the wall-clock time, since that is a near-zero
cost win on a surface the user is already pointing at.

- **Pro:** Puts the answer on the canonical single-night surface. Scannable,
  sortable, keyboard-accessible, copyable. Complements (does not replace) the
  aggregate `EventSummaryTable` and the visual `EventTimeline`. Reuses established
  primitives and the deep-link contract, avoiding divergent implementations. The
  timeline-tooltip enrichment is essentially free.
- **Con:** New UI surface to build, test, theme, and keep accessible; per-night
  event volume may require virtualization (see Consequences). Adds a third event
  presentation to the same page, raising the bar on visual/IA coherence. **Chosen.**

## Decision Outcome

Adopt **Option C**. On the Session Detail page:

1. **Add a per-event list/table** of the session's individual events, with at
   minimum a **Time** column plus event type (via `eventTypeMeta` /
   `EventTypeSwatch`) and duration. Each row deep-links into the Signal Viewer using
   the existing contract (`/sessions/:sessionId/signals?t=<event.timestamp>` and,
   when `duration > 0`, `&te=<event.timestamp + duration*1000>`), matching
   `EventTable.openEvent`. Provide sorting consistent with `EventTable` (time,
   duration, type). This list **complements** the existing `EventSummaryTable`
   (aggregate by type) and `EventTimeline` (visual strip); it does not replace
   either.

2. **Enrich the `EventTimeline` tooltip** to include the event's wall-clock time in
   addition to type and duration.

3. **Mandatory correctness rule for both.** All per-event clock times on Session
   Detail MUST be formatted with the **wall-clock-as-UTC** convention — UTC getters
   on a wall-clock epoch, i.e. via `formatClockTime`
   (`src/views/Sessions/hoverReadout.ts`) against the session's wall-clock epoch
   from `sessionWallClockEpoch` (`src/views/Sessions/signalLanes.ts`). They MUST
   **NOT** use `Date.toLocaleString` / local-timezone formatting. The displayed
   time MUST match the Signal Viewer axis, crosshair, and event readout for the same
   event. A unit/integration test should assert this agreement.

The exact visual design (placement relative to the timeline and summary, default
sort, density, virtualization threshold) is delegated to `ux` / `ui-design` and
implemented by `frontend` / `data-visualization`, gated by `qa` and reviewed by
`security` where it touches rendered event data. This ADR fixes the _where_ (Session
Detail), the _what_ (a scannable, accessible, deep-linking per-event list plus
tooltip time), and the non-negotiable _how_ (wall-clock-as-UTC).

## Consequences

### Positive

- The most common single-night question — "when did this event happen?" — is
  answered **on the page where single-night review already happens**, with no detour
  into the waveform view or the cross-session Explore tool.
- The answer is **scannable, sortable, keyboard-accessible, and copyable**, unlike
  the transient timeline tooltip — meeting the WCAG AA expectations the project
  targets.
- Row-level **deep-linking into the Signal Viewer** lets a reviewer go from "when"
  to "show me on the waveform" in one click, reusing the established `?t/&te`
  contract.
- Reusing `eventTypeMeta` / `EventTypeSwatch` and the `EventTable` interaction
  patterns keeps event presentation **consistent** across surfaces and avoids
  divergent one-off implementations.
- Mandating wall-clock-as-UTC means Session Detail times are **reproducible across
  machines and in CI** and **agree with the Signal Viewer**, satisfying Correctness.
- The timeline-tooltip enrichment is a **near-zero-cost** UX improvement on a
  surface the user is already interacting with.

### Negative

- **New surface to build and maintain:** another component on Session Detail to
  test (unit + e2e), theme (light/dark/custom), and keep accessible (roving
  tabindex / `role="grid"` semantics, as `EventTable` already does).
- **Performance risk with high event counts.** A single night can hold hundreds to
  low thousands of events; a naive full render could jank the page. **Virtualization
  will likely be required** — the project already has a dependency-free fixed-row
  windowing implementation in `EventTable.tsx` to reuse, but applying it (and its
  keyboard model) here is non-trivial work, not a copy-paste.
- **Three event presentations on one page** (aggregate summary, visual timeline,
  per-event list) raises the information-architecture bar; without careful design
  the page can feel redundant or cluttered. This pushes real work onto `ux` /
  `ui-design`.

### Neutral / Follow-ups

- **Pre-existing timezone divergence is now explicit and must be resolved.** The
  Event Explorer `EventTable.formatLocalTime` uses `Date.toLocaleString` (local
  timezone), which can disagree with the wall-clock-as-UTC Signal Viewer for the
  same event. The Session Detail timeline axis labels take yet another path
  (`formatTime(new Date(sessionStart).toISOString())`). This ADR forbids adding new
  local-timezone formatting and recommends a **follow-up to converge all event-time
  formatting onto wall-clock-as-UTC** (notably migrating `EventTable.formatLocalTime`).
  Until that follow-up lands, the Session Detail list and the Event Explorer table
  may display _different_ clock times for the same event — a known, tracked
  inconsistency, with Session Detail being the correct one.
  **Update (implemented):** `EventTable.formatLocalTime` has been migrated onto the
  wall-clock-as-UTC convention, so the Event Explorer table now agrees with the
  Session Detail list and the Signal Viewer for the same event; the tracked
  inconsistency above is resolved. The Event Explorer's `timeOfNight` filter, by
  contrast, **remains viewer-local** and is a **still-open follow-up** — it was
  intentionally left out of scope for this convergence.
- Whether to share a single reusable event-table component between Session Detail
  and the Event Explorer (rather than two parallel implementations) is an
  implementation decision left to `frontend` / `qa`; this ADR only requires that
  the patterns and time convention not diverge.
- **Update (implemented):** the Session Detail Events list's link into the Event
  Explorer now **pre-scopes the Explorer to the originating session** (via a
  `session` URL parameter) instead of dropping the user into the unscoped,
  cross-session view — closing the information-architecture detour this ADR
  flagged as the cost of falling back to the Explorer for a single night.
- No storage, schema, parsing, or external-integration changes; Privacy is
  unaffected.

## Related Decisions

- [0016](0016-session-identity-non-unique-machine-date-index.md) — session identity
  (a night may contain multiple sessions), relevant to how a per-night event list is
  scoped.
- [0017](0017-app-computed-breathing-pattern-detection.md) — app-computed breathing
  detections are kept distinct from device events; this ADR concerns device events.
- [0018](0018-measurement-uncertainty-reliability-display.md) — honest display of
  clinical data, the correctness ethos this ADR's wall-clock constraint serves.
- [0019](0019-webgl2-hybrid-waveform-rendering.md) — the Signal Viewer this list
  deep-links into.
