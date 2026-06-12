/**
 * Aggregate per-night breathing-pattern episode detections for an entire date
 * range, used by the Explore → Breathing Patterns episode catalog. Runs the
 * detector **sequentially** night-by-night so a long range can not hammer the
 * worker pool, surfaces a progress counter for the loading state, and caps the
 * number of nights computed in one mount so a multi-year range can not lock
 * the tab.
 *
 * The catalog maintains its OWN module-level result cache (`catalogCache`),
 * separate from the per-session viewer's `episodeCache` in
 * {@link useBreathingEpisodes}. Each cache de-dupes within its own surface so
 * a catalog re-render or viewer re-mount never re-computes, but the two
 * caches do NOT share state across surfaces: visiting a session in the viewer
 * does not warm the catalog's entry for that night, and vice versa. This is
 * a deliberate isolation — the two surfaces may diverge in defaults or
 * filtering criteria — and is cheap given the catalog's 60-night cap. Unify
 * later if the surfaces converge on identical detection inputs.
 *
 * @module hooks/useBreathingEpisodeCatalog
 */

import { useEffect, useRef, useState } from 'react';

import type { BreathingEpisode, PeriodicBreathingResult } from '@/analysis/breathing';
import { getDB } from '@/services/storage/getDB';
import { OPFSService } from '@/services/storage/OPFSService';
import { createWorker, type WrappedWorker } from '@/services/workers/createWorker';
import type { AnalysisWorkerAPI } from '@/services/workers/analysis.worker';
import { formatDate } from '@/utils/formatDate';
import type { Event as TherapyEvent, Session } from '@/types';

import { toDeviceEventFlags } from './useBreathingEpisodes';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Maximum nights computed per mount to guard against runaway worker load. */
export const DEFAULT_CATALOG_NIGHT_CAP = 60;

/** One catalog row — an episode joined to the night it came from. */
export interface CatalogEpisode {
  readonly sessionId: string;
  readonly nightDate: string;
  readonly nightStartMs: number;
  readonly episode: BreathingEpisode;
}

/** Result returned by {@link useBreathingEpisodeCatalog}. */
export interface UseBreathingEpisodeCatalogResult {
  /** Catalog rows, sorted by descending confidence. */
  readonly episodes: readonly CatalogEpisode[];
  /** Nights successfully analyzed so far. */
  readonly nightsComputed: number;
  /** Total nights in scope (may exceed `nightsComputed` while loading or after cap). */
  readonly nightsTotal: number;
  /** Whether the cap was hit and some nights were skipped. */
  readonly capped: boolean;
  /** True while detection is running. */
  readonly loading: boolean;
  /** Human-readable error message, or `null` on success. */
  readonly error: string | null;
}

/** Options accepted by {@link useBreathingEpisodeCatalog}. */
export interface UseBreathingEpisodeCatalogOptions {
  /** Date range to enumerate sessions over. */
  readonly dateRange: { readonly start: Date; readonly end: Date };
  /** Cap the number of nights analyzed in a single mount. */
  readonly maxNights?: number;
  /** Set to `false` to defer execution (e.g. while the view is hidden). */
  readonly enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Module-level caches + worker factory (testable seams)
// ---------------------------------------------------------------------------

const catalogCache = new Map<string, PeriodicBreathingResult>();

type CatalogWorker = Pick<AnalysisWorkerAPI, 'detectPeriodicBreathing'>;
type WorkerFactory = () => WrappedWorker<CatalogWorker>;

let workerFactory: WorkerFactory = () =>
  createWorker<CatalogWorker>(
    () =>
      new Worker(new URL('../services/workers/analysis.worker.ts', import.meta.url), {
        type: 'module',
        name: 'breathing-catalog',
      }),
    { name: 'breathing-catalog' },
  );

let sharedWorker: WrappedWorker<CatalogWorker> | null = null;

function getWorker(): WrappedWorker<CatalogWorker> {
  if (!sharedWorker) sharedWorker = workerFactory();
  return sharedWorker;
}

/** @internal Testing seam — replace the worker factory with a stub. */
export function _setCatalogWorkerFactoryForTesting(factory: (() => unknown) | null): void {
  sharedWorker?.dispose();
  sharedWorker = null;
  if (factory) workerFactory = factory as WorkerFactory;
  catalogCache.clear();
}

/** @internal Testing seam — clear the per-session catalog cache. */
export function _clearCatalogCacheForTesting(): void {
  catalogCache.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findChannel(
  manifest: { channels: readonly { name: string }[] },
  needles: readonly string[],
): string | null {
  const byLower = new Map(manifest.channels.map((c) => [c.name.toLowerCase(), c.name]));
  for (const n of needles) {
    const hit = byLower.get(n.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

async function detectOne(
  sessionId: string,
  events: readonly TherapyEvent[],
  sessionStartMs: number,
  opfs: OPFSService,
): Promise<PeriodicBreathingResult> {
  const cached = catalogCache.get(sessionId);
  if (cached) return cached;

  const manifest = await opfs.readManifest(sessionId);
  const minuteVentName = findChannel(manifest, ['MinuteVent', 'minuteVent', 'minute_vent']);
  const flowName = findChannel(manifest, ['Flow', 'FlowRate', 'Flow Rate']);
  const leakName = findChannel(manifest, ['Leak', 'LeakRate']);

  const channelName = minuteVentName ?? flowName;
  if (!channelName) {
    const empty: PeriodicBreathingResult = {
      episodes: [],
      recordHours: 0,
      sessionCriterionMet: false,
    };
    catalogCache.set(sessionId, empty);
    return empty;
  }
  const descriptor = manifest.channels.find((c) => c.name === channelName);
  if (!descriptor) {
    const empty: PeriodicBreathingResult = {
      episodes: [],
      recordHours: 0,
      sessionCriterionMet: false,
    };
    catalogCache.set(sessionId, empty);
    return empty;
  }

  const [signal, leakSignal] = await Promise.all([
    opfs.readChannel(sessionId, channelName),
    leakName ? opfs.readChannel(sessionId, leakName) : Promise.resolve(null),
  ]);

  const result = await getWorker().proxy.detectPeriodicBreathing({
    ...(channelName === minuteVentName ? { minuteVent: signal } : { flow: signal }),
    sampleRateHz: descriptor.sampleRate,
    startMs: sessionStartMs,
    eventFlags: toDeviceEventFlags(events),
    ...(leakSignal ? { leak: leakSignal } : {}),
  });
  catalogCache.set(sessionId, result);
  return result;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBreathingEpisodeCatalog(
  options: UseBreathingEpisodeCatalogOptions,
): UseBreathingEpisodeCatalogResult {
  const { dateRange, maxNights = DEFAULT_CATALOG_NIGHT_CAP, enabled = true } = options;
  const startStr = formatDate(dateRange.start);
  const endStr = formatDate(dateRange.end);

  const [state, setState] = useState<UseBreathingEpisodeCatalogResult>({
    episodes: [],
    nightsComputed: 0,
    nightsTotal: 0,
    capped: false,
    loading: true,
    error: null,
  });

  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState({
        episodes: [],
        nightsComputed: 0,
        nightsTotal: 0,
        capped: false,
        loading: false,
        error: null,
      });
      return;
    }

    if (!OPFSService.isSupported()) {
      setState({
        episodes: [],
        nightsComputed: 0,
        nightsTotal: 0,
        capped: false,
        loading: false,
        error: 'OPFS is not supported in this browser; breathing detection unavailable.',
      });
      return;
    }

    const token = { cancelled: false };
    if (cancelRef.current) cancelRef.current.cancelled = true;
    cancelRef.current = token;

    setState({
      episodes: [],
      nightsComputed: 0,
      nightsTotal: 0,
      capped: false,
      loading: true,
      error: null,
    });

    (async () => {
      try {
        const db = await getDB();
        const sessions: Session[] = await db.getSessionsByDateRange(startStr, endStr);
        // Sort oldest-first so the user sees the earliest matches stream in first.
        const sorted = [...sessions].sort((a, b) => a.startTime.localeCompare(b.startTime));
        const inScope = sorted.slice(0, maxNights);
        const capped = sorted.length > inScope.length;
        if (token.cancelled) return;
        setState((prev) => ({ ...prev, nightsTotal: sorted.length, capped }));

        const opfs = new OPFSService();
        await opfs.initialize();

        const collected: CatalogEpisode[] = [];
        for (let i = 0; i < inScope.length; i++) {
          if (token.cancelled) return;
          const session = inScope[i];
          if (!session) continue;
          try {
            const events = await db.getEventsBySessionId(session.id);
            const startMs = new Date(session.startTime).getTime();
            const result = await detectOne(session.id, events, startMs, opfs);
            for (const ep of result.episodes) {
              collected.push({
                sessionId: session.id,
                nightDate: session.date,
                nightStartMs: startMs,
                episode: ep,
              });
            }
            if (token.cancelled) return;
            const snapshot = [...collected].sort(
              (a, b) => b.episode.confidence - a.episode.confidence,
            );
            setState((prev) => ({
              ...prev,
              episodes: snapshot,
              nightsComputed: i + 1,
            }));
          } catch {
            // Per-night failures are non-fatal — surface as 0 episodes for that
            // night and continue. The user can still see the rest of the range.
            if (token.cancelled) return;
            setState((prev) => ({ ...prev, nightsComputed: i + 1 }));
          }
        }

        if (token.cancelled) return;
        setState((prev) => ({ ...prev, loading: false }));
      } catch (err) {
        if (token.cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to enumerate sessions',
        }));
      }
    })();

    return () => {
      token.cancelled = true;
    };
  }, [startStr, endStr, maxNights, enabled]);

  return state;
}
