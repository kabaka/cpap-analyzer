/**
 * DetectionDisclaimer — persistent info banner for app-computed breathing
 * detections. Per ADR 0017 every surface that renders PB/CSR/TECSA must carry
 * this language: candidate flags, never diagnoses.
 *
 * Uses the measured info palette (never status-severe / red) — TECSA and
 * CSR-like patterns are trajectories worth discussing with a clinician, not
 * alarms.
 *
 * @module components/domain/Breathing/DetectionDisclaimer
 */

import styles from './DetectionDisclaimer.module.css';

export interface DetectionDisclaimerProps {
  /** Optional override className. */
  readonly className?: string;
  /** When true, render the compact one-line form. */
  readonly compact?: boolean;
}

export const DETECTION_DISCLAIMER_TEXT =
  'Detected patterns are statistical candidates, not clinical diagnoses. Discuss with your clinician.';

const DETECTION_DISCLAIMER_TEXT_COMPACT = 'Detections are candidate patterns, not diagnoses.';

/** Persistent info banner with icon + body text. */
export function DetectionDisclaimer({
  className,
  compact = false,
}: DetectionDisclaimerProps): JSX.Element {
  const rootClass = [styles.root, compact ? styles.compact : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass} role="note">
      <span className={styles.icon} aria-hidden="true">
        ℹ
      </span>
      <p className={styles.body}>
        {compact ? DETECTION_DISCLAIMER_TEXT_COMPACT : DETECTION_DISCLAIMER_TEXT}
      </p>
    </div>
  );
}

export default DetectionDisclaimer;
