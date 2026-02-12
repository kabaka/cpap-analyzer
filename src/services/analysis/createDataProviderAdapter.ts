/**
 * DataProvider adapter for the AnalysisEngine.
 *
 * Wraps the IndexedDBService singleton to implement the DataProvider
 * interface required by AnalysisEngine. Lazily initialises on first use.
 *
 * @module services/analysis/createDataProviderAdapter
 */

import type { DataProvider } from '@/types/storage';
import type { Event, NightlyAggregate, Session } from '@/types';
import { getDB } from '@/services/storage/getDB';

/**
 * Create a DataProvider backed by IndexedDB.
 *
 * The adapter delegates all calls to the shared IndexedDBService
 * instance and maps its method signatures to the DataProvider contract.
 */
export function createDataProviderAdapter(): DataProvider {
  return {
    async getSessions(range): Promise<Session[]> {
      const db = await getDB();
      return db.getSessionsByDateRange(range.start, range.end);
    },

    async getSession(id): Promise<Session | null> {
      const db = await getDB();
      return db.getSession(id);
    },

    async getNightlyAggregates(range): Promise<NightlyAggregate[]> {
      const db = await getDB();
      return db.getNightlyAggregatesByDateRange(range.start, range.end);
    },

    async getEvents(sessionId): Promise<Event[]> {
      const db = await getDB();
      return db.getEventsBySessionId(sessionId);
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async getSignalData(_sessionId: string, _channel: string): Promise<Float32Array> {
      // Signal data retrieval requires OPFS access; return empty for now.
      // Full OPFS integration is deferred to a future phase.
      return new Float32Array(0);
    },
  };
}
