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

/** Result returned from a full parse+interpret+validate cycle. */
export interface ParseResult {
  edf: EDFFile;
  interpretation: ResMedInterpretation;
  validation: ValidationResult;
}

const parserAPI = {
  /**
   * Parse an EDF file buffer through the full pipeline:
   * EDF parse → ResMed interpretation → validation.
   */
  parseEDFFile(buffer: ArrayBuffer): ParseResult {
    const parser = new EDFParser();
    const interpreter = new ResMedInterpreter();
    const validator = new Validator();

    const edf = parser.parse(buffer);
    const interpretation = interpreter.interpret(edf);
    const edfValidation = validator.validateEDF(edf);

    return {
      edf,
      interpretation,
      validation: edfValidation,
    };
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

/** Public API type for consumers creating a Comlink Remote<T>. */
export type EDFParserWorkerAPI = typeof parserAPI;

Comlink.expose(parserAPI);
