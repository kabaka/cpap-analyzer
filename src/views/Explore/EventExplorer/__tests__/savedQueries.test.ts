import { describe, it, expect, beforeEach } from 'vitest';
import { emptyQuery } from '../queryEngine';
import {
  EXAMPLE_QUERIES,
  SAVED_QUERIES_STORAGE_KEY,
  createSavedQuery,
  loadSavedQueries,
  persistSavedQueries,
  savedQueryToEventQuery,
} from '../savedQueries';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('savedQueries', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('persists and reloads user queries', () => {
    const q = createSavedQuery('My long events', {
      ...emptyQuery(),
      duration: { min: 30, max: null },
    });
    persistSavedQueries([q], storage);
    const loaded = loadSavedQueries(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.name).toBe('My long events');
    expect(loaded[0]?.params.dur).toBe('30-');
  });

  it('returns an empty list when storage is empty or malformed', () => {
    expect(loadSavedQueries(storage)).toEqual([]);
    storage.setItem(SAVED_QUERIES_STORAGE_KEY, 'not json');
    expect(loadSavedQueries(storage)).toEqual([]);
  });

  it('exposes example queries with a low-SpO2 example flagged requiresField', () => {
    const lowSpo2 = EXAMPLE_QUERIES.find((q) => q.id === 'example:low-spo2');
    expect(lowSpo2?.requiresField).toBe('spo2');
  });

  it('converts an example back into a usable query', () => {
    const long = EXAMPLE_QUERIES.find((q) => q.id === 'example:long-obstructive');
    expect(long).toBeDefined();
    const eq = savedQueryToEventQuery(long!);
    expect([...eq.types]).toEqual(['ObstructiveApnea']);
    expect(eq.duration).toEqual({ min: 30, max: null });
  });
});
