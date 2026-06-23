/**
 * Comlink-wrapped Web Worker exposing the heavy Fitbit (Google Health) parsers.
 *
 * Runs the intraday heart-rate, SpO2, HRV-detail, and snoring parsers off the
 * main thread (ADR 0027). These are the parsers that previously froze the UI for
 * minutes: a synchronous `JSON.parse` / `parseCSV` of large per-day files
 * followed by a full `.sort()` and `.map()` with no yielding and no progress.
 *
 * The worker:
 * - receives already-read `ArrayBuffer`s (TRANSFERRED in, neutered on the main
 *   thread) and `TextDecoder`-decodes them here,
 * - runs the SAME worker-safe parse cores the main-thread `File[]` path uses, so
 *   output is byte-identical (gated by golden-fixture equality tests), and
 * - reports DETERMINATE per-file + per-chunk progress through a Comlink-proxied
 *   callback (`entries.length` is known right after `JSON.parse` / `parseCSV`),
 *   throttled to chunk boundaries to bound `postMessage` frequency.
 *
 * @module services/workers/fitbitParser.worker
 */

import * as Comlink from 'comlink';

import {
  parseHeartRateIntradayCore,
  parseSpO2IntradayCore,
  parseHRVDetailCore,
  parseSnoringCore,
  DEFAULT_CORE_CHUNK_SIZE,
  type CoreProgressReport,
  type ParsedRecord,
} from '@/services/import/googlehealth/parsers';

// ---------------------------------------------------------------------------
// Public worker types
// ---------------------------------------------------------------------------

/** Data types this worker can parse. The heavy intraday/segment parsers. */
export type FitbitWorkerDataType =
  | 'heart_rate_intraday'
  | 'spo2_intraday'
  | 'hrv_detail'
  | 'snoring_daily'
  | 'snoring_segments';

/** A single source file: its name plus its already-read bytes. */
export interface FitbitWorkerFile {
  readonly name: string;
  /** Raw file bytes. TRANSFERRED into the worker (neutered on the caller). */
  readonly buffer: ArrayBuffer;
}

/**
 * Progress report emitted by the worker between processed chunks.
 *
 * Mirrors {@link CoreProgressReport} but adds the cross-file counters so the
 * orchestrator can render both per-file and within-file determinate progress
 * without tracking file boundaries itself.
 */
export interface FitbitWorkerProgress {
  /** 0-based index of the file currently being processed. */
  readonly fileIndex: number;
  /** Name of the file currently being processed. */
  readonly fileName: string;
  /** Entries processed so far within the current file. */
  readonly samplesProcessed: number;
  /** Total entries in the current file (known up-front). */
  readonly samplesTotal: number;
  /** Number of files fully processed so far. */
  readonly filesDone: number;
  /** Total number of files in this task. */
  readonly filesTotal: number;
}

/** Progress callback proxied across the worker boundary via {@link Comlink.proxy}. */
export type FitbitWorkerProgressCallback = (progress: FitbitWorkerProgress) => void;

/**
 * Parsed output for a data type.
 *
 * Both arrays use the plain `ParsedRecord<unknown>` shape (structured-clone
 * safe). The orchestrator routes `daily` to daily storage and `timeseries` to
 * timeseries storage exactly as the legacy main-thread path did. For any given
 * data type at most one of the two is non-empty, EXCEPT snoring which the
 * orchestrator queries per-subtype (the worker returns both and the caller picks).
 */
export interface FitbitWorkerResult {
  readonly daily: ParsedRecord<unknown>[];
  readonly timeseries: ParsedRecord<unknown>[];
}

// ---------------------------------------------------------------------------
// Worker API
// ---------------------------------------------------------------------------

const decoder = new TextDecoder();

const fitbitParserAPI = {
  /**
   * Parse one or more files of a single heavy data type, off the main thread.
   *
   * @param dataType   Which heavy parser to run.
   * @param files      Source files; each `buffer` is decoded here. Buffers are
   *   transferred IN (the caller must not reuse them after the call).
   * @param onProgress Comlink-proxied determinate progress callback, throttled to
   *   chunk boundaries. May be omitted.
   * @param chunkSize  Entries per progress chunk. Defaults to
   *   {@link DEFAULT_CORE_CHUNK_SIZE}; overridable for testing.
   */
  async parseDataType(
    dataType: FitbitWorkerDataType,
    files: readonly FitbitWorkerFile[],
    onProgress?: FitbitWorkerProgressCallback,
    chunkSize: number = DEFAULT_CORE_CHUNK_SIZE,
  ): Promise<FitbitWorkerResult> {
    const daily: ParsedRecord<unknown>[] = [];
    const timeseries: ParsedRecord<unknown>[] = [];
    const filesTotal = files.length;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;

      const text = decoder.decode(file.buffer);

      // Bridge the core's per-file progress to the cross-file shape, adding the
      // file-completion counters the orchestrator needs.
      const bridge = onProgress
        ? (report: CoreProgressReport): void => {
            onProgress({
              fileIndex: report.fileIndex,
              fileName: report.fileName,
              samplesProcessed: report.samplesProcessed,
              samplesTotal: report.samplesTotal,
              filesDone: i,
              filesTotal,
            });
          }
        : undefined;

      switch (dataType) {
        case 'heart_rate_intraday':
          timeseries.push(...parseHeartRateIntradayCore(file.name, text, i, bridge, chunkSize));
          break;
        case 'spo2_intraday':
          timeseries.push(...parseSpO2IntradayCore(file.name, text, i, bridge, chunkSize));
          break;
        case 'hrv_detail':
          timeseries.push(...parseHRVDetailCore(file.name, text, i, bridge, chunkSize));
          break;
        case 'snoring_daily':
        case 'snoring_segments': {
          const result = parseSnoringCore(file.name, text, i, bridge, chunkSize);
          daily.push(...result.daily);
          timeseries.push(...result.segments);
          break;
        }
      }

      // Per-file completion tick so the orchestrator can advance filesDone.
      onProgress?.({
        fileIndex: i,
        fileName: file.name,
        samplesProcessed: 0,
        samplesTotal: 0,
        filesDone: i + 1,
        filesTotal,
      });
    }

    return { daily, timeseries };
  },
};

/** Public API type for consumers creating a Comlink `Remote<T>`. */
export type FitbitParserWorkerAPI = typeof fitbitParserAPI;

/**
 * The worker API object, exported for DIRECT unit testing without spinning a
 * real `Worker` (mirrors the convention used by `downsample.worker.ts`). The
 * production path reaches it through `Comlink.expose` below.
 */
export { fitbitParserAPI };

Comlink.expose(fitbitParserAPI);
