/**
 * Analysis types for statistical and clinical computations.
 *
 * These types define the inputs, outputs, and metadata for the various
 * analysis pipelines supported by the CPAP Analyzer plugin system.
 */

/** Date range specified as ISO date strings (YYYY-MM-DD). */
export interface DateRange {
  readonly start: string;
  readonly end: string;
}

/**
 * Input parameters for an analysis computation.
 *
 * Specifies the analysis type, date range, and any additional parameters
 * required by the specific analysis algorithm.
 */
export interface AnalysisInput {
  /** Analysis identifier (e.g., "stl-decomposition", "correlation-matrix"). */
  readonly type: string;
  /** Temporal scope for the analysis. */
  readonly dateRange: DateRange;
  /** Algorithm-specific configuration parameters. */
  readonly parameters: Record<string, unknown>;
  /** Optional machine filter. */
  readonly machineIds?: string[];
  /** Optional subset of session IDs to analyze. */
  readonly sessionIds?: string[];
}

/**
 * Metadata about a completed analysis computation.
 *
 * Contains timing, versioning, and data-quality information
 * produced alongside the analysis results.
 */
export interface AnalysisMetadata {
  /** ISO 8601 timestamp when the analysis was computed. */
  readonly computedAt: string;
  /** Wall-clock computation time in milliseconds. */
  readonly computationTimeMs: number;
  /** Cache version number for invalidation. */
  readonly cacheVersion: number;
  /** Number of observations used in the analysis. */
  readonly sampleSize: number;
  /** Data quality warnings encountered during computation. */
  readonly warnings: string[];
  /** Statistical assumptions made by the algorithm. */
  readonly assumptions: string[];
}

/**
 * Result of a completed analysis computation.
 *
 * Contains the analysis type, date range, computed results, and metadata.
 */
export interface AnalysisOutput {
  /** Analysis identifier matching the input type. */
  readonly type: string;
  /** Temporal scope that was analyzed. */
  readonly dateRange: DateRange;
  /** Computed results; structure depends on the analysis type. */
  readonly results: unknown;
  /** Computation metadata. */
  readonly metadata: AnalysisMetadata;
}

/**
 * Cached analysis result stored in IndexedDB.
 *
 * Combines analysis output with storage metadata for efficient
 * cache lookup and invalidation.
 */
export interface AnalysisResult {
  /** UUID v4 identifier. */
  readonly id: string;
  /** Analysis identifier (e.g., "stl-decomposition", "correlation-matrix"). */
  readonly analysisType: string;
  /** Date range that was analyzed. */
  readonly dateRange: {
    readonly start: string;
    readonly end: string;
  };
  /** Hash of the date range for efficient cache lookup. */
  readonly dateRangeHash: string;
  /** Analysis configuration parameters. */
  readonly parameters: Record<string, unknown>;
  /** Structured results (type varies by analysis). */
  readonly results: unknown;
  /** ISO 8601 timestamp when the analysis was computed. */
  readonly computedAt: string;
  /** Cache version number; increment to invalidate on algorithm changes. */
  readonly cacheVersion: number;
  /** Machine IDs included in this analysis. */
  readonly machineIds: string[];
}
