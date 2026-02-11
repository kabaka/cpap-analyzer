/**
 * React hooks for loading session details, events, and signal data.
 *
 * - {@link useSessionDetail} — Fetches a session and its nightly aggregate from IndexedDB.
 * - {@link useEventData} — Fetches therapy events for a session from IndexedDB.
 * - {@link useSignalData} — Streams signal data from OPFS and applies LTTB downsampling
 *   via a Web Worker for viewport-appropriate rendering.
 *
 * @module hooks/useSignalData
 */

import { useState, useEffect, useRef } from 'react';

import { getDB } from '@/services/storage/getDB';
import { OPFSService } from '@/services/storage/OPFSService';
import { createWorker } from '@/services/workers/createWorker';
import type { WrappedWorker } from '@/services/workers/createWorker';
import type { DownsampleWorkerAPI } from '@/services/workers/downsample.worker';
import type { Event, NightlyAggregate, Session } from '@/types';

// ── useSessionDetail ─────────────────────────────────────────────

/** Return type for {@link useSessionDetail}. */
export interface UseSessionDetailResult {
  session: Session | null;
  aggregate: NightlyAggregate | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch a session and its associated nightly aggregate from IndexedDB.
 *
 * @param sessionId - Session ID to look up, or `undefined` to skip.
 * @returns Session, aggregate, loading state, and error.
 */
export function useSessionDetail(sessionId: string | undefined): UseSessionDetailResult {
  const [session, setSession] = useState<Session | null>(null);
  const [aggregate, setAggregate] = useState<NightlyAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setAggregate(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const sid = sessionId;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const db = await getDB();
        const [sess, agg] = await Promise.all([
          db.getSession(sid),
          db.getNightlyAggregateBySessionId(sid),
        ]);

        if (!cancelled) {
          setSession(sess);
          setAggregate(agg);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load session details');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return { session, aggregate, loading, error };
}

// ── useEventData ─────────────────────────────────────────────────

/** Return type for {@link useEventData}. */
export interface UseEventDataResult {
  events: Event[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetch all therapy events for a session from IndexedDB.
 *
 * @param sessionId - Session ID to query, or `undefined` to skip.
 * @returns Events array, loading state, and error.
 */
export function useEventData(sessionId: string | undefined): UseEventDataResult {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const sid = sessionId;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const db = await getDB();
        const result = await db.getEventsBySessionId(sid);

        if (!cancelled) {
          setEvents(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load events');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return { events, loading, error };
}

// ── useSignalData ────────────────────────────────────────────────

/** Parameters accepted by {@link useSignalData}. */
export interface UseSignalDataParams {
  /** Session ID to load signal data for, or `undefined` to skip. */
  sessionId: string | undefined;
  /** Signal channel name (e.g., "Flow", "MaskPress"). */
  channel: string;
  /** Start of the requested time range (epoch ms, inclusive). */
  startTime: number;
  /** End of the requested time range (epoch ms, exclusive). */
  endTime: number;
  /** Viewport width in pixels — determines target downsample point count. */
  viewportWidth: number;
}

/** Return type for {@link useSignalData}. */
export interface UseSignalDataResult {
  /** Downsampled (or raw) signal data, or `null` while loading / on error. */
  data: Float32Array | null;
  /** Effective sample rate of the returned data in Hz. */
  sampleRate: number;
  /** Whether the data is currently being fetched/downsampled. */
  loading: boolean;
  /** Error message, or `null` on success. */
  error: string | null;
}

/**
 * Stream signal data for a session/channel/time range from OPFS and
 * apply LTTB downsampling via a Web Worker for the given viewport width.
 *
 * If raw data length exceeds `viewportWidth * 2`, the data is downsampled
 * to `viewportWidth * 2` points using LTTB to keep rendering efficient
 * while preserving visual shape.
 *
 * @param params - Signal data query parameters.
 * @returns Signal data, effective sample rate, loading state, and error.
 */
export function useSignalData(params: UseSignalDataParams): UseSignalDataResult {
  const { sessionId, channel, startTime, endTime, viewportWidth } = params;

  const [data, setData] = useState<Float32Array | null>(null);
  const [sampleRate, setSampleRate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Persist the worker across renders; dispose on unmount.
  const workerRef = useRef<WrappedWorker<DownsampleWorkerAPI> | null>(null);

  // Cache the OPFS service across effect runs to avoid repeated instantiation.
  const opfsRef = useRef<OPFSService | null>(null);

  useEffect(() => {
    return () => {
      workerRef.current?.dispose();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sessionId || !channel || endTime <= startTime || viewportWidth <= 0) {
      setData(null);
      setSampleRate(0);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const sid = sessionId;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        // ── Check OPFS support ────────────────────────────────
        if (!OPFSService.isSupported()) {
          throw new Error(
            'Origin Private File System is not supported in this browser. Signal data cannot be loaded.',
          );
        }

        // ── Read raw signal data from OPFS ────────────────────
        if (!opfsRef.current) {
          opfsRef.current = new OPFSService();
          await opfsRef.current.initialize();
        }
        const opfs = opfsRef.current;

        const [rawData, manifest] = await Promise.all([
          opfs.readTimeRange(sid, channel, startTime, endTime),
          opfs.readManifest(sid),
        ]);

        if (cancelled) return;

        // Determine channel sample rate from the manifest
        const channelDescriptor = manifest.channels.find((ch) => ch.name === channel);
        const rawSampleRate = channelDescriptor?.sampleRate ?? 0;

        // ── Downsample if needed ──────────────────────────────
        const targetPoints = viewportWidth * 2;

        if (rawData.length <= targetPoints) {
          // Data is small enough — use as-is
          if (!cancelled) {
            setData(rawData);
            setSampleRate(rawSampleRate);
          }
        } else {
          // Lazy-create the downsample worker
          if (!workerRef.current) {
            workerRef.current = createWorker<DownsampleWorkerAPI>(
              () =>
                new Worker(new URL('../services/workers/downsample.worker.ts', import.meta.url), {
                  type: 'module',
                  name: 'downsample',
                }),
              { timeoutMs: 30_000 },
            );
          }

          const downsampled = await workerRef.current.proxy.lttb(rawData, targetPoints);

          if (!cancelled) {
            // Compute effective sample rate from downsampled count
            const durationMs = endTime - startTime;
            const effectiveRate = durationMs > 0 ? (downsampled.length / durationMs) * 1000 : 0;

            setData(downsampled);
            setSampleRate(effectiveRate);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load signal data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, channel, startTime, endTime, viewportWidth]);

  return { data, sampleRate, loading, error };
}
