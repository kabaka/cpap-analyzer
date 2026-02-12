# Split Session Handling at the ResMed Noon Boundary

**Date**: 2026-02-12
**Author**: ResMed Specialist Agent
**Status**: Analysis / Recommendation

---

## 1. How It Happens

ResMed devices use **noon (12:00 PM)** as their "day boundary" — not midnight. All therapy data recorded between noon today and noon tomorrow is grouped under today's date. On the SD card, EDF files are organized into day folders named by this date (e.g., `DATALOG/20241015/`).

When a user sleeps through noon — for example, a night-shift worker sleeping from 8:00 AM to 4:00 PM — the device starts recording to the current day folder, then at 12:00 PM begins writing to the **next** day folder. The result is a single contiguous sleep period split across two separate day folders with two separate sets of EDF files (BRP, EVE, PLD, etc.), each with different timestamps.

This is uncommon for typical users who sleep at night, but it reliably affects:

- **Shift workers** who regularly sleep through noon
- **Late sleepers** whose sessions extend past noon
- **Nap-takers** sleeping across the noon boundary (rare but possible)

## 2. Current Behavior

Our import pipeline processes data **per-day-folder**:

1. **`ImportService.groupByDay()`** groups all discovered EDF files by their parent folder name (e.g., `20241015`). Files from different day folders are never co-grouped.
2. **`SessionBuilder.buildSessions()`** receives only the interpretations from a single day folder and applies the 30-minute gap threshold to detect session boundaries within that group.

Because the two halves of a noon-spanning session live in different day folders, they are **never evaluated together** during session boundary detection. Each half becomes its own independent session, even though there was no actual gap in therapy.

The 30-minute gap threshold is irrelevant here — it works correctly for its intended purpose (detecting mask-off/mask-on breaks within a single day folder), but the split happens at a higher level in the pipeline before `SessionBuilder` is ever invoked.

## 3. Impact on Analysis

| Metric                      | Impact                                                                                                                                                                                                                                           | Severity     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| **AHI**                     | Each half-session computes AHI over a shorter usage period, amplifying statistical noise. A cluster of events in the first 2 hours of a 10-hour night would produce a higher AHI when calculated over a 4-hour half than over the full 10 hours. | Moderate     |
| **Usage time**              | Total usage is preserved across the two sessions, but neither session individually reflects the true continuous usage duration.                                                                                                                  | Low          |
| **Compliance**              | A 10-hour session split into two 5-hour sessions both appear compliant (≥4 hrs). However, if a 6-hour noon-spanning session splits into 3+3, **neither half meets the 4-hour CMS threshold**, incorrectly flagging the night as non-compliant.   | **High**     |
| **Trend analysis**          | Two data points appear for one night. Charts show a split or duplicate entry. Rolling averages are distorted by double-counting the date.                                                                                                        | Moderate     |
| **Nightly aggregates**      | Each half gets its own `NightlyAggregate` record. If downstream code groups aggregates by date, the two halves may land on different dates, further distorting per-night views.                                                                  | Moderate     |
| **Session date assignment** | `SessionBuilder.formatDate()` uses the session's start time. The second half is assigned to the next calendar date, which disagrees with the ResMed day convention.                                                                              | Low–Moderate |

## 4. Options Considered

### Option A: Auto-merge sessions spanning the noon boundary

Detect that two sessions in adjacent day folders are contiguous (gap < 30 minutes at the noon boundary) and merge them into a single session during import. All metrics are computed over the full merged session.

- **Pro**: Fully transparent to the user; correct metrics with no manual intervention.
- **Con**: Adds complexity to the import pipeline. Requires cross-day-folder analysis, which the current architecture avoids. Must handle edge cases (what if there's a real gap near noon?).

### Option B: Flag split sessions in the UI

Import as-is but detect the pattern post-import and display a warning badge on affected sessions.

- **Pro**: Simple to implement; no changes to the import pipeline.
- **Con**: Metrics remain incorrect. User sees the problem but can't fix it without Option C.

### Option C: Provide a manual "merge sessions" action

Let users select two sessions and merge them via a UI action.

- **Pro**: User retains control; handles ambiguous cases.
- **Con**: Requires user knowledge and effort. Shift workers would need to do this daily.

### Option D: Do nothing

Accept the split and document it as a known limitation.

- **Pro**: Zero implementation cost.
- **Con**: Compliance calculations can be wrong. Data quality is silently degraded for affected users.

## 5. Recommendation

**Option A (auto-merge)** is the right approach, with elements of Option B as a safety net.

**Why**: The compliance impact is the deciding factor. Incorrectly splitting a compliant night into two non-compliant halves is a data integrity bug, not a cosmetic issue. Users who sleep through noon — predominantly shift workers — are a meaningful population, and they should not need to manually fix every import.

**Suggested implementation approach**:

1. After `groupByDay()` and session building, run a **post-build merge pass** that examines sessions in adjacent day folders.
2. If two sessions from consecutive day folders have a gap at the boundary of **< 30 minutes** (same threshold, applied cross-day), merge them into a single session and recompute all aggregates.
3. Tag merged sessions with a `mergedFromDays: string[]` metadata field so the UI can display where the data originated.
4. Add a subtle indicator in the UI (per Option B) showing that a session was auto-merged, with a tooltip explaining why.

This preserves the existing per-day-folder pipeline (no architectural change to scanning or parsing) and adds a lightweight reconciliation step at the end of session building. The merge logic is essentially the same gap-threshold algorithm already in `SessionBuilder.detectSessionBoundaries()`, applied one level higher.
