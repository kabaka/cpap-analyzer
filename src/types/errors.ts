/**
 * Error types for structured error handling across the CPAP Analyzer.
 *
 * All application errors are represented as `CPAPError` objects with
 * a category, severity, and recovery information. This enables consistent
 * error display, logging, and recovery behavior throughout the app.
 */

/** Error category taxonomy for CPAP Analyzer. */
export enum ErrorCategory {
  /** User-triggered errors (invalid input, missing data selection). */
  USER = 'USER',
  /** System-level errors (storage quota, browser compatibility, permissions). */
  SYSTEM = 'SYSTEM',
  /** Data integrity errors (corrupted files, parse failures, schema violations). */
  DATA = 'DATA',
  /** Network-related errors (plugin integrations, external API calls only). */
  NETWORK = 'NETWORK',
  /** Web Worker errors (computation failures, timeouts, OOM). */
  WORKER = 'WORKER',
}

/** Severity levels for error presentation and logging. */
export enum ErrorSeverity {
  /** Application cannot continue; requires reload or data re-import. */
  FATAL = 'FATAL',
  /** Operation failed, but application is stable. */
  ERROR = 'ERROR',
  /** Operation completed with caveats. */
  WARNING = 'WARNING',
  /** Non-critical issue that user should be aware of. */
  INFO = 'INFO',
}

/**
 * Base error structure for all CPAP Analyzer errors.
 *
 * Provides consistent metadata for error display, logging, and
 * programmatic recovery decisions.
 */
export interface CPAPError {
  /** Unique error identifier for tracking and logging. */
  readonly id: string;
  /** Error category. */
  readonly category: ErrorCategory;
  /** Severity level. */
  readonly severity: ErrorSeverity;
  /** Short error title (user-facing). */
  readonly title: string;
  /** Detailed error message (user-facing). */
  readonly message: string;
  /** Actionable recovery steps for the user. */
  readonly recoverySteps?: string[];
  /** Technical details for logging and debugging (not shown to users). */
  readonly technicalDetails?: {
    readonly originalError?: Error;
    readonly stack?: string;
    readonly context?: Record<string, unknown>;
  };
  /** Timestamp when the error occurred. */
  readonly timestamp: Date;
  /** Optional retry handler. */
  readonly retry?: () => Promise<void>;
}
