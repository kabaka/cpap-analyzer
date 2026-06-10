/**
 * Comlink-wrapped Web Worker exposing the EDF parsing pipeline.
 *
 * Runs EDF parsing, ResMed interpretation, and validation off the
 * main thread to keep the UI responsive during data import.
 *
 * @module services/workers/edfParser.worker
 */

import * as Comlink from 'comlink';

import { EDFParser } from '@/parsers/edf/EDFParser';
import type { ValidationResult as EDFValidationResult } from '@/parsers/edf/EDFParser';
import type { EDFFile } from '@/parsers/edf/types';
import { ResMedInterpreter } from '@/parsers/resmed/ResMedInterpreter';
import type { ResMedInterpretation } from '@/parsers/resmed/ResMedInterpreter';
import { Validator } from '@/parsers/validation/Validator';
import type { ValidationResult } from '@/parsers/validation/Validator';

/**
 * Result returned from a full parse+interpret+validate cycle.
 *
 * The backing `Float32Array` sample buffers are *transferred* (moved, not
 * cloned) from the worker to the caller — see {@link parseEDFFile}. After the
 * call resolves the worker no longer owns those buffers.
 */
export interface ParseResult {
  /**
   * Raw EDF structure. Present ONLY when the caller requests it (STR files,
   * which the main thread re-parses with the STRParser). For the BRP / PLD /
   * SAD / EVE / CSL majority this is `undefined` to halve the transfer payload.
   */
  edf?: EDFFile;
  interpretation: ResMedInterpretation;
  validation: ValidationResult;
  /** Lowercase hex SHA-256 of the source file bytes, computed in the worker. */
  fileHash: string;
}

/**
 * Collect each *unique* ArrayBuffer backing a parsed channel/signal so it can be
 * added to a Comlink transfer list. Several `StandardChannel`s may alias the
 * same underlying buffer (e.g. when the interpreter reuses the EDF signal's
 * `Float32Array` without copying), so we dedupe by buffer identity — a buffer
 * may be transferred at most once or the structured-clone step throws.
 */
function collectTransferables(result: ParseResult): Transferable[] {
  const seen = new Set<ArrayBuffer>();
  const add = (samples: Float32Array): void => {
    const buf = samples.buffer;
    if (buf instanceof ArrayBuffer) seen.add(buf);
  };
  for (const ch of result.interpretation.channels) add(ch.samples);
  if (result.edf) {
    for (const sig of result.edf.signals) add(sig.samples);
  }
  return [...seen];
}

const parserAPI = {
  /**
   * Parse an EDF file buffer through the full pipeline:
   * EDF parse → ResMed interpretation → validation, also computing the file's
   * SHA-256 hash while the buffer is still resident here.
   *
   * @param buffer      Raw EDF file bytes (consumed; not retained).
   * @param includeEdf  When `true` the raw `EDFFile` is returned (needed only
   *   for STR files, which the main thread re-parses with the STRParser). The
   *   caller decides this from the file's classified type — STR detection is
   *   robustly known at the call site, so it is passed explicitly rather than
   *   re-sniffed here. Defaults to `false`.
   *
   * Sample buffers are MOVED to the caller via {@link Comlink.transfer} to
   * avoid the structured-clone copy of multi-megabyte time-series arrays.
   */
  async parseEDFFile(buffer: ArrayBuffer, includeEdf = false): Promise<ParseResult> {
    const parser = new EDFParser();
    const interpreter = new ResMedInterpreter();
    const validator = new Validator();

    // Hash the raw bytes BEFORE parsing transfers/mutates anything downstream.
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const fileHash = hexFromBuffer(digest);

    const edf = parser.parse(buffer);
    const interpretation = interpreter.interpret(edf);
    const edfValidation = validator.validateEDF(edf);

    const result: ParseResult = {
      edf: includeEdf ? edf : undefined,
      interpretation,
      validation: edfValidation,
      fileHash,
    };

    return Comlink.transfer(result, collectTransferables(result));
  },

  /**
   * Quick header-only validation without a full parse.
   * Useful for pre-screening files before committing to a full import.
   */
  validateEDFHeader(buffer: ArrayBuffer): EDFValidationResult {
    const parser = new EDFParser();
    return parser.validate(buffer);
  },
};

/** Convert an ArrayBuffer to a lowercase hex string. */
function hexFromBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

/** Public API type for consumers creating a Comlink Remote<T>. */
export type EDFParserWorkerAPI = typeof parserAPI;

Comlink.expose(parserAPI);
