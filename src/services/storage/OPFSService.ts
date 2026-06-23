/**
 * Origin Private File System (OPFS) service for high-frequency signal data.
 *
 * Stores raw time-series data (flow, pressure, leak, SpO₂) as chunked binary
 * files with JSON manifests. Files are organized by session:
 *
 *   /cpap-analyzer/signals/{sessionId}/
 *     manifest.json
 *     chunk-000.bin
 *     chunk-001.bin
 *     ...
 *   /cpap-analyzer/cache/downsampled/...
 *
 * Binary chunk format: channel-wise contiguous Float32 (all samples for
 * channel 0, then channel 1, etc.). Little-endian, no header.
 *
 * Chunk duration: 5 minutes (300 seconds) fixed.
 *
 * OPFS provides high-throughput binary I/O with lower overhead than IndexedDB
 * for large blobs, and supports efficient chunked/streaming access patterns.
 */

import { MAX_SESSION_SECONDS } from '@/parsers/resmed/assembleChannels';
import { ErrorCategory, ErrorSeverity } from '@/types';

// ---------------------------------------------------------------------------
// Type augmentation — FileSystemDirectoryHandle async iteration
// Available in modern browsers but not in TypeScript DOM lib with ES2020.
// ---------------------------------------------------------------------------

declare global {
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
    keys(): AsyncIterableIterator<string>;
    values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
  }
}

// ---------------------------------------------------------------------------
// Signal manifest types (design §4.2)
// ---------------------------------------------------------------------------

/** Describes one signal channel within a session's stored binary data. */
export interface ChannelDescriptor {
  /** 0-based channel index in binary chunk files. */
  readonly index: number;
  /** Standardized channel name (e.g., "Flow", "MaskPress"). */
  readonly name: string;
  /** Sample rate in Hz. */
  readonly sampleRate: number;
  /** Physical unit of measurement. */
  readonly unit: string;
  /** Data type — always float32. */
  readonly dtype: 'float32';
  /** Physical minimum value. */
  readonly physicalMin: number;
  /** Physical maximum value. */
  readonly physicalMax: number;
}

/** Describes one binary chunk within a session's signal data. */
export interface ChunkDescriptor {
  /** Chunk sequence number (0-based). */
  readonly index: number;
  /** Binary file name (e.g., "chunk-000.bin"). */
  readonly fileName: string;
  /** Chunk start time in epoch milliseconds. */
  readonly startTime: number;
  /** Chunk end time in epoch milliseconds. */
  readonly endTime: number;
  /** Channel name → number of samples in this chunk. */
  readonly samples: Readonly<Record<string, number>>;
  /** Total file size in bytes. */
  readonly byteSize: number;
}

/** Manifest file describing all signal data for a session. */
export interface SignalManifest {
  /** Manifest format version. */
  readonly version: 1;
  /** Session identifier (matches IndexedDB session ID). */
  readonly sessionId: string;
  /** Recording start time in epoch milliseconds. */
  readonly startTime: number;
  /** Recording end time in epoch milliseconds. */
  readonly endTime: number;
  /** Total recording duration in seconds. */
  readonly durationSeconds: number;
  /** Fixed chunk duration in seconds (300 = 5 minutes). */
  readonly chunkDurationSeconds: number;
  /** Channel descriptors. */
  readonly channels: readonly ChannelDescriptor[];
  /** Chunk descriptors (sorted by startTime). */
  readonly chunks: readonly ChunkDescriptor[];
}

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

/** Structured error for OPFS operations. */
export class OPFSError extends Error {
  readonly code: string;
  readonly category: ErrorCategory = ErrorCategory.SYSTEM;
  readonly severity: ErrorSeverity;
  readonly timestamp: Date;
  readonly recoverable: boolean;
  readonly context?: Record<string, unknown>;
  readonly originalCause?: Error;

  constructor(
    code: string,
    message: string,
    options: {
      cause?: unknown;
      recoverable?: boolean;
      severity?: ErrorSeverity;
      context?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = 'OPFSError';
    this.code = code;
    this.severity = options.severity ?? ErrorSeverity.ERROR;
    this.timestamp = new Date();
    this.recoverable = options.recoverable ?? true;
    this.context = options.context;
    if (options.cause instanceof Error) {
      this.originalCause = options.cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Quota estimate result
// ---------------------------------------------------------------------------

/** Result from a storage quota estimation. */
export interface QuotaEstimate {
  /** Currently used storage in bytes. */
  readonly usage: number;
  /** Total quota available in bytes. */
  readonly quota: number;
  /** Percentage of quota used (0–100). */
  readonly percentUsed: number;
}

// ---------------------------------------------------------------------------
// Channel input type (for writeSession)
// ---------------------------------------------------------------------------

/** Input channel data for writing a session to OPFS. */
export interface ChannelInput {
  /** Channel name (e.g., "Flow", "MaskPress"). */
  readonly name: string;
  /** Sample rate in Hz. */
  readonly sampleRate: number;
  /** Physical unit of measurement. */
  readonly unit: string;
  /** Physical minimum value. */
  readonly physicalMin: number;
  /** Physical maximum value. */
  readonly physicalMax: number;
  /** Signal samples in physical units. */
  readonly data: Float32Array;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Root directory name used inside the OPFS root. */
const APP_DIR = 'cpap-analyzer';
const SIGNALS_DIR = 'signals';
const CACHE_DIR = 'cache';
const DOWNSAMPLED_DIR = 'downsampled';

/** Manifest file name within each session directory. */
const MANIFEST_FILE = 'manifest.json';

/** Fixed chunk duration in seconds (design §4.4). */
const CHUNK_DURATION_SECONDS = 300;

/** Bytes per Float32 sample. */
const BYTES_PER_SAMPLE = 4;

/**
 * Maximum number of chunk-file writes a single {@link OPFSService.writeSession}
 * call keeps in flight at once.
 *
 * Chunk files are mutually independent (each is a self-contained slice of one
 * channel-set), so they can be written concurrently — but opening an unbounded
 * number of `FileSystemWritableFileStream`s at once risks file-handle / memory
 * exhaustion on long sessions (a single night is ~96 chunks; a multi-day import
 * is hundreds). This bound caps concurrency so at most this many chunk buffers
 * and writables exist simultaneously, while still overlapping the per-chunk
 * create → write → close latency that dominates OPFS storage cost. The manifest
 * is always written LAST, only after every chunk write has resolved.
 */
const OPFS_CHUNK_WRITE_CONCURRENCY = 8;

// ---------------------------------------------------------------------------
// OPFSService
// ---------------------------------------------------------------------------

export class OPFSService {
  private root: FileSystemDirectoryHandle | null = null;

  /**
   * In-flight initialization promise. Cached so concurrent callers share a
   * single `getDirectory()`/`getDirectoryHandle()` sequence rather than racing
   * to create the root handle. Reset to `null` on failure so a later call can
   * retry from scratch.
   */
  private initPromise: Promise<void> | null = null;

  // -----------------------------------------------------------------------
  // Feature detection
  // -----------------------------------------------------------------------

  /** Check whether the OPFS API is available in the current environment. */
  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      'storage' in navigator &&
      typeof navigator.storage.getDirectory === 'function'
    );
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Initialize the OPFS directory structure.
   *
   * Idempotent and concurrency-safe: if the root handle is already resolved
   * this returns immediately, and concurrent callers share a single in-flight
   * initialization promise rather than racing to create the root handle. On
   * failure the cached promise is cleared so a later call can retry.
   */
  async initialize(): Promise<void> {
    if (this.root) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    try {
      await this.initPromise;
    } catch (error) {
      // Allow a later call to retry after a transient failure.
      this.initPromise = null;
      throw error;
    }
  }

  /** Perform the actual OPFS directory setup. Guarded by {@link initialize}. */
  private async doInitialize(): Promise<void> {
    if (!OPFSService.isSupported()) {
      throw new OPFSError(
        'OPFS_NOT_SUPPORTED',
        'Origin Private File System is not available in this environment.',
        { recoverable: false, severity: ErrorSeverity.FATAL },
      );
    }

    try {
      const opfsRoot = await navigator.storage.getDirectory();
      const appRoot = await opfsRoot.getDirectoryHandle(APP_DIR, { create: true });

      // Ensure standard subdirectory structure exists
      const signalsDir = await appRoot.getDirectoryHandle(SIGNALS_DIR, { create: true });
      const cacheDir = await appRoot.getDirectoryHandle(CACHE_DIR, { create: true });

      // Just ensure directories exist
      void signalsDir;
      await cacheDir.getDirectoryHandle(DOWNSAMPLED_DIR, { create: true });

      // Publish the root handle only after the full structure is in place, so a
      // concurrent caller never observes a partially-initialized service.
      this.root = appRoot;
    } catch (error) {
      throw new OPFSError(
        'OPFS_INIT_FAILED',
        `Failed to initialize OPFS directory structure: ${String(error)}`,
        { cause: error, recoverable: false, severity: ErrorSeverity.FATAL },
      );
    }
  }

  // -----------------------------------------------------------------------
  // Signal data — write session (design §4.1–4.4)
  // -----------------------------------------------------------------------

  /**
   * Write all signal data for a session as chunked binary files with a manifest.
   *
   * Splits the session into fixed-duration (5-minute) chunks. Each chunk file
   * contains channel-wise contiguous Float32 data (all samples for channel 0,
   * then channel 1, etc.).
   *
   * @param sessionId - Session identifier.
   * @param startTime - Recording start time in epoch milliseconds.
   * @param endTime   - Recording end time in epoch milliseconds.
   * @param channels  - Channel data to write.
   * @returns The generated manifest.
   */
  async writeSession(
    sessionId: string,
    startTime: number,
    endTime: number,
    channels: readonly ChannelInput[],
  ): Promise<SignalManifest> {
    try {
      const sessionDir = await this.getSessionDir(sessionId, true);

      const durationSeconds = (endTime - startTime) / 1000;

      // Load-bearing DoS guard. The chunk count below is
      // `ceil(durationSeconds / 300s)` and each chunk drives an async file
      // create + writable + write + close. The window (`startTime`/`endTime`)
      // is derived from segment headers and chained across segments, so a
      // crafted import can declare an arbitrarily long window (millions of
      // chunks → freeze / file-handle / quota exhaustion) even when the
      // assembled channels are tiny or empty. Reject any window that is
      // non-finite, non-positive, or longer than the same plausibility ceiling
      // the channel assembler uses (`MAX_SESSION_SECONDS`, imported from
      // assembleChannels so the two layers can never drift). The throw
      // propagates to ImportService.storeSession, whose compensation rolls back
      // the IDB metadata and any partial OPFS chunks. Context is PHI-free
      // (sessionId + numeric durations only — no wall-clock timestamps).
      if (
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0 ||
        durationSeconds > MAX_SESSION_SECONDS
      ) {
        throw new OPFSError(
          'OPFS_WRITE_FAILED',
          `Refusing to write session "${sessionId}": session window out of bounds ` +
            `(durationSeconds=${durationSeconds}, maxSeconds=${MAX_SESSION_SECONDS}).`,
          { context: { sessionId, durationSeconds, maxSessionSeconds: MAX_SESSION_SECONDS } },
        );
      }

      const chunkCount = Math.max(1, Math.ceil(durationSeconds / CHUNK_DURATION_SECONDS));

      // Defensive dev-time guard: each channel is expected to be window-aligned
      // (one gap-padded series spanning [startTime, endTime]; see
      // assembleChannels). If a channel's sample span is MATERIALLY shorter than
      // the declared window, the chunker would silently truncate the night — the
      // exact multi-segment bug this guard exists to surface. We only WARN (never
      // throw): a genuinely short final segment can legitimately fall a little
      // short, and writing what we have is better than failing the import.
      this.warnIfChannelsUnderspanWindow(channels, durationSeconds);

      // Build channel descriptors
      const channelDescriptors: ChannelDescriptor[] = channels.map((ch, i) => ({
        index: i,
        name: ch.name,
        sampleRate: ch.sampleRate,
        unit: ch.unit,
        dtype: 'float32' as const,
        physicalMin: ch.physicalMin,
        physicalMax: ch.physicalMax,
      }));

      // Write chunks and build chunk descriptors.
      //
      // Each chunk file is independent (a self-contained slice of the channel
      // set) with no ordering dependency on any other chunk, so the writes are
      // issued with BOUNDED concurrency (`OPFS_CHUNK_WRITE_CONCURRENCY`) to
      // overlap the per-chunk create → write → close latency that dominates OPFS
      // storage cost. The manifest is still written strictly LAST, after every
      // chunk write resolves. Descriptors are written into pre-sized slots keyed
      // by chunk index, so the manifest's `chunks[]` order is identical to the
      // old sequential loop regardless of completion order.
      const chunkDescriptors: ChunkDescriptor[] = new Array<ChunkDescriptor>(chunkCount);

      // Prepare one chunk's contiguous buffer + descriptor (pure CPU, no I/O).
      // Kept inside the bounded worker below so at most
      // `OPFS_CHUNK_WRITE_CONCURRENCY` chunk buffers exist at once — preserving
      // the per-session memory profile despite parallel writes.
      const prepareChunk = (
        ci: number,
      ): {
        fileName: string;
        chunkBuffer: Uint8Array<ArrayBuffer>;
        descriptor: ChunkDescriptor;
      } => {
        const chunkStartTime = startTime + ci * CHUNK_DURATION_SECONDS * 1000;
        const chunkEndTime = Math.min(
          startTime + (ci + 1) * CHUNK_DURATION_SECONDS * 1000,
          endTime,
        );
        const chunkDurationSec = (chunkEndTime - chunkStartTime) / 1000;

        const fileName = `chunk-${String(ci).padStart(3, '0')}.bin`;

        // Extract per-channel sample views for this chunk's time window.
        // We keep zero-copy `subarray` VIEWS (no intermediate `.slice()` copy)
        // and copy each view exactly once, directly into the concatenation
        // buffer below — halving the sample-byte copies vs. slice-then-concat.
        const chunkSamples: Record<string, number> = {};
        const channelViews: Float32Array[] = [];
        let totalBytes = 0;

        for (const ch of channels) {
          const chunkOffsetSec = (chunkStartTime - startTime) / 1000;

          const startSample = Math.floor(chunkOffsetSec * ch.sampleRate);
          const sampleCount = Math.min(
            Math.floor(chunkDurationSec * ch.sampleRate),
            Math.max(0, ch.data.length - startSample),
          );
          const endSample = startSample + sampleCount;

          // Guard against out-of-bounds
          const clampedStart = Math.max(0, Math.min(startSample, ch.data.length));
          const clampedEnd = Math.max(clampedStart, Math.min(endSample, ch.data.length));
          const actualCount = clampedEnd - clampedStart;

          chunkSamples[ch.name] = actualCount;

          const view = ch.data.subarray(clampedStart, clampedEnd);
          channelViews.push(view);
          totalBytes += view.byteLength;
        }

        // Concatenate the channel views into a single contiguous chunk buffer.
        const chunkBuffer = new Uint8Array(totalBytes);
        let offset = 0;
        for (const view of channelViews) {
          chunkBuffer.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), offset);
          offset += view.byteLength;
        }

        return {
          fileName,
          chunkBuffer,
          descriptor: {
            index: ci,
            fileName,
            startTime: chunkStartTime,
            endTime: chunkEndTime,
            samples: chunkSamples,
            byteSize: totalBytes,
          },
        };
      };

      // Prepare + write a single chunk file. Records its descriptor in the
      // pre-sized slot at `ci` (index-keyed, so order is completion-independent).
      const writeChunk = async (ci: number): Promise<void> => {
        const { fileName, chunkBuffer, descriptor } = prepareChunk(ci);
        const fileHandle = await sessionDir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        try {
          await writable.write(chunkBuffer);
        } finally {
          await writable.close();
        }
        chunkDescriptors[ci] = descriptor;
      };

      // Bounded-concurrency driver: keep at most
      // `OPFS_CHUNK_WRITE_CONCURRENCY` chunk writes in flight via a shared
      // index cursor consumed by N parallel workers. If ANY chunk write rejects,
      // `Promise.all` propagates the first rejection, which unwinds to
      // `writeSession`'s catch and rejects the whole call exactly as the old
      // sequential loop did — so the caller's IDB-then-OPFS compensation fires.
      let nextChunkIndex = 0;
      const writeWorker = async (): Promise<void> => {
        for (;;) {
          const ci = nextChunkIndex++;
          if (ci >= chunkCount) return;
          await writeChunk(ci);
        }
      };
      const workerCount = Math.min(OPFS_CHUNK_WRITE_CONCURRENCY, chunkCount);
      await Promise.all(Array.from({ length: workerCount }, () => writeWorker()));

      // Build and write manifest
      const manifest: SignalManifest = {
        version: 1,
        sessionId,
        startTime,
        endTime,
        durationSeconds,
        chunkDurationSeconds: CHUNK_DURATION_SECONDS,
        channels: channelDescriptors,
        chunks: chunkDescriptors,
      };

      const manifestHandle = await sessionDir.getFileHandle(MANIFEST_FILE, { create: true });
      const manifestWritable = await manifestHandle.createWritable();
      try {
        await manifestWritable.write(JSON.stringify(manifest, null, 2));
      } finally {
        await manifestWritable.close();
      }

      return manifest;
    } catch (error) {
      if (error instanceof OPFSError) throw error;
      throw new OPFSError(
        'OPFS_WRITE_FAILED',
        `Failed to write session "${sessionId}": ${String(error)}`,
        { cause: error, context: { sessionId, startTime, endTime } },
      );
    }
  }

  /**
   * Dev-time sanity check: warn if any channel spans materially less time than
   * the declared session window.
   *
   * Channels are expected to be window-aligned (one gap-padded series of length
   * ≈ `sampleRate * windowDurationSeconds`; see `assembleChannels`). A channel
   * whose `data.length / sampleRate` is well short of the window means upstream
   * assembly regressed and the chunker is about to truncate the night — the
   * multi-segment truncation bug. We only warn (no throw) so a legitimately
   * short tail does not fail an otherwise-valid import.
   */
  private warnIfChannelsUnderspanWindow(
    channels: readonly ChannelInput[],
    windowDurationSeconds: number,
  ): void {
    if (windowDurationSeconds <= 0) return;
    // Tolerance: a channel may fall short by up to one chunk (5 min) plus 1%
    // before we consider it "materially" short. Below that, warn.
    const toleranceSeconds = CHUNK_DURATION_SECONDS + windowDurationSeconds * 0.01;
    for (const ch of channels) {
      if (ch.sampleRate <= 0) continue;
      const spanSeconds = ch.data.length / ch.sampleRate;
      if (windowDurationSeconds - spanSeconds > toleranceSeconds) {
        // eslint-disable-next-line no-console
        console.warn(
          `[OPFSService] Channel "${ch.name}" spans ~${spanSeconds.toFixed(0)}s but the ` +
            `session window is ~${windowDurationSeconds.toFixed(0)}s. The signal will be ` +
            `truncated by ~${(windowDurationSeconds - spanSeconds).toFixed(0)}s. This usually ` +
            `means multi-segment channel assembly did not window-align the data.`,
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Signal data — read
  // -----------------------------------------------------------------------

  /**
   * Read the manifest for a session.
   *
   * @param sessionId - Session identifier.
   * @returns The parsed signal manifest.
   */
  async readManifest(sessionId: string): Promise<SignalManifest> {
    try {
      const sessionDir = await this.getSessionDir(sessionId, false);
      const fileHandle = await sessionDir.getFileHandle(MANIFEST_FILE);
      const file = await fileHandle.getFile();
      const text = await file.text();
      return JSON.parse(text) as SignalManifest;
    } catch (error) {
      if (error instanceof OPFSError) throw error;
      throw new OPFSError(
        'OPFS_READ_FAILED',
        `Failed to read manifest for session "${sessionId}": ${String(error)}`,
        { cause: error, context: { sessionId } },
      );
    }
  }

  /**
   * Read all data for a single channel across all chunks.
   *
   * @param sessionId   - Session identifier.
   * @param channelName - Channel name (e.g., "Flow").
   * @returns Float32Array containing all samples for the channel.
   */
  async readChannel(sessionId: string, channelName: string): Promise<Float32Array> {
    try {
      const manifest = await this.readManifest(sessionId);
      const channel = manifest.channels.find((ch) => ch.name === channelName);

      if (!channel) {
        throw new OPFSError(
          'OPFS_CHANNEL_NOT_FOUND',
          `Channel "${channelName}" not found in session "${sessionId}".`,
          { context: { sessionId, channelName, available: manifest.channels.map((c) => c.name) } },
        );
      }

      // Calculate total samples across all chunks
      let totalSamples = 0;
      for (const chunk of manifest.chunks) {
        totalSamples += chunk.samples[channelName] ?? 0;
      }

      const result = new Float32Array(totalSamples);
      let writeOffset = 0;

      const sessionDir = await this.getSessionDir(sessionId, false);

      for (const chunk of manifest.chunks) {
        const chunkSamples = chunk.samples[channelName] ?? 0;
        if (chunkSamples === 0) continue;

        const channelData = await this.readChunkChannel(sessionDir, manifest, chunk, channel);
        result.set(channelData, writeOffset);
        writeOffset += channelData.length;
      }

      return result;
    } catch (error) {
      if (error instanceof OPFSError) throw error;
      throw new OPFSError(
        'OPFS_READ_FAILED',
        `Failed to read channel "${channelName}" for session "${sessionId}": ${String(error)}`,
        { cause: error, context: { sessionId, channelName } },
      );
    }
  }

  /**
   * Read signal data for a channel within a specific time range.
   *
   * Uses the manifest's chunk descriptors for efficient lookup — only
   * chunks that overlap the requested range are read from disk.
   *
   * @param sessionId   - Session identifier.
   * @param channelName - Channel name.
   * @param startTime   - Start of requested range (epoch ms, inclusive).
   * @param endTime     - End of requested range (epoch ms, exclusive).
   * @returns Float32Array of samples within the time range.
   */
  async readTimeRange(
    sessionId: string,
    channelName: string,
    startTime: number,
    endTime: number,
  ): Promise<Float32Array> {
    try {
      const manifest = await this.readManifest(sessionId);
      const channel = manifest.channels.find((ch) => ch.name === channelName);

      if (!channel) {
        throw new OPFSError(
          'OPFS_CHANNEL_NOT_FOUND',
          `Channel "${channelName}" not found in session "${sessionId}".`,
          { context: { sessionId, channelName } },
        );
      }

      // Find overlapping chunks via binary search
      const chunkIndices = this.getChunksForTimeRange(manifest, startTime, endTime);

      if (chunkIndices.length === 0) {
        return new Float32Array(0);
      }

      const sessionDir = await this.getSessionDir(sessionId, false);
      const parts: Float32Array[] = [];

      for (const ci of chunkIndices) {
        const chunk = manifest.chunks[ci];
        if (!chunk) continue;

        const fullChunkData = await this.readChunkChannel(sessionDir, manifest, chunk, channel);

        // Trim to the requested time range within this chunk
        const chunkDurationMs = chunk.endTime - chunk.startTime;
        const chunkSamples = chunk.samples[channelName] ?? 0;
        if (chunkSamples === 0 || chunkDurationMs <= 0) continue;

        const msPerSample = chunkDurationMs / chunkSamples;

        // Calculate which samples fall within [startTime, endTime)
        const rangeStartInChunk = Math.max(0, startTime - chunk.startTime);
        const rangeEndInChunk = Math.min(chunkDurationMs, endTime - chunk.startTime);

        const firstSample = Math.floor(rangeStartInChunk / msPerSample);
        const lastSample = Math.min(Math.ceil(rangeEndInChunk / msPerSample), chunkSamples);

        if (lastSample > firstSample) {
          parts.push(fullChunkData.subarray(firstSample, lastSample));
        }
      }

      // Concatenate parts
      const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
      const result = new Float32Array(totalLength);
      let offset = 0;
      for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
      }

      return result;
    } catch (error) {
      if (error instanceof OPFSError) throw error;
      throw new OPFSError(
        'OPFS_READ_FAILED',
        `Failed to read time range for channel "${channelName}" in session "${sessionId}": ${String(error)}`,
        { cause: error, context: { sessionId, channelName, startTime, endTime } },
      );
    }
  }

  // -----------------------------------------------------------------------
  // Chunk lookup (design §4.5)
  // -----------------------------------------------------------------------

  /**
   * Find chunk indices that overlap a given time range using binary search.
   *
   * @param manifest  - Session manifest.
   * @param startTime - Start of requested range (epoch ms).
   * @param endTime   - End of requested range (epoch ms).
   * @returns Indices into `manifest.chunks` for overlapping chunks.
   */
  getChunksForTimeRange(manifest: SignalManifest, startTime: number, endTime: number): number[] {
    const { chunks } = manifest;
    if (chunks.length === 0) return [];

    const startIdx = this.binarySearchChunks(chunks, startTime);
    const endIdx = this.binarySearchChunks(chunks, endTime);

    // Clamp to valid range
    const from = Math.max(0, Math.min(startIdx, chunks.length - 1));
    const to = Math.max(0, Math.min(endIdx, chunks.length - 1));

    const indices: number[] = [];
    for (let i = from; i <= to; i++) {
      indices.push(i);
    }
    return indices;
  }

  // -----------------------------------------------------------------------
  // Session-level storage estimate
  // -----------------------------------------------------------------------

  /**
   * Get the total signal data size for a session (sum of all chunk byte sizes).
   *
   * @param sessionId - Session identifier.
   * @returns Total byte size, or `null` if the session has no manifest.
   */
  async getSessionDataSize(sessionId: string): Promise<number | null> {
    try {
      const manifest = await this.readManifest(sessionId);
      return manifest.chunks.reduce((sum, chunk) => sum + chunk.byteSize, 0);
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // File listing
  // -----------------------------------------------------------------------

  /**
   * List all session IDs that have stored signal data.
   *
   * @returns Array of session ID strings.
   */
  async listSessions(): Promise<string[]> {
    try {
      const signalsDir = await this.getSignalsDir();
      const sessions: string[] = [];
      for await (const handle of signalsDir.values()) {
        if (handle.kind === 'directory') {
          sessions.push(handle.name);
        }
      }
      return sessions;
    } catch (error) {
      if (error instanceof OPFSError) throw error;
      throw new OPFSError('OPFS_READ_FAILED', `Failed to list sessions: ${String(error)}`, {
        cause: error,
      });
    }
  }

  /**
   * List all files stored for a session (manifest + chunks).
   *
   * @param sessionId - Session identifier.
   * @returns Array of filenames.
   */
  async listSessionFiles(sessionId: string): Promise<string[]> {
    try {
      const sessionDir = await this.getSessionDir(sessionId, false);
      const files: string[] = [];
      for await (const handle of sessionDir.values()) {
        if (handle.kind === 'file') {
          files.push(handle.name);
        }
      }
      return files;
    } catch (error) {
      if (error instanceof OPFSError) throw error;
      if (this.isNotFoundError(error)) {
        return [];
      }
      throw new OPFSError(
        'OPFS_READ_FAILED',
        `Failed to list files for session "${sessionId}": ${String(error)}`,
        { cause: error, context: { sessionId } },
      );
    }
  }

  // -----------------------------------------------------------------------
  // Deletion
  // -----------------------------------------------------------------------

  /**
   * Delete all signal data files for a session.
   *
   * @param sessionId - Session identifier.
   */
  async deleteSessionData(sessionId: string): Promise<void> {
    try {
      const signalsDir = await this.getSignalsDir();
      await signalsDir.removeEntry(sessionId, { recursive: true });
    } catch (error) {
      // Ignore "not found" errors — already deleted
      if (this.isNotFoundError(error)) return;
      throw new OPFSError(
        'OPFS_DELETE_FAILED',
        `Failed to delete signal data for session "${sessionId}": ${String(error)}`,
        { cause: error, context: { sessionId } },
      );
    }
  }

  /**
   * Delete all stored data (signals and cache). Use with extreme caution.
   */
  async deleteAll(): Promise<void> {
    try {
      const root = await this.ensureInitialized();
      // Remove and recreate signals directory
      try {
        await root.removeEntry(SIGNALS_DIR, { recursive: true });
      } catch {
        /* may not exist */
      }
      await root.getDirectoryHandle(SIGNALS_DIR, { create: true });

      // Remove and recreate cache directory
      try {
        await root.removeEntry(CACHE_DIR, { recursive: true });
      } catch {
        /* may not exist */
      }
      const cacheDir = await root.getDirectoryHandle(CACHE_DIR, { create: true });
      await cacheDir.getDirectoryHandle(DOWNSAMPLED_DIR, { create: true });
    } catch (error) {
      throw new OPFSError(
        'OPFS_DELETE_FAILED',
        `Failed to delete all OPFS data: ${String(error)}`,
        { cause: error },
      );
    }
  }

  // -----------------------------------------------------------------------
  // Cache directory access
  // -----------------------------------------------------------------------

  /**
   * Write downsampled cache data.
   *
   * @param key  - Cache key (used as filename, must be filesystem-safe).
   * @param data - Float32Array of downsampled values.
   */
  async writeDownsampledCache(key: string, data: Float32Array): Promise<void> {
    try {
      const cacheDir = await this.getDownsampledDir();
      const fileHandle = await cacheDir.getFileHandle(`${key}.f32`, { create: true });
      const writable = await fileHandle.createWritable();
      try {
        const buffer = (data.buffer as ArrayBuffer).slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        );
        await writable.write(buffer);
      } finally {
        await writable.close();
      }
    } catch (error) {
      if (error instanceof OPFSError) throw error;
      throw new OPFSError(
        'OPFS_WRITE_FAILED',
        `Failed to write downsampled cache "${key}": ${String(error)}`,
        { cause: error, context: { key } },
      );
    }
  }

  /**
   * Read downsampled cache data.
   *
   * @param key - Cache key.
   * @returns Float32Array, or `null` if the cached file does not exist.
   */
  async readDownsampledCache(key: string): Promise<Float32Array | null> {
    try {
      const cacheDir = await this.getDownsampledDir();
      const fileHandle = await cacheDir.getFileHandle(`${key}.f32`);
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      return new Float32Array(buffer);
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Quota
  // -----------------------------------------------------------------------

  /**
   * Estimate current storage usage and available quota.
   *
   * Uses the Storage API's `estimate()` method. Returns zeros when
   * the API is unavailable.
   */
  async getQuotaEstimate(): Promise<QuotaEstimate> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return { usage: 0, quota: 0, percentUsed: 0 };
    }

    try {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage ?? 0;
      const quota = estimate.quota ?? 0;
      const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;
      return { usage, quota, percentUsed };
    } catch (error) {
      throw new OPFSError(
        'OPFS_QUOTA_FAILED',
        `Failed to estimate storage quota: ${String(error)}`,
        { cause: error },
      );
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Resolve the OPFS root handle, initializing the service on demand.
   *
   * Self-initializing so that root-dependent I/O methods work on a freshly
   * constructed instance without an explicit `initialize()` call. Callers that
   * still invoke `initialize()` up front remain correct — it's a no-op the
   * second time around.
   */
  private async ensureInitialized(): Promise<FileSystemDirectoryHandle> {
    if (!this.root) {
      await this.initialize();
    }
    // `initialize()` either sets `this.root` or throws, so this is non-null.
    return this.getRoot();
  }

  private getRoot(): FileSystemDirectoryHandle {
    if (!this.root) {
      throw new OPFSError(
        'OPFS_NOT_INITIALIZED',
        'OPFS not initialized. Call initialize() first.',
        { recoverable: true },
      );
    }
    return this.root;
  }

  private async getSignalsDir(): Promise<FileSystemDirectoryHandle> {
    const root = await this.ensureInitialized();
    return root.getDirectoryHandle(SIGNALS_DIR, { create: true });
  }

  private async getSessionDir(
    sessionId: string,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    const signalsDir = await this.getSignalsDir();
    return signalsDir.getDirectoryHandle(sessionId, { create });
  }

  private async getDownsampledDir(): Promise<FileSystemDirectoryHandle> {
    const root = await this.ensureInitialized();
    const cacheDir = await root.getDirectoryHandle(CACHE_DIR, { create: true });
    return cacheDir.getDirectoryHandle(DOWNSAMPLED_DIR, { create: true });
  }

  /**
   * Read a single channel's data from one chunk file.
   *
   * The binary layout is channel-wise contiguous: all samples for channel 0,
   * then channel 1, etc. We calculate the byte offset by summing the sizes
   * of all preceding channels in the chunk.
   */
  private async readChunkChannel(
    sessionDir: FileSystemDirectoryHandle,
    manifest: SignalManifest,
    chunk: ChunkDescriptor,
    channel: ChannelDescriptor,
  ): Promise<Float32Array> {
    const fileHandle = await sessionDir.getFileHandle(chunk.fileName);
    const file = await fileHandle.getFile();
    const arrayBuffer = await file.arrayBuffer();

    // Calculate byte offset: sum sizes of all preceding channels
    let byteOffset = 0;
    for (let i = 0; i < channel.index; i++) {
      const prevChannel = manifest.channels[i];
      if (!prevChannel) continue;
      const prevSamples = chunk.samples[prevChannel.name] ?? 0;
      byteOffset += prevSamples * BYTES_PER_SAMPLE;
    }

    const sampleCount = chunk.samples[channel.name] ?? 0;
    const byteLength = sampleCount * BYTES_PER_SAMPLE;

    return new Float32Array(arrayBuffer.slice(byteOffset, byteOffset + byteLength));
  }

  /**
   * Binary search for the chunk index containing a given time.
   *
   * Returns the index of the chunk that contains `time`, or the insertion
   * point (first chunk starting after `time`) if no chunk spans it.
   */
  private binarySearchChunks(chunks: readonly ChunkDescriptor[], time: number): number {
    let left = 0;
    let right = chunks.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const chunk = chunks[mid];
      if (!chunk) break;

      if (chunk.endTime < time) {
        left = mid + 1;
      } else if (chunk.startTime > time) {
        right = mid - 1;
      } else {
        return mid; // time is within this chunk
      }
    }

    return left; // insertion point
  }

  /** Check whether an error indicates a "not found" condition. */
  private isNotFoundError(error: unknown): boolean {
    return (
      error instanceof DOMException &&
      (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')
    );
  }
}
