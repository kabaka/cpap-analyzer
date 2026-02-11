import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheService } from '@/services/storage/CacheService';
import type { AnalysisOutput } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOutput(overrides: Partial<AnalysisOutput> = {}): AnalysisOutput {
  return {
    type: 'descriptive',
    dateRange: { start: '2026-01-01', end: '2026-01-31' },
    results: { mean: 4.2 },
    metadata: {
      computedAt: '2026-02-01T10:00:00.000Z',
      computationTimeMs: 100,
      cacheVersion: 1,
      sampleSize: 30,
      warnings: [],
      assumptions: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService();
  });

  // -----------------------------------------------------------------------
  // Hit / Miss
  // -----------------------------------------------------------------------

  describe('cache hit and miss', () => {
    it('should return null on cache miss', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('should return the value on cache hit', () => {
      const output = makeOutput();
      cache.set('key-1', output);
      const result = cache.get('key-1');
      expect(result).toEqual(output);
    });

    it('should report has() correctly for existing and non-existing keys', () => {
      cache.set('k', makeOutput());
      expect(cache.has('k')).toBe(true);
      expect(cache.has('missing')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Key generation
  // -----------------------------------------------------------------------

  describe('key generation', () => {
    it('should generate a key from analysis type and date range hash', () => {
      const key = cache.generateKey('descriptive', 'abc123');
      expect(key).toBe('descriptive::abc123');
    });

    it('should generate different keys for different types', () => {
      const k1 = cache.generateKey('descriptive', 'hash');
      const k2 = cache.generateKey('timeseries', 'hash');
      expect(k1).not.toBe(k2);
    });

    it('should generate different keys for different hashes', () => {
      const k1 = cache.generateKey('descriptive', 'hash1');
      const k2 = cache.generateKey('descriptive', 'hash2');
      expect(k1).not.toBe(k2);
    });
  });

  // -----------------------------------------------------------------------
  // LRU eviction
  // -----------------------------------------------------------------------

  describe('LRU eviction', () => {
    it('should evict the least-recently-used entry when at capacity', () => {
      const small = new CacheService(3);
      small.set('a', makeOutput());
      small.set('b', makeOutput());
      small.set('c', makeOutput());
      // a is the oldest; inserting d should evict a
      small.set('d', makeOutput());

      expect(small.has('a')).toBe(false);
      expect(small.has('b')).toBe(true);
      expect(small.has('c')).toBe(true);
      expect(small.has('d')).toBe(true);
      expect(small.size).toBe(3);
    });

    it('should promote accessed entries to most-recently-used', () => {
      const small = new CacheService(3);
      small.set('a', makeOutput());
      small.set('b', makeOutput());
      small.set('c', makeOutput());
      // Access 'a' to promote it
      small.get('a');
      // Now 'b' is the LRU; inserting 'd' should evict 'b'
      small.set('d', makeOutput());

      expect(small.has('a')).toBe(true);
      expect(small.has('b')).toBe(false);
      expect(small.has('c')).toBe(true);
      expect(small.has('d')).toBe(true);
    });

    it('should enforce capacity of at least 1', () => {
      const tiny = new CacheService(0);
      tiny.set('a', makeOutput());
      expect(tiny.size).toBe(1);
      expect(tiny.capacity).toBe(1);
    });

    it('should replace value for existing key without increasing size', () => {
      const small = new CacheService(2);
      const oldVal = makeOutput({ type: 'descriptive' });
      const newVal = makeOutput({ type: 'timeseries' });
      small.set('same', oldVal);
      small.set('same', newVal);
      expect(small.size).toBe(1);
      const cached = small.get('same');
      if (!cached) throw new Error('expected cached value');
      expect(cached.type).toBe('timeseries');
    });
  });

  // -----------------------------------------------------------------------
  // TTL expiry
  // -----------------------------------------------------------------------

  describe('TTL expiry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterAll(() => {
      vi.useRealTimers();
    });

    it('should return value before TTL expires', () => {
      const output = makeOutput();
      cache.set('ttl-key', output, { ttlMs: 5000 });
      vi.advanceTimersByTime(4999);
      expect(cache.get('ttl-key')).toEqual(output);
    });

    it('should return null after TTL expires', () => {
      cache.set('ttl-key', makeOutput(), { ttlMs: 5000 });
      vi.advanceTimersByTime(5001);
      expect(cache.get('ttl-key')).toBeNull();
    });

    it('should remove expired entries via has()', () => {
      cache.set('ttl-key', makeOutput(), { ttlMs: 1000 });
      vi.advanceTimersByTime(1001);
      expect(cache.has('ttl-key')).toBe(false);
    });

    it('should evict expired entries via evictExpired()', () => {
      cache.set('a', makeOutput(), { ttlMs: 1000 });
      cache.set('b', makeOutput(), { ttlMs: 5000 });
      cache.set('c', makeOutput()); // no TTL
      vi.advanceTimersByTime(2000);

      const evicted = cache.evictExpired();
      expect(evicted).toBe(1);
      expect(cache.size).toBe(2);
    });

    // Cleanup after this block
    afterEach(() => {
      vi.useRealTimers();
    });
  });

  // -----------------------------------------------------------------------
  // Invalidation
  // -----------------------------------------------------------------------

  describe('invalidation', () => {
    it('should invalidate a single entry by key', () => {
      cache.set('k', makeOutput());
      const removed = cache.invalidate('k');
      expect(removed).toBe(true);
      expect(cache.get('k')).toBeNull();
    });

    it('should return false when invalidating non-existent key', () => {
      expect(cache.invalidate('no-such-key')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Invalidation by date range overlap
  // -----------------------------------------------------------------------

  describe('invalidateByDateRange', () => {
    it('should remove entries whose date range overlaps', () => {
      cache.set('a', makeOutput(), {
        dateRange: { start: '2026-01-01', end: '2026-01-15' },
      });
      cache.set('b', makeOutput(), {
        dateRange: { start: '2026-01-16', end: '2026-01-31' },
      });
      cache.set('c', makeOutput(), {
        dateRange: { start: '2026-02-01', end: '2026-02-28' },
      });

      const count = cache.invalidateByDateRange('2026-01-10', '2026-01-20');
      // a (01-01 to 01-15) overlaps 01-10..01-20 → removed
      // b (01-16 to 01-31) overlaps 01-10..01-20 → removed
      // c (02-01 to 02-28) does not overlap → kept
      expect(count).toBe(2);
      expect(cache.size).toBe(1);
    });

    it('should not remove entries without a date range', () => {
      cache.set('no-range', makeOutput());
      const count = cache.invalidateByDateRange('2026-01-01', '2026-12-31');
      expect(count).toBe(0);
      expect(cache.size).toBe(1);
    });

    it('should handle non-overlapping ranges', () => {
      cache.set('before', makeOutput(), {
        dateRange: { start: '2025-12-01', end: '2025-12-31' },
      });
      cache.set('after', makeOutput(), {
        dateRange: { start: '2026-03-01', end: '2026-03-31' },
      });

      const count = cache.invalidateByDateRange('2026-01-01', '2026-02-28');
      expect(count).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Invalidation by type
  // -----------------------------------------------------------------------

  describe('invalidateByType', () => {
    it('should remove all entries of a specific analysis type', () => {
      cache.set('descriptive::h1', makeOutput());
      cache.set('descriptive::h2', makeOutput());
      cache.set('timeseries::h1', makeOutput());

      const count = cache.invalidateByType('descriptive');
      expect(count).toBe(2);
      expect(cache.size).toBe(1);
    });

    it('should return 0 when no entries match the type', () => {
      cache.set('descriptive::h1', makeOutput());
      const count = cache.invalidateByType('correlation');
      expect(count).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Clear all
  // -----------------------------------------------------------------------

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('a', makeOutput());
      cache.set('b', makeOutput());
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Size tracking
  // -----------------------------------------------------------------------

  describe('size tracking', () => {
    it('should report correct size', () => {
      expect(cache.size).toBe(0);
      cache.set('a', makeOutput());
      expect(cache.size).toBe(1);
      cache.set('b', makeOutput());
      expect(cache.size).toBe(2);
      cache.invalidate('a');
      expect(cache.size).toBe(1);
    });

    it('should report capacity', () => {
      expect(cache.capacity).toBe(100);
      const small = new CacheService(5);
      expect(small.capacity).toBe(5);
    });

    it('should list all keys', () => {
      cache.set('x', makeOutput());
      cache.set('y', makeOutput());
      const keys = cache.keys();
      expect(keys).toContain('x');
      expect(keys).toContain('y');
      expect(keys).toHaveLength(2);
    });
  });
});

// afterAll to restore timers if any test leaked
afterAll(() => {
  vi.useRealTimers();
});
