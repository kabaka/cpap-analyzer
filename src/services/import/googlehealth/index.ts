/**
 * Google Health (Fitbit) import pipeline.
 *
 * Barrel module that re-exports the directory scanner, all data-type parsers,
 * and CSV utility functions.
 *
 * Usage:
 * ```ts
 * import { scanGoogleHealthExport, parseSleepFiles, parseCSV } from '@/services/import/googlehealth';
 * ```
 *
 * @module services/import/googlehealth
 */

// Orchestrator service
export { GoogleHealthImportService } from './GoogleHealthImportService';
export type {
  GoogleHealthImportOptions,
  ParsedDailyRecord,
  ParsedTimeseriesRecord,
} from './GoogleHealthImportService';

// Scanner
export { scanGoogleHealthExport } from './scanner';

// Parsers
export type { ParsedRecord } from './parsers';
export {
  parseSleepFiles,
  parseSleepScoreFile,
  parseSpO2DailyFiles,
  parseSpO2IntradayFiles,
  parseHRVDailyFiles,
  parseHRVDetailFiles,
  parseRespiratoryRateFiles,
  parseRestingHeartRateFiles,
  parseReadinessFiles,
  parseStressFile,
  parseTemperatureFiles,
  parseActivityFiles,
  parseSnoringFiles,
} from './parsers';

// CSV utilities
export {
  parseCSV,
  extractDate,
  parseFitbitLegacyDate,
  parseTimestamp,
  parseNumericField,
  parseNumericFieldWithDefault,
} from './csv-utils';
