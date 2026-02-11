/**
 * In-memory LRU cache for analysis results.
 *
 * Provides fast key-value lookup of previously computed analysis outputs
 * with configurable maximum capacity, TTL support, and date-range-aware
 * invalidation for when new data is imported.
 *
 * Keys are generated from analysis type + date range hash.
 */

import type { AnalysisOutput, DateRange } from '@/types';

// ---------------------------------------------------------------------------
// Cache entry
// ---------------------------------------------------------------------------

interface CacheEntry {
  readonly value: AnalysisOutput;
  /** Absolute expiry timestamp (ms since epoch), or `null` for no expiry. */
  readonly expiresAt: number | null;
  /** Date range associated with this result, used for overlap-based invalidation. */
  readonly dateRange: DateRange | null;
}

// ---------------------------------------------------------------------------
// CacheService
// ---------------------------------------------------------------------------

/** Default maximum number of cache entries. */
const DEFAULT_MAX_ENTRIES = 100;

export class CacheService {
  /**
   * Internal Map maintains insertion order; we exploit this for LRU eviction.
   * Most recently accessed entries are at the end (re-inserted on access).
   */
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;

  /**
   * @param maxEntries - Maximum number of entries before LRU eviction kicks in.
   */
  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  // -----------------------------------------------------------------------
  // Key generation
  // -----------------------------------------------------------------------

  /**
   * Generate a cache key from the analysis type and a date-range hash.
   *
   * This key is used for both the in-memory cache and the IndexedDB
   * compound index lookup.
   *
   * @param type          - Analysis type identifier.
   * @param dateRangeHash - Pre-computed hash of the date range.
   * @returns A cache key string.
   */
  generateKey(type: string, dateRangeHash: string): string {
    return `${type}::${dateRangeHash}`;
  }

  // -----------------------------------------------------------------------
  // Read
  // -----------------------------------------------------------------------

  /**
   * Retrieve a cached analysis result.
   *
   * Returns `null` on cache miss or if the entry has expired.
   * On hit, the entry is promoted to most-recently-used.
   *
   * @param key - Cache key (from `generateKey`).
   */
  get(key: string): AnalysisOutput | null {
    const entry = this.entries.get(key);
    if (!entry) return null;

    // Check TTL
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }

    // Promote to most-recently-used (delete + re-insert moves to end)
    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.value;
  }

  /**
   * Check whether a key exists and is not expired, without promoting it.
   *
   * @param key - Cache key.
   */
  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Write
  // -----------------------------------------------------------------------

  /**
   * Store an analysis result in the cache.
   *
   * If the cache is at capacity, the least-recently-used entry is evicted.
   *
   * @param key       - Cache key (from `generateKey`).
   * @param value     - The analysis output to cache.
   * @param options   - Optional TTL and date range for invalidation.
   */
  set(
    key: string,
    value: AnalysisOutput,
    options?: { ttlMs?: number; dateRange?: DateRange },
  ): void {
    // Remove if already present (resets position)
    this.entries.delete(key);

    // Evict least-recently-used if at capacity
    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(key, {
      value,
      expiresAt: options?.ttlMs ? Date.now() + options.ttlMs : null,
      dateRange: options?.dateRange ?? null,
    });
  }

  // -----------------------------------------------------------------------
  // Invalidation
  // -----------------------------------------------------------------------

  /**
   * Remove a single entry by key.
   *
   * @param key - Cache key.
   * @returns `true` if the entry was present and removed.
   */
  invalidate(key: string): boolean {
    return this.entries.delete(key);
  }

  /**
   * Remove all entries whose date range overlaps the given range.
   *
   * This is triggered when new data is imported — any cached analysis
   * that covers the imported date range is stale and must be recomputed.
   *
   * @param start - Import range start (YYYY-MM-DD, inclusive).
   * @param end   - Import range end (YYYY-MM-DD, inclusive).
   * @returns Number of entries invalidated.
   */
  invalidateByDateRange(start: string, end: string): number {
    let invalidated = 0;

    for (const [key, entry] of this.entries) {
      if (entry.dateRange && this.rangesOverlap(entry.dateRange, start, end)) {
        this.entries.delete(key);
        invalidated++;
      }
    }

    return invalidated;
  }

  /**
   * Remove all entries of a specific analysis type.
   *
   * @param type - Analysis type to invalidate.
   * @returns Number of entries invalidated.
   */
  invalidateByType(type: string): number {
    const prefix = `${type}::`;
    let invalidated = 0;

    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        invalidated++;
      }
    }

    return invalidated;
  }

  /**
   * Remove all expired entries.
   *
   * Can be called periodically to free memory proactively.
   *
   * @returns Number of entries evicted.
   */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.entries.delete(key);
        evicted++;
      }
    }

    return evicted;
  }

  /** Remove all cached entries. */
  clear(): void {
    this.entries.clear();
  }

  // -----------------------------------------------------------------------
  // Inspection
  // -----------------------------------------------------------------------

  /** Current number of entries in the cache. */
  get size(): number {
    return this.entries.size;
  }

  /** Maximum number of entries the cache will hold. */
  get capacity(): number {
    return this.maxEntries;
  }

  /** Get all keys currently in the cache (for debugging/monitoring). */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Check if a stored date range overlaps with the given import range.
   *
   * Two ranges overlap unless one ends before the other starts.
   */
  private rangesOverlap(cached: DateRange, importStart: string, importEnd: string): boolean {
    return cached.start <= importEnd && cached.end >= importStart;
  }
}
