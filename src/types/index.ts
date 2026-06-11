/**
 * CPAP Analyzer domain types.
 *
 * This barrel module re-exports all domain types from a single entry point.
 * Import from `@/types` rather than individual files.
 */

// Session & nightly summary types
export type {
  ChannelMetadata,
  MachineSettings,
  MachineType,
  NightlyAggregate,
  Session,
} from './session';

// Therapy event types
export type { Event, EventType } from './events';

// Signal data types
export type { SignalChunk } from './signals';

// Analysis types
export type {
  AnalysisInput,
  AnalysisMetadata,
  AnalysisOutput,
  AnalysisResult,
  DateRange,
} from './analysis';

// Plugin types
export type {
  AnalysisPlugin,
  ExportPlugin,
  IntegrationPlugin,
  MachinePlugin,
  Plugin,
  PluginMetadata,
  VisualizationPlugin,
} from './plugins';

// Error types (enums exported as values)
export { ErrorCategory, ErrorSeverity } from './errors';
export type { CPAPError } from './errors';

// Fitbit / Google Health types
export type {
  FitbitActivityDaily,
  FitbitBodyWeight,
  FitbitDailyPayloadMap,
  FitbitDailyType,
  FitbitDataType,
  FitbitHRVDaily,
  FitbitHRVDetail,
  FitbitHRVDetailInterval,
  FitbitReadiness,
  FitbitRespiratoryRate,
  FitbitRestingHeartRate,
  FitbitSleepProfile,
  FitbitSleepScore,
  FitbitSleepSession,
  FitbitSleepStages,
  FitbitSleepStageTransition,
  FitbitSnoringDaily,
  FitbitSnoringSegment,
  FitbitSnoringSegments,
  FitbitSpO2Daily,
  FitbitSpO2Intraday,
  FitbitStress,
  FitbitTemperature,
  FitbitTimeseriesPayloadMap,
  FitbitTimeseriesType,
  FitbitVO2Max,
  GoogleHealthDataTypeInfo,
  GoogleHealthScanResult,
} from './fitbit';
export { FITBIT_DATA_TIERS, FITBIT_DATA_TYPE_LABEL, FITBIT_DATA_TYPE_TIER } from './fitbit';

// Settings types
export type {
  AnalysisParams,
  ClusteringMethod,
  DateFormat,
  DisplayPreferences,
  IntegrationConfig,
  LLMProvider,
  Settings,
  TimeFormat,
} from './settings';

// Storage types
export type {
  DataProvider,
  ImportError,
  ImportRecord,
  IntegrationDailySummary,
  IntegrationData,
  IntegrationImportRecord,
  IntegrationSource,
  IntegrationTimeseries,
} from './storage';
