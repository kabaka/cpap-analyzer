/**
 * Worker utilities — barrel export.
 *
 * @module services/workers
 */

export {
  buildWorkerError,
  createWorker,
  deserialiseCPAPError,
  serialiseCPAPError,
} from './createWorker';

export type { CreateWorkerOptions, WrappedWorker } from './createWorker';

export { WorkerPool } from './WorkerPool';
export type { WorkerPoolOptions } from './WorkerPool';

export type { AnalysisWorkerAPI } from './analysis.worker';

export type { ExportWorkerAPI } from './export.worker';
