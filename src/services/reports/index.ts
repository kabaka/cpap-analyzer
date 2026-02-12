/**
 * Report services — barrel export.
 *
 * @module services/reports
 */

export {
  generatePDF,
  generateCSV,
  generateEncryptedArchive,
  downloadBlob,
  buildCSVFromAggregates,
  encryptBuffer,
} from './ReportService';

export type {
  EncryptionParams,
  ReportContentSelection,
  ReportFormat,
  ReportResult,
  ReportSections,
  ReportStatistics,
  ReportTemplate,
  SessionCSVRow,
  TemplateInfo,
} from './types';

export {
  REPORT_TEMPLATES,
  PHYSICIAN_SUMMARY_SECTIONS,
  FULL_ANALYSIS_SECTIONS,
  CUSTOM_DEFAULT_SECTIONS,
} from './types';
