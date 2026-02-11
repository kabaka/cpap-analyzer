/**
 * Plugin system types for the CPAP Analyzer extension architecture.
 *
 * Five plugin categories are supported:
 * - **Machine**: Parse data from specific CPAP machines
 * - **Analysis**: Add new statistical/clinical analysis algorithms
 * - **Visualization**: Provide custom chart and rendering components
 * - **Integration**: Connect to external services (Fitbit, weather, LLMs)
 * - **Export**: Generate output files in various formats
 */

import type { AnalysisInput, AnalysisOutput } from './analysis';
import type { IntegrationData } from './storage';
import type { Session } from './session';

/** Base metadata common to all plugin types. */
export interface PluginMetadata {
  readonly id: string;
  readonly name: string;
  /** Semantic version (e.g., "1.2.3"). */
  readonly version: string;
  readonly description: string;
  readonly author: string;
}

/**
 * Plugin that adds support for a specific CPAP machine's data format.
 *
 * Responsible for parsing raw files (EDF, proprietary formats) from
 * a machine's SD card into normalized Session objects.
 */
export interface MachinePlugin extends PluginMetadata {
  readonly type: 'machine';
  /** Machine model identifiers this plugin can handle. */
  readonly supportedMachines: string[];
  /** Parse raw files into normalized sessions. */
  readonly parseFiles: (files: File[]) => Promise<Session[]>;
}

/**
 * Plugin that provides a new analysis algorithm.
 *
 * Receives structured input and returns computed results that can
 * be displayed by visualization plugins.
 */
export interface AnalysisPlugin extends PluginMetadata {
  readonly type: 'analysis';
  /** Analysis types this plugin can compute. */
  readonly analysisTypes: AnalysisInput['type'][];
  /** Execute the analysis and return results. */
  readonly analyze: (input: AnalysisInput) => Promise<AnalysisOutput>;
}

/**
 * Plugin that provides custom chart or visualization rendering.
 *
 * Given a DOM container and analysis output, renders an interactive
 * visualization (chart, heatmap, dashboard widget, etc.).
 */
export interface VisualizationPlugin extends PluginMetadata {
  readonly type: 'visualization';
  /** Chart type identifiers this plugin can render. */
  readonly chartTypes: string[];
  /** Render the visualization into the given container. */
  readonly render: (container: HTMLElement, data: AnalysisOutput) => void;
}

/** Date range for integration data fetches (ISO date strings). */
interface IntegrationDateRange {
  readonly start: string;
  readonly end: string;
}

/**
 * Plugin that connects to an external data service.
 *
 * Manages the connection lifecycle and fetches external data
 * (e.g., sleep tracking, weather) to correlate with CPAP sessions.
 */
export interface IntegrationPlugin extends PluginMetadata {
  readonly type: 'integration';
  /** Name of the external service (e.g., "fitbit", "weather"). */
  readonly serviceName: string;
  /** Establish a connection to the external service. */
  readonly connect: () => Promise<void>;
  /** Fetch data from the service for the given date range. */
  readonly fetchData: (dateRange: IntegrationDateRange) => Promise<IntegrationData>;
  /** Disconnect from the external service. */
  readonly disconnect: () => Promise<void>;
}

/**
 * Plugin that exports analysis data to a file format.
 *
 * Converts one or more analysis outputs into a downloadable Blob
 * in the requested format (CSV, PDF, etc.).
 */
export interface ExportPlugin extends PluginMetadata {
  readonly type: 'export';
  /** Supported export format identifiers (e.g., "csv", "pdf", "json"). */
  readonly formats: string[];
  /** Export analysis results in the specified format. */
  readonly export: (data: AnalysisOutput[], format: string) => Promise<Blob>;
}

/** Discriminated union of all plugin types. */
export type Plugin =
  | MachinePlugin
  | AnalysisPlugin
  | VisualizationPlugin
  | IntegrationPlugin
  | ExportPlugin;
