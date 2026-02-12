/**
 * Report types and template definitions.
 *
 * Defines the interfaces for report generation, content selection,
 * and template configuration used by the ReportService.
 *
 * @module services/reports/types
 */

/** Available report template types. */
export type ReportTemplate = 'physician-summary' | 'full-analysis' | 'custom';

/** Available report output formats. */
export type ReportFormat = 'pdf' | 'csv' | 'encrypted-archive';

/** Sections that can be included in a report. */
export interface ReportSections {
  /** Summary statistics (AHI, leak, usage, compliance). */
  summaryStatistics: boolean;
  /** Nightly session details table. */
  sessionDetails: boolean;
  /** AHI trend over the date range. */
  ahiTrend: boolean;
  /** Leak rate analysis. */
  leakAnalysis: boolean;
  /** Pressure metrics. */
  pressureMetrics: boolean;
  /** Event breakdown by type. */
  eventBreakdown: boolean;
  /** Compliance summary. */
  complianceReport: boolean;
  /** Usage pattern analysis. */
  usagePatterns: boolean;
}

/** Content selection for report generation. */
export interface ReportContentSelection {
  /** Report template to use. */
  template: ReportTemplate;
  /** Date range for the report (ISO date strings). */
  dateRange: { start: string; end: string };
  /** Which sections to include. */
  sections: ReportSections;
  /** Output format. */
  format: ReportFormat;
  /** Optional title override (defaults to template name). */
  title?: string;
}

/** Default sections for the physician summary template. */
export const PHYSICIAN_SUMMARY_SECTIONS: ReportSections = {
  summaryStatistics: true,
  sessionDetails: false,
  ahiTrend: true,
  leakAnalysis: false,
  pressureMetrics: true,
  eventBreakdown: false,
  complianceReport: true,
  usagePatterns: false,
};

/** Default sections for the full analysis template. */
export const FULL_ANALYSIS_SECTIONS: ReportSections = {
  summaryStatistics: true,
  sessionDetails: true,
  ahiTrend: true,
  leakAnalysis: true,
  pressureMetrics: true,
  eventBreakdown: true,
  complianceReport: true,
  usagePatterns: true,
};

/** Default sections for the custom template. */
export const CUSTOM_DEFAULT_SECTIONS: ReportSections = {
  summaryStatistics: true,
  sessionDetails: false,
  ahiTrend: false,
  leakAnalysis: false,
  pressureMetrics: false,
  eventBreakdown: false,
  complianceReport: false,
  usagePatterns: false,
};

/** Template metadata for display in the UI. */
export interface TemplateInfo {
  id: ReportTemplate;
  name: string;
  description: string;
  defaultSections: ReportSections;
}

/** All available report templates. */
export const REPORT_TEMPLATES: TemplateInfo[] = [
  {
    id: 'physician-summary',
    name: 'Physician Summary',
    description:
      'A concise 1-page report with key metrics, 30-day trend summary, and compliance percentage. Ideal for sharing with your healthcare provider.',
    defaultSections: PHYSICIAN_SUMMARY_SECTIONS,
  },
  {
    id: 'full-analysis',
    name: 'Full Analysis Report',
    description:
      'Comprehensive multi-page report with all analyses, detailed metric tables, event breakdowns, and usage patterns.',
    defaultSections: FULL_ANALYSIS_SECTIONS,
  },
  {
    id: 'custom',
    name: 'Custom Report',
    description:
      'Build your own report by selecting which sections to include. Full control over content.',
    defaultSections: CUSTOM_DEFAULT_SECTIONS,
  },
];

/** Session row for CSV export. */
export interface SessionCSVRow {
  date: string;
  ahi: number;
  ahiObstructive: number;
  ahiCentral: number;
  ahiHypopnea: number;
  eventCount: number;
  leakMedian: number;
  leakP95: number;
  pressureMean: number;
  pressureP95: number;
  usageHours: number;
  complianceStatus: string;
}

/** Descriptive statistics for a single metric. */
export interface DescriptiveStats {
  min: number;
  q1: number;
  median: number;
  mean: number;
  q3: number;
  max: number;
  stdDev: number;
}

/** Aggregate statistics used in reports. */
export interface ReportStatistics {
  // ── Existing fields ──
  totalSessions: number;
  dateRange: { start: string; end: string };
  meanAHI: number;
  medianAHI: number;
  minAHI: number;
  maxAHI: number;
  meanLeak: number;
  meanPressure: number;
  meanUsageHours: number;
  totalUsageHours: number;
  complianceRate: number;
  compliantNights: number;
  nonCompliantNights: number;

  // ── Extended fields for enhanced reports ──
  medianUsageHours: number;
  meanLeakP95: number;
  meanPressureP95: number;
  meanPressureMax: number;
  meanLeakMax: number;
  meanLeakDurationMinutes: number;

  /** Descriptive statistics per metric. */
  descriptive: {
    ahi: DescriptiveStats;
    usageHours: DescriptiveStats;
    leakMedian: DescriptiveStats;
    leakP95: DescriptiveStats;
    pressureMean: DescriptiveStats;
    pressureP95: DescriptiveStats;
    spo2Mean: DescriptiveStats | null;
  };

  /** Event totals across all sessions. */
  eventTotals: {
    obstructive: number;
    central: number;
    mixed: number;
    hypopnea: number;
    rera: number;
    flowLimitation: number;
    largeLeak: number;
    periodicBreathing: number;
  };

  /** Pearson correlations between key metrics. */
  correlations: {
    ahiVsUsage: number;
    ahiVsLeak: number;
    leakVsPressure: number;
  };

  /** Usage tier counts. */
  nightsAbove4Hours: number;
  nightsAbove6Hours: number;
  nightsAbove8Hours: number;

  /** Whether the 30-day CMS compliance threshold is met. */
  cmsCompliant: boolean;
}

/** Result of a report generation operation. */
export interface ReportResult {
  /** The generated file as a Blob. */
  blob: Blob;
  /** Suggested filename for download. */
  filename: string;
  /** MIME type of the generated file. */
  mimeType: string;
}

/** Parameters for encrypted archive generation. */
export interface EncryptionParams {
  /** User-provided password for key derivation. */
  password: string;
  /** Number of PBKDF2 iterations (default: 600_000). */
  iterations?: number;
}
