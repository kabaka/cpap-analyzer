/**
 * Pure helpers for the Signal Viewer's hovered-region readout.
 *
 * Extracted out of the (otherwise canvas/OPFS-heavy) viewer so the string
 * formatting and the device-event / detection-episode hit-test can be
 * unit-tested without mounting the full component. None of these functions read
 * the DOM — the legend-bar memo (`hoverReadout`) and the colour-swatch logic
 * stay in the component because they resolve CSS custom properties via
 * `getComputedStyle(containerRef.current)`.
 *
 * @module views/Sessions/hoverReadout
 */

import type { BreathingEpisode } from '@/analysis/breathing';
import type { Event as TherapyEvent } from '@/types';

/**
 * Humanize a PascalCase event type for display, e.g. `ObstructiveApnea` →
 * `Obstructive Apnea`. Splits only at lowercase→uppercase boundaries so all-caps
 * acronyms stay intact (`RERA` stays `RERA`, not `R E R A`).
 */
export function formatEventType(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * Format a session-relative ms offset as a wall clock `HH:MM:SS` (the recording
 * device's then-current local clock).
 *
 * `sessionStartMs` MUST be the session start in the **wall-clock-as-UTC**
 * convention (see {@link module:views/Sessions/signalLanes}.sessionWallClockEpoch).
 * Reading UTC getters off `sessionStartMs + relMs` then yields the device's local
 * wall clock and — critically — matches the X-axis tick labels and the crosshair
 * time badge exactly (they share the same epoch + UTC-getter convention).
 */
export function formatClockTime(sessionStartMs: number, relMs: number): string {
  const d = new Date(sessionStartMs + relMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Format a duration in seconds as `Ns` (<60s) or `m:ss`. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

/** Composite hovered-region identity: matched device event + detection episode. */
export interface HoveredRegion {
  readonly event: TherapyEvent | null;
  readonly episode: BreathingEpisode | null;
}

/** The empty hovered region — nothing under the cursor. */
export const EMPTY_HOVERED_REGION: HoveredRegion = { event: null, episode: null };

/** Stable key for a hovered region — only re-render when this changes. */
export function hoveredRegionKey(region: HoveredRegion): string {
  return `${region.event?.id ?? ''}|${region.episode?.id ?? ''}`;
}

/**
 * Build the device-event clause for the readout, e.g.
 * `▮ Obstructive Apnea · 02:14:07 · 18s` (plus a leak metric for LargeLeak).
 * `withMetric=false` drops the optional metric so a combined line still fits.
 *
 * Two epochs are passed because they serve different roles:
 * - `sessionStartMs` is the RAW session-start epoch, used only to turn the
 *   event's absolute `timestamp` into a session-relative offset.
 * - `wallClockEpochMs` is the session start in the **wall-clock-as-UTC**
 *   convention, used to format the displayed clock time so it matches the axis
 *   and crosshair exactly. Defaults to `sessionStartMs` for back-compat (when a
 *   caller already supplies a wall-clock-as-UTC epoch for both).
 */
export function eventReadoutText(
  event: TherapyEvent,
  sessionStartMs: number,
  withMetric: boolean,
  wallClockEpochMs: number = sessionStartMs,
): string {
  const startRel = event.timestamp - sessionStartMs;
  const parts = [
    formatEventType(event.type),
    formatClockTime(wallClockEpochMs, startRel),
    formatDuration(event.duration),
  ];
  let text = parts.join(' · ');
  if (withMetric && event.type === 'LargeLeak' && event.leak !== null) {
    text += ` · leak ${Math.round(event.leak)} L/min`;
  }
  return text;
}

/**
 * Build the detection clause for the readout, e.g.
 * `◷ PB candidate · 72% · cycle 38s · 4 min`. `withTail=false` drops the
 * cycle/duration tail so a combined line still fits.
 */
export function detectionReadoutText(episode: BreathingEpisode, withTail: boolean): string {
  const short = episode.type === 'CheyneStokes' ? 'CSR' : 'PB';
  const pct = Math.round(episode.confidence * 100);
  let text = `${short} candidate · ${pct}%`;
  if (withTail) {
    text += ` · cycle ${Math.round(episode.cycleLengthSec)}s · ${Math.round(
      episode.durationSec / 60,
    )} min`;
  }
  if (episode.belowDeviceThreshold) text += ' · sub-threshold';
  return text;
}

/**
 * Find the device event and detection episode whose [start, end] span (in
 * session-relative ms) contains `timeMs`. When several of a kind overlap the
 * cursor, the NARROWEST is chosen. Shared by the pointer hover path and the
 * keyboard cursor announcement so both report the same region.
 *
 * Pure: all inputs are passed explicitly so the selection can be unit-tested
 * without mounting the viewer. `detectionEpisodes` is ignored when
 * `showDetections` is false or it is `null`.
 *
 * @param timeMs - Cursor time, session-relative ms.
 * @param events - Device therapy events (absolute `timestamp`, seconds `duration`).
 * @param detectionEpisodes - App-computed breathing episodes, or `null` when unavailable.
 * @param sessionStartMs - Epoch ms of the session signal start.
 * @param showDetections - Whether breathing-detection overlays are enabled.
 * @returns The narrowest-span matching event + episode, or {@link EMPTY_HOVERED_REGION}.
 */
export function findHoveredRegion(
  timeMs: number,
  events: readonly TherapyEvent[],
  detectionEpisodes: readonly BreathingEpisode[] | null,
  sessionStartMs: number,
  showDetections: boolean,
): HoveredRegion {
  let event: TherapyEvent | null = null;
  let eventSpan = Infinity;
  for (const evt of events) {
    const start = evt.timestamp - sessionStartMs;
    const end = start + evt.duration * 1000;
    if (timeMs >= start && timeMs <= end) {
      const span = end - start;
      if (span < eventSpan) {
        eventSpan = span;
        event = evt;
      }
    }
  }

  let episode: BreathingEpisode | null = null;
  if (showDetections && detectionEpisodes) {
    let episodeSpan = Infinity;
    for (const ep of detectionEpisodes) {
      const start = ep.startMs - sessionStartMs;
      const end = ep.endMs - sessionStartMs;
      if (timeMs >= start && timeMs <= end) {
        const span = end - start;
        if (span < episodeSpan) {
          episodeSpan = span;
          episode = ep;
        }
      }
    }
  }

  return event || episode ? { event, episode } : EMPTY_HOVERED_REGION;
}
