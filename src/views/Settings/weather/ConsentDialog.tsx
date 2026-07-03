/**
 * Two-gate weather consent dialog (the second gate; the first is the toggle).
 *
 * Renders the exact privacy contract from the design reference §5 / visual spec
 * §3.2, using the reusable blue-egress / green-retained-local convention:
 *
 * - A blue "What leaves your device" block (outbound-arrow glyph per row).
 * - A green "What never leaves" block (lock glyph per row).
 *
 * An acknowledgement checkbox gates the primary **Enable** button. Cancelling
 * (button, Esc, or overlay click) reverts the toggle and persists nothing; the
 * caller wires the revert through `onOpenChange(false)` → `onCancel`. Enabling
 * calls `onEnable`, which sets `enabled: true` and persists `consentAt`.
 *
 * Copy is intentionally precise (security-auditable): coordinates rounded to
 * ~1.1 km (2 dp), the calendar dates of synced nights, and — only if you use
 * city Find — a typed city string. Nothing else; no identifier, no GPS, no
 * therapy/health data.
 *
 * @module views/Settings/weather/ConsentDialog
 */

import { useEffect, useState } from 'react';
import { Button, Dialog } from '@/components/ui';
import styles from './WeatherIntegrationPanel.module.css';

export interface ConsentDialogProps {
  readonly open: boolean;
  /** Fired when the dialog requests close (Esc / overlay / Cancel) — reverts. */
  readonly onCancel: () => void;
  /** Fired when the user acknowledges and confirms — enables + persists consentAt. */
  readonly onEnable: () => void;
}

/** A single "what leaves" row. */
function EgressRow({ children }: { children: React.ReactNode }) {
  return (
    <li className={styles.contractRow}>
      <span className={styles.egressGlyph} aria-hidden="true">
        ↗
      </span>
      <span>{children}</span>
    </li>
  );
}

/** A single "what stays" row. */
function RetainedRow({ children }: { children: React.ReactNode }) {
  return (
    <li className={styles.contractRow}>
      <span className={styles.lockGlyph} aria-hidden="true">
        🔒
      </span>
      <span>{children}</span>
    </li>
  );
}

export function ConsentDialog({ open, onCancel, onEnable }: ConsentDialogProps): JSX.Element {
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset the acknowledgement each time the dialog is (re)opened so a prior
  // session's checkbox state can never pre-satisfy the gate.
  useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title="Enable Weather & Air Quality"
      description="Fetch local weather and air-quality data from Open-Meteo to correlate with your therapy. This is the first feature that makes an outbound network request."
    >
      <div className={styles.consentBody}>
        <section className={styles.egressBlock} aria-labelledby="consent-egress-title">
          <h4 id="consent-egress-title" className={styles.contractTitle}>
            What leaves your device
          </h4>
          <ul className={styles.contractList}>
            <EgressRow>
              Your <strong>approximate location</strong> — coordinates rounded to about 1.1 km (2
              decimal places). Never GPS-precise.
            </EgressRow>
            <EgressRow>
              The <strong>calendar dates</strong> of the nights you choose to sync.
            </EgressRow>
            <EgressRow>
              Only if you use <strong>Find</strong>: the <strong>city name you type</strong> (a
              separate, disclosed lookup).
            </EgressRow>
          </ul>
        </section>

        <section className={styles.retainedBlock} aria-labelledby="consent-retained-title">
          <h4 id="consent-retained-title" className={styles.contractTitle}>
            What never leaves your device
          </h4>
          <ul className={styles.contractList}>
            <RetainedRow>Any therapy or health data — none of it is sent.</RetainedRow>
            <RetainedRow>
              Any identifier — there is no account and no API key with Open-Meteo.
            </RetainedRow>
            <RetainedRow>Your precise GPS coordinates.</RetainedRow>
          </ul>
        </section>

        <p className={styles.consentFootnote}>
          Requests go only to Open-Meteo. We save the date you agreed (a consent timestamp) so we
          can re-ask if what gets sent ever changes.
        </p>

        <label className={styles.consentAck}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            aria-label="I understand what is sent and agree to enable the weather integration"
          />
          <span>I understand what is sent and want to enable this.</span>
        </label>

        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onEnable} disabled={!acknowledged}>
            Enable
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
