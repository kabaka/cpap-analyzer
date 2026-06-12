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

  describe('isSavedQuery validator (refuse malformed blobs)', () => {
    /**
     * Persisted blobs cross a trust boundary (localStorage can be edited by
     * anyone with DevTools or by a buggy older build), so the validator must
     * refuse anything that doesn't match the SavedQuery shape exactly. Loading
     * a malformed blob and returning it as a "valid" SavedQuery would crash
     * the UI later (e.g. URLSearchParams over non-string param values, or a
     * `requiresField` outside the literal union mis-disabling examples).
     */
    function loadWith(raw: unknown): ReturnType<typeof loadSavedQueries> {
      storage.setItem(SAVED_QUERIES_STORAGE_KEY, JSON.stringify(raw));
      return loadSavedQueries(storage);
    }

    it('drops entries whose params is not a plain string→string record', () => {
      // Non-string param value.
      expect(loadWith([{ id: 'a', name: 'x', params: { types: 12 } }])).toEqual([]);
      // params is an array, not an object.
      expect(loadWith([{ id: 'a', name: 'x', params: ['ObstructiveApnea'] }])).toEqual([]);
      // params is null.
      expect(loadWith([{ id: 'a', name: 'x', params: null }])).toEqual([]);
      // params is a scalar.
      expect(loadWith([{ id: 'a', name: 'x', params: 5 }])).toEqual([]);
    });

    it('drops entries with a requiresField outside the literal union', () => {
      expect(
        loadWith([
          { id: 'a', name: 'x', params: { types: 'ObstructiveApnea' }, requiresField: 'flow' },
        ]),
      ).toEqual([]);
      expect(loadWith([{ id: 'a', name: 'x', params: {}, requiresField: 42 }])).toEqual([]);
    });

    it('drops entries with a non-boolean example flag', () => {
      expect(loadWith([{ id: 'a', name: 'x', params: {}, example: 'yes' }])).toEqual([]);
    });

    it('keeps a well-formed entry alongside dropped malformed siblings', () => {
      const loaded = loadWith([
        { id: 'good', name: 'ok', params: { types: 'ObstructiveApnea' } },
        { id: 'bad', name: 'x', params: { types: 12 } },
        { id: 'good-with-req', name: 'spo2', params: {}, requiresField: 'spo2' },
      ]);
      expect(loaded.map((q) => q.id)).toEqual(['good', 'good-with-req']);
    });

    it('refuses non-object/array entries (defensive: arrays-of-anything)', () => {
      expect(loadWith([null, 5, 'string', ['a']])).toEqual([]);
    });
  });
});
