/**
 * Gate-2 cloud-egress consent dialog for AI Insights (the second gate; the first
 * is the per-backend "use a cloud backend" choice).
 *
 * Mirrors `src/views/Settings/weather/ConsentDialog.tsx` and reuses the weather
 * panel's consent classes verbatim (visual spec §4): a blue "What leaves your
 * device" block (↗ glyph rows), a green "What never leaves" block (🔒 glyph
 * rows), a footnote, and an acknowledgement checkbox that gates the **Enable**
 * button. Cancel / Esc / overlay all revert via `onCancel` and persist nothing.
 *
 * Copy is the EXACT contract from `docs/design/ai-insights-ux.md` §7.2 (the
 * privacy contract `security` audits). The `<Backend>` placeholder is filled
 * from {@link ConsentDialogProps.backendName}. The AI-specific delta from
 * weather is the blue emphasis line: this is the only AI option that egresses;
 * on-device options send nothing.
 *
 * On an acknowledged Enable the caller writes `consentAt` (ISO timestamp) and
 * `consentContractVersion = EGRESS_CONTRACT_VERSION` (UX §3.8).
 *
 * @module views/Settings/ai/ConsentDialog
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog } from '@/components/ui';
// Reuse the weather panel's consent styles verbatim (visual spec §4).
import weatherStyles from '../weather/WeatherIntegrationPanel.module.css';
import styles from './AiInsightsPanel.module.css';

export interface ConsentDialogProps {
  readonly open: boolean;
  /**
   * Display name of the cloud backend the snapshot is sent to (e.g. "Claude",
   * "OpenAI-compatible"). Filled into the `<Backend>` placeholders.
   */
  readonly backendName: string;
  /** Fired when the dialog requests close (Esc / overlay / Cancel) — reverts. */
  readonly onCancel: () => void;
  /** Fired when the user acknowledges and confirms — caller persists consentAt + version. */
  readonly onEnable: () => void;
}

/** A single "what leaves" row. */
function EgressRow({ children }: { children: ReactNode }) {
  return (
    <li className={weatherStyles.contractRow}>
      <span className={weatherStyles.egressGlyph} aria-hidden="true">
        ↗
      </span>
      <span>{children}</span>
    </li>
  );
}

/** A single "what stays" row. */
function RetainedRow({ children }: { children: ReactNode }) {
  return (
    <li className={weatherStyles.contractRow}>
      <span className={weatherStyles.lockGlyph} aria-hidden="true">
        🔒
      </span>
      <span>{children}</span>
    </li>
  );
}

export function ConsentDialog({
  open,
  backendName,
  onCancel,
  onEnable,
}: ConsentDialogProps): JSX.Element {
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset acknowledgement each time the dialog (re)opens so a prior session's
  // checkbox state can never pre-satisfy the gate.
  useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={`Send metric summaries to ${backendName}?`}
      description={`To write summaries with ${backendName}, a small snapshot of your already-computed numbers is sent to ${backendName} using your own API key. This is the only AI option that sends anything off your device. On-device options send nothing.`}
    >
      <div className={weatherStyles.consentBody}>
        {/* AI-specific emphasis line (visual spec §4): reuse the blue egress-reminder treatment. */}
        <p className={weatherStyles.syncEgressReminder}>
          This is the only AI option that sends anything off your device. On-device options send
          nothing.
        </p>

        <section className={weatherStyles.egressBlock} aria-labelledby="ai-consent-egress-title">
          <h4 id="ai-consent-egress-title" className={weatherStyles.contractTitle}>
            What leaves your device
          </h4>
          <ul className={weatherStyles.contractList}>
            <EgressRow>
              A compact summary of the metrics already shown on screen — values like AHI, leak,
              usage, pressure and event counts for the night or range you ask about. Rounded,
              aggregate numbers.
            </EgressRow>
            <EgressRow>The calendar date or date range you asked about.</EgressRow>
            <EgressRow>
              Your chosen units and thresholds, so the wording matches your settings.
            </EgressRow>
          </ul>
        </section>

        <section
          className={weatherStyles.retainedBlock}
          aria-labelledby="ai-consent-retained-title"
        >
          <h4 id="ai-consent-retained-title" className={weatherStyles.contractTitle}>
            What never leaves your device
          </h4>
          <ul className={weatherStyles.contractList}>
            <RetainedRow>
              Raw signals — no flow, pressure, leak, or SpO&#8322; waveforms, and no EDF files. None
              of it is sent.
            </RetainedRow>
            <RetainedRow>
              Any identifier — no name, email, or machine serial number. Requests carry only your
              own API key; there is no CPAP Analyzer account.
            </RetainedRow>
            <RetainedRow>Anything about nights you didn&apos;t ask about.</RetainedRow>
          </ul>
        </section>

        <p className={weatherStyles.consentFootnote}>
          Requests go only to {backendName}, on your own account and key. We save the date you
          agreed so we can re-ask if what gets sent ever changes.
        </p>

        <label className={weatherStyles.consentAck}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            aria-label={`I understand a summary of my computed metrics will be sent to ${backendName}, and I want to enable this.`}
          />
          <span>
            I understand a summary of my computed metrics will be sent to {backendName}, and I want
            to enable this.
          </span>
        </label>

        <div className={`${weatherStyles.dialogActions} ${styles.consentActions}`}>
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
