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
export type { DataProvider, ImportError, ImportRecord, IntegrationData } from './storage';
