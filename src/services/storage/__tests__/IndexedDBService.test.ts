import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexedDBService, StorageError } from '@/services/storage/IndexedDBService';
import type {
  StoredNightlyAggregate,
  StoredAnalysisResult,
  StoredImportRecord,
} from '@/services/storage/IndexedDBService';
import type { Session, Event, IntegrationData } from '@/types';
import { ErrorCategory, ErrorSeverity } from '@/types';

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

function makeAggregate(overrides: Partial<StoredNightlyAggregate> = {}): StoredNightlyAggregate {
  return {
    id: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    date: '2026-01-15',
    machineId: 'SN12345678',
    ahi: 3.2,
    ahiObstructive: 1.5,
    ahiCentral: 0.5,
    ahiMixed: 0,
    ahiHypopnea: 1.0,
    ahiRera: 0.2,
    eventCount: 5,
    eventsByType: {
      obstructive: 2,
      central: 1,
      mixed: 0,
      hypopnea: 1,
      rera: 1,
      flowLimitation: 0,
      largeLeak: 0,
      periodicBreathing: 0,
    },
    pressureMean: 10,
    pressureMedian: 10,
    pressureP95: 12,
    pressureMax: 14,
    epapMedian: null,
    ipapMedian: null,
    pressureSupport: null,
    leakMedian: 4,
    leakP95: 12,
    leakMax: 18,
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

function makeAnalysisResult(overrides: Partial<StoredAnalysisResult> = {}): StoredAnalysisResult {
  return {
    id: crypto.randomUUID(),
    analysisType: 'descriptive',
    dateRange: { start: '2026-01-01', end: '2026-01-31' },
    dateRangeHash: 'hash-abc',
    parameters: {},
    results: { mean: 4.2 },
    computedAt: '2026-02-01T10:00:00.000Z',
    cacheVersion: 1,
    machineIds: ['SN12345678'],
    ...overrides,
  };
}

function makeImportRecord(overrides: Partial<StoredImportRecord> = {}): StoredImportRecord {
  return {
    id: crypto.randomUUID(),
    machineId: 'SN12345678',
    machineModel: 'AirSense 10 AutoSet',
    importedAt: '2026-01-16T08:00:00.000Z',
    dateRangeStart: '2026-01-15',
    dateRangeEnd: '2026-01-15',
    sessionsImported: 1,
    sessionsSkipped: 0,
    sessionsErrored: 0,
    sourceHash: 'importhash',
    durationSeconds: 2.5,
    errors: [],
    ...overrides,
  };
}

function makeIntegrationData(overrides: Partial<IntegrationData> = {}): IntegrationData {
  return {
    id: crypto.randomUUID(),
    source: 'fitbit',
    date: '2026-01-15',
    data: { steps: 8000 },
    importedAt: '2026-01-16T09:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IndexedDBService', () => {
  let db: IndexedDBService;

  beforeEach(async () => {
    db = new IndexedDBService(`test-db-${crypto.randomUUID()}`);
    await db.open();
  });

  afterEach(async () => {
    await db.destroy();
  });

  // -----------------------------------------------------------------------
  // Schema
  // -----------------------------------------------------------------------

  describe('database initialization', () => {
    it('should create all 7 object stores', async () => {
      const raw = (db as unknown as { db: IDBDatabase }).db;
      const storeNames = Array.from(raw.objectStoreNames);
      expect(storeNames).toContain('sessions');
      expect(storeNames).toContain('nightly_aggregates');
      expect(storeNames).toContain('events');
      expect(storeNames).toContain('analysis_results');
      expect(storeNames).toContain('settings');
      expect(storeNames).toContain('import_history');
      expect(storeNames).toContain('integration_data');
      expect(storeNames).toHaveLength(7);
    });

    it('should create correct indexes on sessions store', async () => {
      const raw = (db as unknown as { db: IDBDatabase }).db;
      const tx = raw.transaction('sessions', 'readonly');
      const store = tx.objectStore('sessions');
      const indexNames = Array.from(store.indexNames);
      expect(indexNames).toContain('date');
      expect(indexNames).toContain('machineId');
      expect(indexNames).toContain('machineId_date');
    });

    it('should create correct indexes on events store', async () => {
      const raw = (db as unknown as { db: IDBDatabase }).db;
      const tx = raw.transaction('events', 'readonly');
      const store = tx.objectStore('events');
      const indexNames = Array.from(store.indexNames);
      expect(indexNames).toContain('sessionId');
      expect(indexNames).toContain('sessionId_startTime');
      expect(indexNames).toContain('type');
    });

    it('should create correct indexes on analysis_results store', async () => {
      const raw = (db as unknown as { db: IDBDatabase }).db;
      const tx = raw.transaction('analysis_results', 'readonly');
      const store = tx.objectStore('analysis_results');
      const indexNames = Array.from(store.indexNames);
      expect(indexNames).toContain('type');
      expect(indexNames).toContain('type_dateRangeHash');
      expect(indexNames).toContain('computedAt');
    });

    it('should be idempotent when open() is called twice', async () => {
      await db.open(); // already open
      const session = makeSession();
      await db.addSession(session);
      const retrieved = await db.getSession(session.id);
      expect(retrieved).toEqual(session);
    });
  });

  // -----------------------------------------------------------------------
  // Sessions CRUD
  // -----------------------------------------------------------------------

  describe('sessions', () => {
    it('should create and read a session by ID', async () => {
      const session = makeSession();
      await db.addSession(session);
      const result = await db.getSession(session.id);
      expect(result).toEqual(session);
    });

    it('should return null for non-existent session', async () => {
      const result = await db.getSession('nonexistent');
      expect(result).toBeNull();
    });

    it('should retrieve sessions by date range', async () => {
      const s1 = makeSession({ date: '2026-01-10' });
      const s2 = makeSession({ date: '2026-01-15' });
      const s3 = makeSession({ date: '2026-01-20' });
      await db.addSession(s1);
      await db.addSession(s2);
      await db.addSession(s3);

      const results = await db.getSessionsByDateRange('2026-01-12', '2026-01-18');
      expect(results).toHaveLength(1);
      const first = results[0];
      if (!first) throw new Error('expected first result');
      expect(first.id).toBe(s2.id);
    });

    it('should include boundary dates in range queries', async () => {
      const s1 = makeSession({ date: '2026-01-10' });
      const s2 = makeSession({ date: '2026-01-20' });
      await db.addSession(s1);
      await db.addSession(s2);

      const results = await db.getSessionsByDateRange('2026-01-10', '2026-01-20');
      expect(results).toHaveLength(2);
    });

    it('should update an existing session', async () => {
      const session = makeSession();
      await db.addSession(session);
      const updated = { ...session, usageMinutes: 500 };
      await db.updateSession(updated);
      const result = await db.getSession(session.id);
      if (!result) throw new Error('expected session');
      expect(result.usageMinutes).toBe(500);
    });

    it('should delete a session by ID', async () => {
      const session = makeSession();
      await db.addSession(session);
      await db.deleteSession(session.id);
      const result = await db.getSession(session.id);
      expect(result).toBeNull();
    });

    it('should retrieve sessions by machineId', async () => {
      const s1 = makeSession({ machineId: 'M1' });
      const s2 = makeSession({ machineId: 'M2' });
      await db.addSession(s1);
      await db.addSession(s2);

      const results = await db.getSessionsByMachineId('M1');
      expect(results).toHaveLength(1);
      const first = results[0];
      if (!first) throw new Error('expected first result');
      expect(first.machineId).toBe('M1');
    });

    it('should count sessions by date range', async () => {
      await db.addSession(makeSession({ date: '2026-01-10' }));
      await db.addSession(makeSession({ date: '2026-01-15' }));
      await db.addSession(makeSession({ date: '2026-01-20' }));

      const count = await db.countSessionsByDateRange('2026-01-10', '2026-01-15');
      expect(count).toBe(2);
    });

    it('should retrieve all sessions', async () => {
      await db.addSession(makeSession({ date: '2026-01-15' }));
      await db.addSession(makeSession({ date: '2026-01-16' }));
      const all = await db.getAllSessions();
      expect(all).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Nightly Aggregates
  // -----------------------------------------------------------------------

  describe('nightly aggregates', () => {
    it('should create and read an aggregate by ID', async () => {
      const agg = makeAggregate();
      await db.addNightlyAggregate(agg);
      const result = await db.getNightlyAggregate(agg.id);
      expect(result).toEqual(agg);
    });

    it('should retrieve aggregate by sessionId', async () => {
      const sessionId = crypto.randomUUID();
      const agg = makeAggregate({ sessionId });
      await db.addNightlyAggregate(agg);

      const result = await db.getNightlyAggregateBySessionId(sessionId);
      if (!result) throw new Error('expected aggregate');
      expect(result.sessionId).toBe(sessionId);
    });

    it('should return null for non-existent aggregate session', async () => {
      const result = await db.getNightlyAggregateBySessionId('nonexistent');
      expect(result).toBeNull();
    });

    it('should retrieve aggregates by date range', async () => {
      const a1 = makeAggregate({ date: '2026-01-10' });
      const a2 = makeAggregate({ date: '2026-01-15' });
      const a3 = makeAggregate({ date: '2026-01-20' });
      await db.addNightlyAggregate(a1);
      await db.addNightlyAggregate(a2);
      await db.addNightlyAggregate(a3);

      const results = await db.getNightlyAggregatesByDateRange('2026-01-12', '2026-01-18');
      expect(results).toHaveLength(1);
      const first = results[0];
      if (!first) throw new Error('expected first result');
      expect(first.id).toBe(a2.id);
    });

    it('should update a nightly aggregate', async () => {
      const agg = makeAggregate();
      await db.addNightlyAggregate(agg);
      const updated = { ...agg, ahi: 7.5 };
      await db.updateNightlyAggregate(updated);
      const result = await db.getNightlyAggregate(agg.id);
      if (!result) throw new Error('expected aggregate');
      expect(result.ahi).toBe(7.5);
    });

    it('should delete a nightly aggregate', async () => {
      const agg = makeAggregate();
      await db.addNightlyAggregate(agg);
      await db.deleteNightlyAggregate(agg.id);
      const result = await db.getNightlyAggregate(agg.id);
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Therapy Events
  // -----------------------------------------------------------------------

  describe('therapy events', () => {
    it('should add and retrieve a single event', async () => {
      const event = makeEvent();
      await db.addEvent(event);
      const result = await db.getEvent(event.id);
      expect(result).toEqual(event);
    });

    it('should return null for non-existent event', async () => {
      const result = await db.getEvent('nonexistent');
      expect(result).toBeNull();
    });

    it('should batch-add multiple events', async () => {
      const sessionId = crypto.randomUUID();
      const events = [
        makeEvent({ sessionId, timestamp: 100 }),
        makeEvent({ sessionId, timestamp: 200 }),
        makeEvent({ sessionId, timestamp: 300 }),
      ];
      await db.addEvents(events);

      const results = await db.getEventsBySessionId(sessionId);
      expect(results).toHaveLength(3);
    });

    it('should handle empty batch gracefully', async () => {
      await db.addEvents([]);
      // Should not throw
    });

    it('should retrieve events by sessionId', async () => {
      const sid1 = crypto.randomUUID();
      const sid2 = crypto.randomUUID();
      await db.addEvent(makeEvent({ sessionId: sid1 }));
      await db.addEvent(makeEvent({ sessionId: sid2 }));

      const results = await db.getEventsBySessionId(sid1);
      expect(results).toHaveLength(1);
      const first = results[0];
      if (!first) throw new Error('expected first result');
      expect(first.sessionId).toBe(sid1);
    });

    it('should retrieve events by type', async () => {
      await db.addEvent(makeEvent({ type: 'ObstructiveApnea' }));
      await db.addEvent(makeEvent({ type: 'Hypopnea' }));
      await db.addEvent(makeEvent({ type: 'ObstructiveApnea' }));

      const results = await db.getEventsByType('ObstructiveApnea');
      expect(results).toHaveLength(2);
    });

    it('should delete events by sessionId', async () => {
      const sid = crypto.randomUUID();
      await db.addEvents([makeEvent({ sessionId: sid }), makeEvent({ sessionId: sid })]);

      await db.deleteEventsBySessionId(sid);
      const results = await db.getEventsBySessionId(sid);
      expect(results).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Analysis Results
  // -----------------------------------------------------------------------

  describe('analysis results', () => {
    it('should add and retrieve an analysis result by ID', async () => {
      const ar = makeAnalysisResult();
      await db.addAnalysisResult(ar);
      const result = await db.getAnalysisResult(ar.id);
      expect(result).toEqual(ar);
    });

    it('should retrieve analysis results by type', async () => {
      await db.addAnalysisResult(
        makeAnalysisResult({ analysisType: 'descriptive', dateRangeHash: 'hash-1' }),
      );
      await db.addAnalysisResult(
        makeAnalysisResult({ analysisType: 'timeseries', dateRangeHash: 'hash-2' }),
      );
      await db.addAnalysisResult(
        makeAnalysisResult({ analysisType: 'descriptive', dateRangeHash: 'hash-3' }),
      );

      const results = await db.getAnalysisResultsByType('descriptive');
      expect(results).toHaveLength(2);
    });

    it('should look up by type + dateRangeHash (cache hit)', async () => {
      const ar = makeAnalysisResult({
        analysisType: 'correlation',
        dateRangeHash: 'unique-hash-1',
      });
      await db.addAnalysisResult(ar);

      const result = await db.getAnalysisResultByTypeAndHash('correlation', 'unique-hash-1');
      if (!result) throw new Error('expected analysis result');
      expect(result.id).toBe(ar.id);
    });

    it('should return null for cache miss on type + dateRangeHash', async () => {
      const result = await db.getAnalysisResultByTypeAndHash('descriptive', 'nonexistent-hash');
      expect(result).toBeNull();
    });

    it('should update an analysis result', async () => {
      const ar = makeAnalysisResult();
      await db.addAnalysisResult(ar);
      const updated = { ...ar, results: { mean: 9.9 } };
      await db.updateAnalysisResult(updated);
      const result = await db.getAnalysisResult(ar.id);
      if (!result) throw new Error('expected analysis result');
      expect(result.results).toEqual({ mean: 9.9 });
    });

    it('should delete an analysis result', async () => {
      const ar = makeAnalysisResult();
      await db.addAnalysisResult(ar);
      await db.deleteAnalysisResult(ar.id);
      const result = await db.getAnalysisResult(ar.id);
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Settings
  // -----------------------------------------------------------------------

  describe('settings', () => {
    it('should put and get a setting', async () => {
      await db.putSetting('theme', 'dark');
      const result = await db.getSetting('theme');
      if (!result) throw new Error('expected setting');
      expect(result.value).toBe('dark');
    });

    it('should return null for non-existent setting', async () => {
      const result = await db.getSetting('nonexistent');
      expect(result).toBeNull();
    });

    it('should overwrite existing setting on put', async () => {
      await db.putSetting('theme', 'dark');
      await db.putSetting('theme', 'light');
      const result = await db.getSetting('theme');
      if (!result) throw new Error('expected setting');
      expect(result.value).toBe('light');
    });

    it('should delete a setting', async () => {
      await db.putSetting('theme', 'dark');
      await db.deleteSetting('theme');
      const result = await db.getSetting('theme');
      expect(result).toBeNull();
    });

    it('should retrieve all settings', async () => {
      await db.putSetting('theme', 'dark');
      await db.putSetting('units', 'metric');
      const all = await db.getAllSettings();
      expect(all).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Import History
  // -----------------------------------------------------------------------

  describe('import history', () => {
    it('should create and read an import record', async () => {
      const record = makeImportRecord();
      await db.addImportRecord(record);
      const result = await db.getImportRecord(record.id);
      expect(result).toEqual(record);
    });

    it('should list all import records', async () => {
      await db.addImportRecord(makeImportRecord());
      await db.addImportRecord(makeImportRecord());
      const all = await db.getAllImportRecords();
      expect(all).toHaveLength(2);
    });

    it('should list import records by machineId', async () => {
      await db.addImportRecord(makeImportRecord({ machineId: 'M1' }));
      await db.addImportRecord(makeImportRecord({ machineId: 'M2' }));

      const results = await db.getImportRecordsByMachineId('M1');
      expect(results).toHaveLength(1);
      const first = results[0];
      if (!first) throw new Error('expected first result');
      expect(first.machineId).toBe('M1');
    });

    it('should delete an import record', async () => {
      const record = makeImportRecord();
      await db.addImportRecord(record);
      await db.deleteImportRecord(record.id);
      const result = await db.getImportRecord(record.id);
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Integration Data
  // -----------------------------------------------------------------------

  describe('integration data', () => {
    it('should create and read integration data by ID', async () => {
      const data = makeIntegrationData();
      await db.addIntegrationData(data);
      const result = await db.getIntegrationData(data.id);
      expect(result).toEqual(data);
    });

    it('should retrieve integration data by source', async () => {
      await db.addIntegrationData(makeIntegrationData({ source: 'fitbit' }));
      await db.addIntegrationData(makeIntegrationData({ source: 'weather' }));

      const results = await db.getIntegrationDataBySource('fitbit');
      expect(results).toHaveLength(1);
      const first = results[0];
      if (!first) throw new Error('expected first result');
      expect(first.source).toBe('fitbit');
    });

    it('should retrieve integration data by date range', async () => {
      await db.addIntegrationData(makeIntegrationData({ date: '2026-01-10' }));
      await db.addIntegrationData(makeIntegrationData({ date: '2026-01-15' }));
      await db.addIntegrationData(makeIntegrationData({ date: '2026-01-20' }));

      const results = await db.getIntegrationDataByDateRange('2026-01-12', '2026-01-18');
      expect(results).toHaveLength(1);
    });

    it('should look up by source + date', async () => {
      const data = makeIntegrationData({ source: 'fitbit', date: '2026-01-15' });
      await db.addIntegrationData(data);

      const result = await db.getIntegrationDataBySourceAndDate('fitbit', '2026-01-15');
      if (!result) throw new Error('expected integration data');
      expect(result.id).toBe(data.id);
    });

    it('should update integration data', async () => {
      const data = makeIntegrationData();
      await db.addIntegrationData(data);
      const updated = { ...data, data: { steps: 12000 } };
      await db.updateIntegrationData(updated);
      const result = await db.getIntegrationData(data.id);
      if (!result) throw new Error('expected integration data');
      expect(result.data).toEqual({ steps: 12000 });
    });

    it('should delete integration data', async () => {
      const data = makeIntegrationData();
      await db.addIntegrationData(data);
      await db.deleteIntegrationData(data.id);
      const result = await db.getIntegrationData(data.id);
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('should throw StorageError when database is not opened', async () => {
      const uninit = new IndexedDBService('never-opened');
      await expect(uninit.getSession('x')).rejects.toThrow(StorageError);
    });

    it('should throw StorageError with correct code', async () => {
      const uninit = new IndexedDBService('never-opened');
      try {
        await uninit.getSession('x');
      } catch (e) {
        expect(e).toBeInstanceOf(StorageError);
        expect((e as StorageError).code).toBe('STORAGE_READ_FAILED');
      }
    });

    it('should convert to CPAPError', async () => {
      const err = new StorageError('TEST_CODE', 'test message', {
        severity: ErrorSeverity.WARNING,
      });
      const cpapErr = err.toCPAPError();
      expect(cpapErr.id).toBe('TEST_CODE');
      expect(cpapErr.category).toBe(ErrorCategory.SYSTEM);
      expect(cpapErr.severity).toBe(ErrorSeverity.WARNING);
    });
  });

  // -----------------------------------------------------------------------
  // Transaction isolation
  // -----------------------------------------------------------------------

  describe('transaction isolation', () => {
    it('should allow concurrent reads without conflict', async () => {
      const s1 = makeSession({ id: 'read-1', date: '2026-02-01' });
      const s2 = makeSession({ id: 'read-2', date: '2026-02-02' });
      await db.addSession(s1);
      await db.addSession(s2);

      const [r1, r2] = await Promise.all([db.getSession('read-1'), db.getSession('read-2')]);
      if (!r1 || !r2) throw new Error('expected both sessions');
      expect(r1.id).toBe('read-1');
      expect(r2.id).toBe('read-2');
    });
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  describe('lifecycle', () => {
    it('should close and prevent further operations', async () => {
      db.close();
      await expect(db.getSession('x')).rejects.toThrow(StorageError);
    });

    it('should destroy the database', async () => {
      const session = makeSession();
      await db.addSession(session);
      await db.destroy();

      // Re-open should start fresh
      const fresh = new IndexedDBService((db as unknown as { dbName: string }).dbName);
      await fresh.open();
      const result = await fresh.getSession(session.id);
      expect(result).toBeNull();
      await fresh.destroy();
    });
  });
});
