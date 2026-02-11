/**
 * Signal data types for high-frequency time-series storage.
 *
 * Raw signal data (flow, pressure, SpO₂, etc.) is stored as Float32Arrays
 * in the Origin Private File System (OPFS). These types describe the
 * metadata needed to locate and interpret stored signal chunks.
 */

/**
 * Metadata for a chunk of time-series signal data stored in OPFS.
 *
 * The actual sample data is stored as a contiguous Float32Array in OPFS;
 * this record provides the indexing information to locate and decode it.
 */
export interface SignalChunk {
  readonly sessionId: string;
  /** Normalized channel label (e.g., "Flow", "MaskPressure"). */
  readonly channel: string;
  /** Byte offset in the OPFS file where this chunk begins. */
  readonly startOffset: number;
  /** Number of samples in this chunk. */
  readonly sampleCount: number;
  /** Sample rate in Hz. */
  readonly sampleRate: number;
}
