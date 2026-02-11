/**
 * Error types for EDF parsing failures.
 *
 * All parser errors extend `EDFParseError` which provides a machine-readable
 * error code and optional context for debugging.
 */

/** Error codes for EDF parsing failures. */
export type EDFParseErrorCode =
  | 'INVALID_VERSION'
  | 'HEADER_TOO_SHORT'
  | 'HEADER_SIZE_MISMATCH'
  | 'INVALID_NUM_SIGNALS'
  | 'INVALID_NUM_RECORDS'
  | 'INVALID_RECORD_DURATION'
  | 'BUFFER_TOO_SHORT'
  | 'INVALID_DATE'
  | 'INVALID_TIME'
  | 'DIGITAL_RANGE_ZERO'
  | 'DATA_TRUNCATED'
  | 'ANNOTATION_PARSE_ERROR';

/** Additional context attached to an EDF parse error. */
export interface EDFParseErrorContext {
  readonly [key: string]: string | number | boolean | undefined;
}

/**
 * Structured error for EDF parsing failures.
 *
 * Extends the native `Error` class with a machine-readable code
 * and optional context object for debugging.
 */
export class EDFParseError extends Error {
  /** Machine-readable error code. */
  readonly code: EDFParseErrorCode;

  /** Additional context for debugging. */
  readonly context?: EDFParseErrorContext;

  constructor(code: EDFParseErrorCode, message: string, context?: EDFParseErrorContext) {
    super(message);
    this.name = 'EDFParseError';
    this.code = code;
    this.context = context;
  }
}
