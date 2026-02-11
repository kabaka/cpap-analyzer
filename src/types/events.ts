/**
 * Therapy event types for CPAP session analysis.
 *
 * Events represent clinically significant occurrences detected
 * during a therapy session (apneas, hypopneas, leaks, etc.).
 */

/** Classification of respiratory and therapy events. */
export type EventType =
  | 'ObstructiveApnea'
  | 'CentralApnea'
  | 'MixedApnea'
  | 'Hypopnea'
  | 'RERA'
  | 'FlowLimitation'
  | 'LargeLeak'
  | 'PeriodicBreathing'
  | 'ClearAirway'
  | 'Vibratory'
  | 'ChecksumError';

/**
 * A single clinically significant event detected during a therapy session.
 *
 * Events are timestamped in epoch milliseconds (UTC) and carry contextual
 * measurements captured at the time of the event.
 */
export interface Event {
  /** UUID v4 identifier. */
  readonly id: string;
  /** Foreign key to sessions.id. */
  readonly sessionId: string;
  /** Classification of this event. */
  readonly type: EventType;
  /** Epoch milliseconds (UTC) when this event occurred. */
  readonly timestamp: number;
  /** Duration of the event in seconds. */
  readonly duration: number;
  /** Severity score (0–1) for flow limitation; null for other types. */
  readonly severity: number | null;
  /** Therapy pressure in cmH2O at event time; null if unavailable. */
  readonly pressure: number | null;
  /** EPAP in cmH2O at event time; null if unavailable. */
  readonly epap: number | null;
  /** IPAP in cmH2O at event time (BiPAP only); null if unavailable. */
  readonly ipap: number | null;
  /** Leak rate in L/min at event time; null if unavailable. */
  readonly leak: number | null;
  /** SpO2 percentage at event time; null if no oximetry. */
  readonly spo2: number | null;
  /** Foreign key to cluster ID (computed); null if unassigned. */
  readonly clusterId: string | null;
}
