# Breathing Episode Catalog — Streaming, Uncapped Analysis (Interaction Spec)

**Status:** Implementation-ready interaction design. Pairs with `ui-design` for
visuals; feeds `frontend` for build and `e2e-tester` for flow coverage.

**Owns:** the UX of the redesigned Explore → Breathing Patterns **Episode
Catalog** once it analyzes an **unbounded date range** ("all time" = hundreds to
thousands of nights). Implements the UX side of ADR
[0023](../decisions/0023-persisted-per-night-breathing-detection-cache.md) and the
storage contract in
[breathing-detection-cache-storage.md](../analysis/breathing-detection-cache-storage.md).

**Does not own:** colors/spacing/iconography (`ui-design`), the detector math
(`data-science`), the IndexedDB schema (`database`), or the WorkerPool scheduling
(`frontend`/`performance`). This document specifies _behavior_: what the user
sees, hears (screen reader), and can do at each moment, plus exact copy.

**Scope of change relative to current code:**

- Current behavior lives in `src/views/Explore/Breathing/Breathing.tsx`
  (`EpisodeCatalog`, controls ~305–341, status line ~343–356, table ~366–431) and
  `src/hooks/useBreathingEpisodeCatalog.ts` (sequential single-worker loop,
  `DEFAULT_CATALOG_NIGHT_CAP = 60`, `slice(0, maxNights)`, `capped` flag,
  "(truncated to keep the page responsive)").
- The hook gains: read-through over the persistent `breathing_detections` store
  (L1 Map → L2 IndexedDB → compute), parallel WorkerPool compute of misses,
  `AbortSignal` cancellation, **no cap**. The hook's public result shape must
  change to express the new states (see §10).

---

## 1. Guiding decisions (read first)

1. **Two phases, honestly distinguished.** A cold "all time" run has a fast
   **cache-read phase** (cheap indexed IDB reads, near-instant for a warm range)
   and a slow **compute phase** (uncached nights through the WorkerPool, ~150–300 ms
   each). We surface this distinction because the audience is technical and the
   difference is large and real: the read phase is "checking what's already done,"
   the compute phase is "analyzing N nights." Hiding it would make a warm revisit
   (instant) and a cold first run (minutes) look like the same opaque spinner.

2. **Determinate progress.** We know `nightsTotal` (session count in range) up
   front, and we know `nightsCached` after the read phase. Progress is therefore a
   real determinate bar, not a spinner. Power users get a count and a percentage.

3. **Results stream in, sorted, as they arrive** (already the behavior). The page
   is usable the instant the first cached/computed nights land — the user can
   filter, sort, select, and open episodes while compute continues underneath.

4. **Remove the cap; do not replace it with a hidden cap.** The product owner
   chose full-range analysis. We do **not** silently truncate. We instead make a
   long run _interruptible_ (cancel) and _non-blocking_ (streaming + background
   priority). An **optional, explicit, opt-in** bound is offered only as an escape
   hatch the user can choose — never a default (see §4).

5. **Filters are client-side and cheap; the date range is not.** Changing
   Pattern / Min confidence / Sort never restarts analysis. Changing the date
   range (or otherwise changing the detector identity) restarts it. This boundary
   must be obvious in copy and behavior (see §7).

---

## 2. Component inventory — reuse vs. new

Searched `src/components`. What exists and should be reused:

| Need                                        | Existing primitive                                  | Notes                                                                                                                                                                                     |
| ------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cancel / Re-run / Resume buttons            | `Button` (`src/components/ui/Button`)               | Has `variant` (`secondary`/`ghost`/`danger`), `size`, `loading` (renders an `aria-hidden` spinner + sets `aria-busy`). Use `secondary` for Cancel, `ghost` for the optional bound toggle. |
| Pattern / Sort selectors                    | `Select` (already used here)                        | Unchanged.                                                                                                                                                                                |
| Min-confidence                              | `Slider` (already used here)                        | Unchanged.                                                                                                                                                                                |
| Inline indeterminate spinner (button-local) | `Button`'s built-in spinner                         | For the small "reading cache…" affordance only.                                                                                                                                           |
| Toast for terminal background events        | `Toast` / `useToast` (`src/components/ui/Toast`)    | Optional, for "Analysis complete" when the user has scrolled away / tab backgrounded. See §1/§8.                                                                                          |
| Skeleton placeholder                        | `Skeleton` (`src/components/ui`)                    | For the very first paint before the read phase resolves (§3.1).                                                                                                                           |
| Confidence rendering in rows                | `ConfidenceBar` (`src/components/domain/Breathing`) | Unchanged.                                                                                                                                                                                |

**No shared `ProgressBar`/`Spinner` component exists.** The only determinate
progress bar in the codebase is **inlined** in
`src/views/DataManagement/ImportWizard.tsx` (search `role="progressbar"` — four
instances), using `role="progressbar"` + `aria-valuemin/valuemax/valuenow` +
`aria-label`, with a CSS fill driven by a ref.

**Recommendation (for `frontend` + `ui-design`): extract a reusable
`ProgressBar` UI primitive** (`src/components/ui/ProgressBar`) from the
ImportWizard pattern, supporting determinate (`value`/`max`) and the ARIA
attributes in §6, and exporting it from `src/components/ui/index.ts`. The catalog
is the second consumer of an identical pattern; a shared primitive avoids a
third divergent copy and gives both surfaces consistent a11y. If the orchestrator
prefers minimal surface for this change, the catalog **may** inline the same
markup as ImportWizard does — but the extraction is the better call and is the
recommended path.

Everything else (the catalog status line, the phase label, the partial/cancelled
banner) is **new markup composed from the above**, not new components.

---

## 3. Loading & progress experience (large cold range)

### 3.0 State machine

The catalog progresses through these states for a given date-range selection:

```
idle/disabled ──▶ reading-cache ──▶ computing ──▶ complete
                       │                 │             ▲
                       │                 ├─▶ cancelled ┘ (user cancels)
                       └─────────────────┴─▶ error (fatal enumerate failure)
```

- A **fully warm** range goes `reading-cache → complete` in well under a second
  (no compute phase). The compute UI never appears.
- A **cold** range goes `reading-cache → computing → complete`, with results
  streaming throughout.
- `cancelled` and `error` are terminal until the user re-runs or changes inputs.

### 3.1 First paint (before counts are known)

Between mount and the moment `nightsTotal` is known (the session enumeration),
show a compact, non-jarring placeholder in the status region rather than a bare
empty table:

- Status line copy: **"Preparing the episode catalog…"**
- A single `Skeleton` row block sized to ~3 table rows under the (already
  rendered) controls and column header, so layout does not jump when rows arrive.
- This phase is normally < 100 ms; the skeleton exists only to prevent a flash.

### 3.2 Cache-read phase

Once `nightsTotal` is known and the read-through layer is resolving cached nights:

- **Determinate progress bar** appears (see §6 for ARIA), value = cached nights
  resolved, max = `nightsTotal`.
- Phase label (the `aria-live="polite"` status line):
  **"Reading saved analysis… {nightsCached} of {nightsTotal} nights."**
- This phase is fast. For a fully warm range it completes immediately and the
  bar jumps to 100% → state `complete`. We deliberately still _name_ it so a warm
  revisit reads as "Reading saved analysis" (instant), distinguishing it from a
  cold run.

### 3.3 Compute phase

When some nights are uncached, after the read phase the run enters `computing`.
Cached results are already on screen (streamed in during the read phase, sorted);
uncached nights now stream in as the WorkerPool finishes them.

- The progress bar is **continuous across both phases** — it does not reset. Its
  `value` is total nights _resolved_ (cached + computed), `max` = `nightsTotal`.
  This gives one honest "how much of my range is done" signal.
- Phase label distinguishes the work and communicates cached-vs-computing counts:

  > **"Analyzing {nightsRemaining} new night{plural}… {nightsDone} of
  > {nightsTotal} done ({nightsCached} from cache)."**

  Where `nightsDone = nightsCached + nightsComputed`,
  `nightsRemaining = nightsTotal − nightsDone`.

- A secondary, quieter line (not in the live region — see §6.4 for why) may show a
  rough rate/ETA for technical users, **only** once enough nights have completed
  to estimate stably (e.g. ≥ 5 computed). Copy:
  **"~{rate} nights/s · about {eta} remaining"**. ETA is explicitly approximate;
  never present a false-precision countdown. Omit entirely if it cannot be
  estimated (e.g. fewer than 5 done).

### 3.4 Why distinguish "reading cache" vs "computing"

Yes — keep the distinction, for three reasons aligned with the project's
priorities and audience:

1. **Perceived performance & trust.** A warm "all time" that resolves in 300 ms
   should _say_ it read saved work, not flash a generic "Detecting…". A cold run
   that takes two minutes should _say_ it is analyzing N new nights, so the wait
   is attributable and expected rather than alarming.
2. **Accuracy of mental model (technical audience).** These users understand
   caches. Telling them "{nightsCached} from cache" explains why a revisit is
   instant and why a fresh import or a post-algorithm-change visit is slow (the
   cache invalidated; see ADR 0023 §4). It also implicitly reassures them that
   results are deterministic and reused, not recomputed differently each time.
3. **Honest cause for the slow path.** After an algorithm/parameter change the
   `detectorVersionHash` changes and the whole range recomputes (ADR 0023 §4).
   The compute-phase copy ("Analyzing N new nights") is the user-facing
   explanation for that one-time slowness, replacing the now-removed and
   misleading "(truncated…)" note.

The visual weight stays modest: one progress bar + one status line + one optional
quiet ETA line. We are not building a dashboard of internals.

---

## 4. The removed "truncated" message and the optional bound

**Remove the truncation message entirely.** There is no truncation now; keeping
any "(truncated…)" wording would be false. Delete the `capped` flag's UI usage at
`Breathing.tsx:353`.

**Recommendation on an optional bound: offer a non-default, explicit escape
hatch — but keep it out of the way.** Rationale:

- The product owner removed the cap because full-range analysis is the _point_ of
  the catalog; a hidden default cap would silently reintroduce the exact data-loss
  this work eliminates. So: **no default bound.** The default is "analyze the full
  selected range."
- However, the very first cold "all time" on a multi-year history can still be a
  multi-minute compute. Some users, some of the time, want to peek now and let the
  rest fill in later. Cancellation (§5) already covers "stop the long run," and a
  warm cache makes subsequent visits instant. Given those two, a _bound_ is a
  convenience, not a necessity.
- **Decision:** provide cancellation as the primary control, and additionally a
  lightweight **"Analyze newest first"** ordering plus an optional **"Pause after
  the most recent N nights"** affordance that is **off by default**, collapsed
  inside a small "Analysis options" disclosure (`Accordion`/`Popover`-style, your
  `ui-design` call). When on, it is a _soft_ bound: compute stops after N nights
  but the UI shows a clear, dismissible **"Resume — analyze the remaining {k}
  nights"** action (not a dead-end "truncated"). This is fundamentally different
  from the old cap: it is opt-in, reversible in one click, and never silently
  discards data.
  - Newest-first matters here because if a user _is_ going to bound, the most
    recent nights are almost always what they want first. Note this **reverses**
    the current oldest-first streaming order (`useBreathingEpisodeCatalog.ts`
    sorts `a.startTime.localeCompare(b.startTime)` → oldest first). Make the
    **compute order** a function of the active Sort: when Sort = "Date (newest
    first)", compute newest-first; otherwise default to newest-first for the
    bounded case and oldest-first for the unbounded case (oldest-first preserves
    the established "earliest matches stream in first" behavior the docstring
    describes). The _display_ order is always governed by the Sort control and is
    independent of compute order (§7).

- If the orchestrator wants the absolute minimum surface for v1: ship **only**
  cancellation + "Resume" and defer the explicit N-bound disclosure. Cancellation
  alone satisfies "let me stop a long run"; the N-bound is a refinement. Both are
  specified here so either scope is buildable. **My recommendation is to ship
  cancellation in v1 and treat the N-bound disclosure as a fast-follow**, because
  cancellation + persistent cache already make the cold run a one-time, stoppable
  cost.

---

## 5. Cancellation

### 5.1 Placement & label

- A **Cancel** button (`Button variant="secondary" size="sm"`) sits inline at the
  end of the status/progress row, only while state is `reading-cache` or
  `computing`. It is the rightmost control of that row so it does not crowd the
  filters above.
- Label: **"Cancel"** with an accessible name **"Cancel breathing analysis"**
  (`aria-label`) since the visible word alone is ambiguous out of context for
  screen-reader users.
- During the (typically sub-second) read phase the Cancel button may be present
  but is low-stakes; it is most meaningful during `computing`.

### 5.2 What happens to partial results

**Keep everything that streamed in.** Cancellation aborts the WorkerPool jobs for
_not-yet-started_ and _in-flight_ nights (via `AbortSignal`), but every night
already resolved (cached or computed) stays in the table, fully usable. We never
throw away completed work — that would waste compute the user already paid for and
contradict "respect the user's time."

On cancel, transition to state `cancelled` and:

- Progress bar stops, retains its last `value`, and is visually marked paused
  (not 100%). It must not look "complete." (See §6.3 for the ARIA on a paused
  bar.)
- Status line (live region) announces:

  > **"Analysis cancelled. Showing {nightsDone} of {nightsTotal} nights
  > ({episodeCount} episode{plural}). {nightsRemaining} night{plural} not yet
  > analyzed."**

- A persistent, non-dismissing inline **"Resume analysis"** action appears
  (`Button variant="secondary"`), accessible name **"Resume breathing analysis
  for the remaining {nightsRemaining} nights."** Resuming continues from where it
  stopped — only the still-uncached nights are dispatched (cached ones are already
  shown), so resume is cheap relative to a full restart.

### 5.3 Resume vs. re-run

- **Resume** (after cancel): continues the _same_ run for the _same_ range and
  detector identity; computes only the remaining uncached nights. Preferred path.
- **Re-run** is **not** offered as a routine control, because the cache makes a
  manual re-run pointless: an unchanged range + unchanged detector yields IDB
  hits, so "re-run" would just re-display the same rows. A genuine recompute
  happens automatically when the detector version/params change (cache
  invalidation, ADR 0023 §4) — no user button needed. (A developer/QA force-
  recompute may live behind a diagnostics affordance, out of scope for this
  spec.)

### 5.4 Implicit cancel on input change

Changing the **date range** while a run is in flight is an _implicit_ cancel +
restart of analysis for the new range (the hook already aborts the prior token on
dependency change; `useBreathingEpisodeCatalog.ts` cancel-token pattern). This is
expected and needs no confirmation — but the live region should announce the
restart (§7.2). Unmounting the view (navigating away) also cancels; no announce
needed.

---

## 6. Accessibility (WCAG AA)

### 6.1 Progress bar roles & values

The progress bar **must** carry (mirroring the ImportWizard pattern, extended):

- `role="progressbar"`
- `aria-valuemin={0}`
- `aria-valuemax={nightsTotal}` (the real total — not 100; use raw night counts
  so `valuetext` and `valuenow` agree in units)
- `aria-valuenow={nightsDone}`
- `aria-valuetext` — a human string, because raw "37 / 1825" is less clear read
  aloud than a sentence. Set it to the **same** phrasing family as the status
  line, e.g. **"Analyzing: 37 of 1825 nights done, 11 from cache."** Update it as
  counts change. During the read phase: **"Reading saved analysis: 812 of 1825
  nights."**
- `aria-label` (or `aria-labelledby` pointing at the section heading) =
  **"Breathing analysis progress."**

`valuetext` is what makes color/percent-free progress legible to screen readers;
do not rely on the visual fill alone.

### 6.2 The live region (status line)

- Reuse the existing `aria-live="polite"` status container (it already exists at
  `Breathing.tsx:343`). Keep it `polite`, never `assertive` — progress chatter
  must not interrupt the user.
- **Throttle announcements.** Streaming hundreds of nights would spam a screen
  reader if every `nightsComputed++` updated the live text. Update the _visible_
  count continuously (cheap), but only mutate the **live-region text** on
  meaningful boundaries:
  - phase transitions (reading → computing → complete/cancelled/error),
  - and periodic milestones during compute (e.g. every 10% of `nightsTotal`, or
    at most once per ~2–3 s).
    This keeps the announcements informative without flooding. Implementation note
    for `frontend`: drive the live text from a throttled value, separate from the
    `aria-valuenow`/visible counter which can update every tick.
- Terminal states (`complete`, `cancelled`, `error`) **always** announce.

### 6.3 Paused / cancelled progress bar

When cancelled, the bar stays at its partial `value`. To avoid implying
completion:

- Keep `aria-valuenow` at `nightsDone` (do **not** snap to `nightsTotal`).
- Update `aria-valuetext` to **"Analysis cancelled at 37 of 1825 nights."**
- Visually mark paused state with both a non-color cue (e.g. a hatch pattern or a
  "paused" glyph / the word "Cancelled" adjacent) and color — color is never the
  sole signal. (`ui-design` to specify the exact treatment.)

### 6.4 Why ETA is not in the live region

The optional rate/ETA line (§3.3) is decorative/secondary and changes
constantly; announcing it would be noise. Render it as a normal (non-live)
element, or `aria-hidden`, so assistive tech focuses on the meaningful phase +
milestone announcements.

### 6.5 Keyboard & focus

- **Cancel**, **Resume**, and any **Analysis-options** disclosure are standard
  `Button`s — keyboard-operable by default (Tab to focus, Enter/Space to
  activate), with the app's visible focus ring.
- **Focus management on cancel:** the Cancel button disappears and is replaced in
  the same row by the Resume button. Move focus to **Resume** when it appears, so
  a keyboard/SR user who just pressed Cancel is not dropped to `document.body`.
  Announce the cancelled state via the live region (which the focus move does not
  itself read).
- **Focus management on resume:** Resume is replaced by Cancel again; move focus
  to **Cancel**. On natural completion, Cancel disappears with nothing replacing
  it — move focus to the status line container (make it programmatically focusable
  with `tabindex="-1"`) or to the table region heading, so focus is not lost.
  Prefer the table region if results exist, so the user lands on the data.
- Tab order within the catalog card: section heading → filters (Pattern, Min
  confidence, Sort) → Analysis-options disclosure (if present) → Cancel/Resume →
  table. Filters stay reachable and operable throughout the run.
- The results **table** keeps its existing semantics; do not change row keyboard
  behavior. New rows appended mid-stream must not steal focus or reset scroll
  position (important: a user reading row 12 must not be yanked when row 13
  streams in).

### 6.6 Color-independence for cached vs computing vs error

Per WCAG 1.4.1, every status distinction must have a non-color signal:

- **Cached vs. freshly computed rows:** the default is to _not_ visually
  distinguish them at all — a result is a result, and marking provenance per row
  adds noise. If `ui-design` wants an optional provenance cue, it must be
  text/icon-based (e.g. a small "cached" tag with a tooltip), never a color tint
  alone. Recommendation: **do not** badge per-row provenance in v1; surface the
  cached _count_ in the status line instead (§3.3).
- **Per-night error rows:** see §8.3 — represented by text + icon, not a red tint
  alone.
- **Progress phases:** distinguished by the _words_ in the status line and
  `aria-valuetext`, plus optional icon, not by bar color alone.

### 6.7 Reduced motion & touch

- The progress fill animates a width transition; gate the animation behind
  `prefers-reduced-motion` (snap the fill instead of easing it). The bar's
  information is in the value, not the motion.
- Cancel/Resume/options controls are `Button`s; ensure they meet the ≥ 44×44 px
  touch target on mobile (the `Button` `sm` size must still satisfy this — verify
  with `ui-design`; pad the hit area if the visual is smaller).

---

## 7. Interaction with filters and the date range during a run

### 7.1 Filters (Pattern / Min confidence / Sort) — never restart analysis

These are pure client-side transforms over the already-streamed `episodes`
(`useMemo` filter/sort in `Breathing.tsx:267–292`). They must keep working
**live, mid-analysis**, applied to whatever has streamed in so far:

- Changing **Pattern** or **Min confidence** re-filters the current rows
  instantly; the count in the status line reflects filtered results while a second
  clause keeps the analysis truth visible. Combined copy during compute:

  > **"Showing {filteredCount} of {totalEpisodes} episode{plural} · analyzing
  > {nightsDone} of {nightsTotal} nights."**

  This separates "what the filter shows" from "how much of the range is analyzed"
  so a user who filters to high-confidence CSR during a cold run is not confused
  by a small number.

- Changing **Sort** re-sorts displayed rows instantly. As new rows stream in they
  are inserted per the active sort (already the behavior for confidence; extend to
  honor the selected sort key rather than always confidence-sorting the snapshot —
  current code hardcodes confidence sort in the hook snapshot at
  `useBreathingEpisodeCatalog.ts:273`; move sorting fully to the view's `useMemo`
  so the hook streams unsorted/append-only and the view owns order).
- **Empty filtered result during an active run** must be distinguishable from
  "analysis done, nothing matched" (see §8.1).

### 7.2 Date range — restarts analysis

Changing the `DateRangeSelector` changes the set of in-scope sessions, so it
**restarts** the catalog run for the new range (implicit cancel of the prior run,
§5.4):

- The table clears to the new range's streaming results. (Do not keep stale rows
  from the previous range — they are out of scope and would mislead.)
- Live region announces the restart succinctly:
  **"Date range changed. Re-reading saved analysis for {nightsTotal} nights."**
- Because most nights are likely cached after the first ever run, a date-range
  change usually resolves fast (read phase only). A change that pulls in many
  never-analyzed nights (e.g. extending into older history for the first time)
  enters the compute phase normally.
- Filters (Pattern/Min/Sort) **persist** across a date-range change — they are
  view preferences, not range-scoped. Selected-episode detail clears if the
  selected episode is no longer in range.

### 7.3 Summary table

| User action mid-run   | Analysis                   | Table                      | Live announce             |
| --------------------- | -------------------------- | -------------------------- | ------------------------- |
| Change Pattern filter | continues                  | re-filters instantly       | no (visual count updates) |
| Change Min confidence | continues                  | re-filters instantly       | no                        |
| Change Sort           | continues                  | re-sorts instantly         | no                        |
| Change date range     | **restarts** for new range | clears → streams new range | yes                       |
| Cancel                | aborts remaining           | keeps streamed rows        | yes                       |
| Resume                | continues remaining        | appends as they finish     | yes (on start)            |
| Navigate away         | cancels                    | n/a                        | no                        |

---

## 8. Empty / error / partial states & copy

All copy below is the canonical string set. `{plural}` = "" for 1 else "s".

### 8.1 Empty results

Distinguish four empties:

1. **No sessions in range at all** (`nightsTotal === 0`):

   > **"No sessions in the selected date range. Adjust the date range to analyze
   > your therapy nights."**
   > (No progress bar, no Cancel.)

2. **Analysis complete, no episodes detected anywhere** (`complete`,
   `totalEpisodes === 0`):

   > **"No candidate periodic-breathing or Cheyne-Stokes episodes were detected
   > across {nightsTotal} analyzed night{plural}."**
   > (This is a _result_, not a failure — phrase it as a clean finding.)

3. **Analysis complete, episodes exist but filters exclude them all**
   (`complete`, `totalEpisodes > 0`, `filteredCount === 0`):

   > **"No episodes match the current filters. {totalEpisodes} episode{plural}
   > detected across the range — lower the minimum confidence or change the
   > pattern filter to see them."**
   > (Actionable: points at the filters, not the data.)

4. **Still analyzing, nothing matched yet** (`computing`, `filteredCount === 0`):
   > **"No matching episodes yet — still analyzing {nightsRemaining} night{plural}."**
   > (Do not show the "complete/none found" copy while work continues — that would
   > read as a false conclusion.)

### 8.2 OPFS unsupported (fatal, environmental)

The hook already detects `OPFSService.isSupported() === false`. This is a
capability failure, not a transient error:

> **"Breathing analysis isn't available in this browser. It needs the Origin
> Private File System (OPFS) to read your full-resolution airflow signals. Try a
> recent Chrome, Edge, or Safari, or see [browser support](…/help/browser-support)."**

- Present as a clear inline notice (not a toast), with the help link.
- No progress bar, no Cancel, no table. Filters may be hidden (nothing to filter).
- Use the app's standard error styling **plus** an icon + the word — not color
  alone. (`ui-design` for the exact treatment; reuse the existing `errorText`
  style as a base.)

### 8.3 Per-night failures (some nights error, others succeed)

Today these are swallowed silently (`useBreathingEpisodeCatalog.ts:281–286`
catch → just advances the counter). With the cap gone and ranges large, silent
swallowing can hide that, say, 40 of 1,825 nights failed to read from OPFS. We
must surface this **honestly but non-alarmingly**, because a partial failure is
not a reason to distrust the nights that _did_ succeed:

- Continue the run on per-night failure (keep current resilience).
- Track a `nightsFailed` count distinct from `nightsComputed`.
- On completion with `nightsFailed > 0`, the status line shows a calm secondary
  clause:
  > **"Analysis complete: {episodeCount} episode{plural} from {nightsAnalyzed}
  > night{plural}. {nightsFailed} night{plural} could not be analyzed."**
- Make the failure clause a disclosure: a **"Details"** link/button opens a small
  popover or expandable list of failed nights (date + short reason, e.g.
  "signal unreadable", "no flow/minute-vent channel"). This serves the technical
  audience (who will want to know _which_ nights and _why_) without cluttering the
  default view. The list of failed nights with reasons must come from the hook
  (extend its result; see §10).
- Failed nights are **not** rendered as table rows (they have no episodes). They
  live only in the failure disclosure. Do not fabricate a "0 episodes" row that
  looks like a successful empty night — that conflates "analyzed, found nothing"
  with "could not analyze."
- The failure clause uses icon + text, never red color alone.

### 8.4 Cancelled with partial — see §5.2

Covered above. Canonical line repeated for the copy table:

> **"Analysis cancelled. Showing {nightsDone} of {nightsTotal} nights
> ({episodeCount} episode{plural}). {nightsRemaining} night{plural} not yet
> analyzed."**
>
> - **"Resume analysis"** action.

### 8.5 Fatal enumerate / DB error

If session enumeration or the IndexedDB read itself fails (not a per-night
failure — the whole run cannot proceed):

> **"Couldn't load the episode catalog. {message} Try reloading; your data is
> safe and stored locally."**

- Show the underlying short message (already surfaced via `error` in the hook),
  in plain language. No stack traces in the UI (log to console).
- Offer a **"Try again"** button that re-mounts/re-runs the hook for the current
  range.
- Distinct from §8.2 (OPFS) which is a capability gate, and from §8.3 (per-night)
  which is partial.

---

## 9. Canonical copy reference (all strings)

| State / element                    | Copy                                                                                                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First paint                        | `Preparing the episode catalog…`                                                                                                                                                                                           |
| Reading cache (status + valuetext) | `Reading saved analysis… {nightsCached} of {nightsTotal} nights.`                                                                                                                                                          |
| Computing (status)                 | `Analyzing {nightsRemaining} new night{plural}… {nightsDone} of {nightsTotal} done ({nightsCached} from cache).`                                                                                                           |
| Computing + filters active         | `Showing {filteredCount} of {totalEpisodes} episode{plural} · analyzing {nightsDone} of {nightsTotal} nights.`                                                                                                             |
| Optional ETA (non-live)            | `~{rate} nights/s · about {eta} remaining`                                                                                                                                                                                 |
| Complete                           | `Showing {filteredCount} of {totalEpisodes} episode{plural} from {nightsAnalyzed} of {nightsTotal} night{plural}.`                                                                                                         |
| Complete, some failed              | `Analysis complete: {episodeCount} episode{plural} from {nightsAnalyzed} night{plural}. {nightsFailed} night{plural} could not be analyzed.` + `Details`                                                                   |
| Cancelled                          | `Analysis cancelled. Showing {nightsDone} of {nightsTotal} nights ({episodeCount} episode{plural}). {nightsRemaining} night{plural} not yet analyzed.`                                                                     |
| Cancel button                      | visible `Cancel` · aria-label `Cancel breathing analysis`                                                                                                                                                                  |
| Resume button                      | visible `Resume analysis` · aria-label `Resume breathing analysis for the remaining {nightsRemaining} nights`                                                                                                              |
| Empty — no sessions                | `No sessions in the selected date range. Adjust the date range to analyze your therapy nights.`                                                                                                                            |
| Empty — none detected              | `No candidate periodic-breathing or Cheyne-Stokes episodes were detected across {nightsTotal} analyzed night{plural}.`                                                                                                     |
| Empty — filtered out (complete)    | `No episodes match the current filters. {totalEpisodes} episode{plural} detected across the range — lower the minimum confidence or change the pattern filter to see them.`                                                |
| Empty — filtered out (computing)   | `No matching episodes yet — still analyzing {nightsRemaining} night{plural}.`                                                                                                                                              |
| OPFS unsupported                   | `Breathing analysis isn't available in this browser. It needs the Origin Private File System (OPFS) to read your full-resolution airflow signals. Try a recent Chrome, Edge, or Safari, or see the browser-support guide.` |
| Per-night failure disclosure       | `Details` → list of `{date} — {reason}`                                                                                                                                                                                    |
| Fatal error                        | `Couldn't load the episode catalog. {message} Try reloading; your data is safe and stored locally.` + `Try again`                                                                                                          |
| Date-range restart announce        | `Date range changed. Re-reading saved analysis for {nightsTotal} nights.`                                                                                                                                                  |
| Progress aria-label                | `Breathing analysis progress`                                                                                                                                                                                              |
| Progress valuetext (computing)     | `Analyzing: {nightsDone} of {nightsTotal} nights done, {nightsCached} from cache.`                                                                                                                                         |
| Progress valuetext (reading)       | `Reading saved analysis: {nightsCached} of {nightsTotal} nights.`                                                                                                                                                          |
| Progress valuetext (cancelled)     | `Analysis cancelled at {nightsDone} of {nightsTotal} nights.`                                                                                                                                                              |
| Progress valuetext (complete)      | `Analysis complete: {nightsAnalyzed} of {nightsTotal} nights.`                                                                                                                                                             |

Plurality, number formatting (`tabular-nums` per UX guidelines), and date
formatting follow the app's existing conventions (`formatDate`).

---

## 10. Hook result shape — required UX-driven additions

The current `UseBreathingEpisodeCatalogResult` (`useBreathingEpisodeCatalog.ts:50`)
cannot express the new states. To support this spec, `frontend` should evolve it
to expose (names indicative; `frontend` finalizes):

- `phase: 'idle' | 'reading-cache' | 'computing' | 'complete' | 'cancelled' | 'error'`
  — drives the state machine (§3.0) instead of a bare `loading` boolean.
- `nightsTotal: number` — total sessions in range (already present).
- `nightsCached: number` — nights resolved from L2 cache (new; powers the
  "from cache" copy and the read/compute distinction).
- `nightsComputed: number` — nights freshly computed this run (semantics shift:
  _computed_, not _cached-or-computed_; was conflated before).
- Derived in the view: `nightsDone = nightsCached + nightsComputed`,
  `nightsRemaining = nightsTotal − nightsDone`.
- `nightsFailed: number` and `failures: { date: string; reason: string }[]`
  (new; powers §8.3).
- `cancel(): void` and `resume(): void` (new; powers §5). `cancel` flips the
  existing abort token; `resume` re-dispatches only still-uncached nights.
- `episodes` streamed **append-only and unsorted** from the hook; the **view**
  owns filtering and sorting (§7.1) — removes the hardcoded confidence sort at
  `useBreathingEpisodeCatalog.ts:273`.
- Remove `capped` (§4).

This is a spec for behavior; `frontend` and `data-science`/`database` own the
exact types and wiring. The orchestrator should route this list to `frontend`
alongside the storage contract.

---

## 11. Acceptance checklist (for `frontend` + `e2e-tester`)

- [ ] Cold "all time" shows determinate progress, streams sorted results, never
      blocks navigation or other filters.
- [ ] Warm revisit resolves via the read phase with no compute phase; copy says
      "Reading saved analysis," not "Analyzing."
- [ ] Progress bar exposes `role=progressbar` + valuemin/max/now/text; valuetext
      is a sentence and matches the status line phrasing.
- [ ] Live region is `polite`, announces phase transitions + throttled milestones + terminal states, and does **not** announce every streamed night.
- [ ] Cancel keeps all streamed rows, marks the bar paused (not complete), moves
      focus to Resume, announces the cancelled state.
- [ ] Resume computes only remaining uncached nights and moves focus back to
      Cancel.
- [ ] Changing Pattern/Min/Sort never restarts analysis and updates the table
      live mid-run; the dual count copy is shown.
- [ ] Changing date range restarts analysis, clears stale rows, announces, and
      preserves filter settings.
- [ ] No "truncated" copy anywhere; `capped` removed.
- [ ] OPFS-unsupported, none-detected, filtered-empty, computing-empty, per-night
      partial-failure (with Details), cancelled-partial, and fatal-error states
      each render their canonical copy and are visually distinguishable by more
      than color.
- [ ] Cancel/Resume/options controls keyboard-operable, focus-visible, ≥44×44 px
      touch targets; progress animation respects `prefers-reduced-motion`.
- [ ] No focus theft / scroll reset as rows stream in.

---

## 12. References

- `src/views/Explore/Breathing/Breathing.tsx` — `EpisodeCatalog` (controls
  305–341, status line 343–356, table 366–431); status container already
  `aria-live="polite"` at 343.
- `src/hooks/useBreathingEpisodeCatalog.ts` — current sequential capped loop;
  `DEFAULT_CATALOG_NIGHT_CAP = 60` (39), `slice(0, maxNights)` (247), `capped`
  (248/250), hardcoded confidence sort (273), per-night swallow (281–286),
  cancel-token pattern (228–230, 301–303), OPFS gate (216).
- `src/views/DataManagement/ImportWizard.tsx` — the existing inline determinate
  `role="progressbar"` pattern to extract/reuse (search `role="progressbar"`).
- `src/components/ui/Button/Button.tsx` — `loading`/spinner/`aria-busy` button.
- `src/components/ui/index.ts` — available primitives (`Button`, `Select`,
  `Slider`, `Skeleton`, `Toast`/`useToast`, `Accordion`, `Popover`, `Dialog`).
- `docs/ux-guidelines.md` — loading/error/empty-state and a11y conventions this
  spec conforms to.
- ADR [0023](../decisions/0023-persisted-per-night-breathing-detection-cache.md)
  and [breathing-detection-cache-storage.md](../analysis/breathing-detection-cache-storage.md)
  — the persistence + streaming architecture this UX sits on.
