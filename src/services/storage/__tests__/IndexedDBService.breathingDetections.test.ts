/**
 * Tests for the `breathing_detections` store methods on
 * {@link IndexedDBService} (IndexedDB v4 — ADR 0023). Covers the per-night
 * PB/CSR detection cache: put/get round-trips, the bulk single-transaction read,
 * version-eviction + per-session sweeps, and the extended cascade delete.
 *
 * Storage spec: docs/analysis/breathing-detection-cache-storage.md §§5, 6, 9.
 * Uses `fake-indexeddb` exactly as the sibling `IndexedDBService.test.ts` does
 * (auto-installed by `src/test/setup.ts`).
 *
 * @module services/storage/__tests__/IndexedDBService.breathingDetections
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IndexedDBService } from '@/services/storage/IndexedDBService';
import type { StoredBreathingDetection } from '@/services/storage/IndexedDBService';
import {
  BREATHING_ALGO_VERSION,
  DEFAULT_BREATHING_PARAM_HASH,
  makeBreathingDetectionId,
} from '@/analysis/breathing';
import type { BreathingEpisode } from '@/analysis/breathing';
import type { Session, Event } from '@/types';

// ---------------------------------------------------------------------------
// Helpers — minimal valid domain objects
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: crypto.randomUUID(),
    date: '2026-01-15',
    startTime: '2026-01-15T22:30:00.000Z',
    endTime: '2026-01-16T06:30:00.000Z',
    durationMinutes: 480,
    usageMinutes: 420,
    machineId: 'SN12345678',
    machineModel: 'AirSense 10 AutoSet',
    machineType: 'apap',
    firmwareVersion: '3.0.2',
    sourceHash: 'abc123',
    channels: [],
    signalChunkIds: [],
    hasOximetry: false,
    deleted: false,
    importedAt: '2026-01-16T08:00:00.000Z',
    machineSettings: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    type: 'ObstructiveApnea',
    timestamp: Date.now(),
    duration: 15,
    severity: null,
    pressure: null,
    epap: null,
    ipap: null,
    leak: null,
    spo2: null,
    clusterId: null,
    ...overrides,
  };
}

function makeEpisode(overrides: Partial<BreathingEpisode> = {}): BreathingEpisode {
  return {
    id: 'ep-1',
    type: 'PeriodicBreathing',
    startMs: 1_000,
    endMs: 60_000,
    durationSec: 59,
    confidence: 0.7,
    cycleLengthSec: 55,
    modulationDepth: 0.5,
    cycleCount: 4,
    belowDeviceThreshold: false,
    ...overrides,
  };
}

/**
 * Build a detection record. `algoVersion`/`paramHash` default to the current
 * values and the `id` is derived from `(sessionId, algoVersion, paramHash)` so
 * tests that change the version/params get a key that matches.
 */
function makeDetection(
  overrides: Partial<StoredBreathingDetection> = {},
): StoredBreathingDetection {
  const sessionId = overrides.sessionId ?? crypto.randomUUID();
  const algoVersion = overrides.algoVersion ?? BREATHING_ALGO_VERSION;
  const paramHash = overrides.paramHash ?? DEFAULT_BREATHING_PARAM_HASH;
  return {
    id: overrides.id ?? makeBreathingDetectionId(sessionId, algoVersion, paramHash),
    sessionId,
    date: '2026-01-15',
    algoVersion,
    paramHash,
    episodes: [makeEpisode()],
    recordHours: 8,
    sessionCriterionMet: false,
    computedAt: '2026-01-16T08:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IndexedDBService — breathing_detections store', () => {
  let db: IndexedDBService;

  beforeEach(async () => {
    db = new IndexedDBService(`test-bd-${crypto.randomUUID()}`);
    await db.open();
  });

  afterEach(async () => {
    await db.destroy();
  });

  // -----------------------------------------------------------------------
  // Schema
  // -----------------------------------------------------------------------

  describe('schema', () => {
    it('creates the breathing_detections store with its four indexes', () => {
      const raw = db.getRawDatabase();
      expect(Array.from(raw.objectStoreNames)).toContain('breathing_detections');

      const tx = raw.transaction('breathing_detections', 'readonly');
      const store = tx.objectStore('breathing_detections');
      const indexNames = Array.from(store.indexNames);
      expect(indexNames).toContain('sessionId');
      expect(indexNames).toContain('date');
      expect(indexNames).toContain('algoVersion');
      expect(indexNames).toContain('computedAt');
      expect(store.keyPath).toBe('id');
    });

    it('declares all index keyPaths non-unique (a session has many version rows)', () => {
      const raw = db.getRawDatabase();
      const store = raw
        .transaction('breathing_detections', 'readonly')
        .objectStore('breathing_detections');
      expect(store.index('sessionId').unique).toBe(false);
      expect(store.index('date').unique).toBe(false);
      expect(store.index('algoVersion').unique).toBe(false);
      expect(store.index('computedAt').unique).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // put / get
  // -----------------------------------------------------------------------

  describe('putBreathingDetection / getBreathingDetectionById', () => {
    it('round-trips a record by composite id', async () => {
      const record = makeDetection();
      await db.putBreathingDetection(record);

      const result = await db.getBreathingDetectionById(record.id);
      expect(result).toEqual(record);
    });

    it('returns null on a miss', async () => {
      const result = await db.getBreathingDetectionById('does-not-exist::1::deadbeef');
      expect(result).toBeNull();
    });

    it('upserts in place on the same id (no duplicate row)', async () => {
      const sessionId = crypto.randomUUID();
      const first = makeDetection({ sessionId, recordHours: 8, episodes: [makeEpisode()] });
      await db.putBreathingDetection(first);

      // Re-detect under the same identity → overwrite in place.
      const second = makeDetection({
        sessionId,
        id: first.id,
        recordHours: 6,
        episodes: [makeEpisode({ id: 'ep-2', confidence: 0.9 })],
        computedAt: '2026-02-01T00:00:00.000Z',
      });
      await db.putBreathingDetection(second);

      const result = await db.getBreathingDetectionById(first.id);
      expect(result).toEqual(second);

      // Exactly one row exists for the session — the put overwrote, not appended.
      const all = await db.getBreathingDetectionsBySessionId(sessionId);
      expect(all).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // getBreathingDetectionsBySessionId
  // -----------------------------------------------------------------------

  describe('getBreathingDetectionsBySessionId', () => {
    it('returns every version row for the session', async () => {
      const sessionId = crypto.randomUUID();
      const v1 = makeDetection({ sessionId, algoVersion: 1 });
      const v2 = makeDetection({ sessionId, algoVersion: 2 });
      const other = makeDetection({ sessionId: crypto.randomUUID(), algoVersion: 1 });
      await db.putBreathingDetection(v1);
      await db.putBreathingDetection(v2);
      await db.putBreathingDetection(other);

      const results = await db.getBreathingDetectionsBySessionId(sessionId);
      expect(results).toHaveLength(2);
      expect(new Set(results.map((r) => r.id))).toEqual(new Set([v1.id, v2.id]));
    });

    it('returns an empty array for an unknown session', async () => {
      expect(await db.getBreathingDetectionsBySessionId('nope')).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // getBreathingDetectionsByDateRange
  // -----------------------------------------------------------------------

  describe('getBreathingDetectionsByDateRange', () => {
    it('returns rows within inclusive bounds only', async () => {
      await db.putBreathingDetection(makeDetection({ date: '2026-01-10' }));
      const inLow = makeDetection({ date: '2026-01-12' });
      const inHigh = makeDetection({ date: '2026-01-18' });
      await db.putBreathingDetection(inLow);
      await db.putBreathingDetection(inHigh);
      await db.putBreathingDetection(makeDetection({ date: '2026-01-20' }));

      const results = await db.getBreathingDetectionsByDateRange('2026-01-12', '2026-01-18');
      expect(new Set(results.map((r) => r.id))).toEqual(new Set([inLow.id, inHigh.id]));
    });

    it('includes the boundary dates', async () => {
      const lo = makeDetection({ date: '2026-01-10' });
      const hi = makeDetection({ date: '2026-01-20' });
      await db.putBreathingDetection(lo);
      await db.putBreathingDetection(hi);

      const results = await db.getBreathingDetectionsByDateRange('2026-01-10', '2026-01-20');
      expect(results).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // getBreathingDetectionsByIds (bulk, single transaction)
  // -----------------------------------------------------------------------

  describe('getBreathingDetectionsByIds', () => {
    it('returns a Map keyed by sessionId', async () => {
      const s1 = crypto.randomUUID();
      const s2 = crypto.randomUUID();
      const r1 = makeDetection({ sessionId: s1 });
      const r2 = makeDetection({ sessionId: s2 });
      await db.putBreathingDetection(r1);
      await db.putBreathingDetection(r2);

      const map = await db.getBreathingDetectionsByIds([r1.id, r2.id]);
      expect(map.size).toBe(2);
      expect(map.get(s1)).toEqual(r1);
      expect(map.get(s2)).toEqual(r2);
    });

    it('omits misses from the map', async () => {
      const s1 = crypto.randomUUID();
      const r1 = makeDetection({ sessionId: s1 });
      await db.putBreathingDetection(r1);

      const missingId = makeBreathingDetectionId(
        crypto.randomUUID(),
        BREATHING_ALGO_VERSION,
        DEFAULT_BREATHING_PARAM_HASH,
      );
      const map = await db.getBreathingDetectionsByIds([r1.id, missingId]);
      expect(map.size).toBe(1);
      expect(map.get(s1)).toEqual(r1);
    });

    it('resolves the whole batch in one transaction (many ids)', async () => {
      const records = Array.from({ length: 25 }, () => makeDetection());
      for (const record of records) await db.putBreathingDetection(record);

      const map = await db.getBreathingDetectionsByIds(records.map((r) => r.id));
      expect(map.size).toBe(25);
      for (const record of records) {
        expect(map.get(record.sessionId)).toEqual(record);
      }
    });

    it('returns an empty map for empty input (fast path, no transaction)', async () => {
      const map = await db.getBreathingDetectionsByIds([]);
      expect(map.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // deleteBreathingDetectionsByAlgoVersionNotMatching
  // -----------------------------------------------------------------------

  describe('deleteBreathingDetectionsByAlgoVersionNotMatching', () => {
    it('removes only non-current rows and returns the count', async () => {
      const current1 = makeDetection({ algoVersion: 2 });
      const current2 = makeDetection({ algoVersion: 2 });
      const stale1 = makeDetection({ algoVersion: 1 });
      const stale2 = makeDetection({ algoVersion: 0 });
      await db.putBreathingDetection(current1);
      await db.putBreathingDetection(current2);
      await db.putBreathingDetection(stale1);
      await db.putBreathingDetection(stale2);

      const removed = await db.deleteBreathingDetectionsByAlgoVersionNotMatching(2);
      expect(removed).toBe(2);

      // The two current rows survive; the two stale rows are gone.
      expect(await db.getBreathingDetectionById(current1.id)).toEqual(current1);
      expect(await db.getBreathingDetectionById(current2.id)).toEqual(current2);
      expect(await db.getBreathingDetectionById(stale1.id)).toBeNull();
      expect(await db.getBreathingDetectionById(stale2.id)).toBeNull();
    });

    it('is idempotent — a second sweep removes nothing', async () => {
      await db.putBreathingDetection(makeDetection({ algoVersion: 2 }));
      await db.putBreathingDetection(makeDetection({ algoVersion: 1 }));

      expect(await db.deleteBreathingDetectionsByAlgoVersionNotMatching(2)).toBe(1);
      expect(await db.deleteBreathingDetectionsByAlgoVersionNotMatching(2)).toBe(0);
    });

    it('returns 0 on an empty store', async () => {
      expect(await db.deleteBreathingDetectionsByAlgoVersionNotMatching(1)).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // deleteBreathingDetectionsBySessionId
  // -----------------------------------------------------------------------

  describe('deleteBreathingDetectionsBySessionId', () => {
    it('deletes all versions for the session and returns the count', async () => {
      const sessionId = crypto.randomUUID();
      await db.putBreathingDetection(makeDetection({ sessionId, algoVersion: 1 }));
      await db.putBreathingDetection(makeDetection({ sessionId, algoVersion: 2 }));
      const keep = makeDetection({ sessionId: crypto.randomUUID() });
      await db.putBreathingDetection(keep);

      const removed = await db.deleteBreathingDetectionsBySessionId(sessionId);
      expect(removed).toBe(2);
      expect(await db.getBreathingDetectionsBySessionId(sessionId)).toEqual([]);
      // Unrelated session untouched.
      expect(await db.getBreathingDetectionById(keep.id)).toEqual(keep);
    });

    it('returns 0 for a session with no rows', async () => {
      expect(await db.deleteBreathingDetectionsBySessionId('unknown')).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Cascade delete (storage spec §5.1)
  // -----------------------------------------------------------------------

  describe('deleteSessionCascade — breathing rows', () => {
    it('removes ALL breathing rows for the session alongside session/aggregate/events', async () => {
      const session = makeSession();
      const events = [makeEvent({ sessionId: session.id }), makeEvent({ sessionId: session.id })];
      await db.addSessionWithRelated(
        session,
        // a minimal aggregate is required by addSessionWithRelated
        {
          id: crypto.randomUUID(),
          sessionId: session.id,
          date: session.date,
          machineId: session.machineId,
          ahi: 0,
          ahiObstructive: 0,
          ahiCentral: 0,
          ahiMixed: 0,
          ahiHypopnea: 0,
          ahiRera: 0,
          eventCount: 0,
          eventsByType: {
            obstructive: 0,
            central: 0,
            mixed: 0,
            hypopnea: 0,
            rera: 0,
            flowLimitation: 0,
            largeLeak: 0,
            periodicBreathing: 0,
          },
          pressureMean: 0,
          pressureMedian: 0,
          pressureP95: 0,
          pressureMax: 0,
          epapMedian: null,
          ipapMedian: null,
          pressureSupport: null,
          leakMedian: 0,
          leakP95: 0,
          leakMax: 0,
          leakDurationMinutes: 0,
          tidalVolumeMean: null,
          tidalVolumeMedian: null,
          minuteVentMean: null,
          respRateMean: null,
          respRateMedian: null,
          spo2Mean: null,
          spo2Median: null,
          spo2Min: null,
          spo2Below90Percent: null,
          oxygenDesaturationIndex: null,
          usageHours: 7,
          maskOnTimeMinutes: 420,
          complianceStatus: 'compliant',
          configuredMinPressure: null,
          configuredMaxPressure: null,
          eprLevel: null,
          notes: '',
          tags: [],
        },
        events,
      );

      // Two cached detection versions for this night.
      await db.putBreathingDetection(makeDetection({ sessionId: session.id, algoVersion: 1 }));
      await db.putBreathingDetection(makeDetection({ sessionId: session.id, algoVersion: 2 }));
      // A detection for an unrelated session that must survive.
      const survivor = makeDetection({ sessionId: crypto.randomUUID() });
      await db.putBreathingDetection(survivor);

      await db.deleteSessionCascade(session.id);

      expect(await db.getSession(session.id)).toBeNull();
      expect(await db.getNightlyAggregateBySessionId(session.id)).toBeNull();
      expect(await db.getEventsBySessionId(session.id)).toHaveLength(0);
      // Both breathing versions are gone.
      expect(await db.getBreathingDetectionsBySessionId(session.id)).toEqual([]);
      // The unrelated detection is untouched.
      expect(await db.getBreathingDetectionById(survivor.id)).toEqual(survivor);
    });

    it('is a no-op for breathing rows of an unknown session', async () => {
      const keep = makeDetection();
      await db.putBreathingDetection(keep);

      await expect(db.deleteSessionCascade('unknown-session')).resolves.toBeUndefined();
      expect(await db.getBreathingDetectionById(keep.id)).toEqual(keep);
    });
  });
});
