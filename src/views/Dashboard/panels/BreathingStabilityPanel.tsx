/**
 * Breathing-stability insight card — surfaces the TECSA trajectory for the
 * dashboard's active date range, framed in the calm cyan→indigo→violet detection
 * register. NEVER status-severe red — TECSA is a trajectory, not an alarm
 * (visual spec).
 *
 * v1 deliberately defers per-night PB/CSR enumeration (which would require
 * loading flow signal for every night at dashboard load) and reads only the
 * cheap TECSA classifier output. A follow-up workstream can layer a "last
 * night: N candidate episodes" line by reading the breathing-episode module
 * cache after the per-session viewer has populated it.
 *
 * Per ADR 0017: candidate flag, never diagnosis.
 *
 * @module views/Dashboard/panels/BreathingStabilityPanel
 */

import React from 'react';
import { Link } from 'react-router-dom';

import type { TecsaClassification } from '@/analysis/breathing';
import { tecsaPresentation } from '@/analysis/breathing';
import { TecsaClassBadge } from '@/components/domain/Breathing';
import { Card } from '@/components/ui';
import { useAnalysis } from '@/hooks/useAnalysis';

import styles from './BreathingStabilityPanel.module.css';

const TITLE = 'Breathing stability';
const LINK = '/explore/breathing';

interface BreathingStabilityPanelProps {
  /** External loading flag; when true the dashboard is still hydrating. */
  readonly loading?: boolean;
}

const BreathingStabilityPanel = React.memo(function BreathingStabilityPanel({
  loading: externalLoading = false,
}: BreathingStabilityPanelProps) {
  const { data, loading, error } = useAnalysis<TecsaClassification>({
    type: 'tecsa-classification',
    enabled: !externalLoading,
  });

  const isLoading = externalLoading || loading;

  if (isLoading) {
    return (
      <Card className={styles.card} aria-label={TITLE}>
        <h3 className={styles.title}>{TITLE}</h3>
        <div className={styles.skeleton} aria-hidden="true" />
        <p className={styles.subtle}>Computing trajectory classification…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={styles.card} aria-label={TITLE}>
        <h3 className={styles.title}>{TITLE}</h3>
        <p className={styles.error}>{error}</p>
      </Card>
    );
  }

  if (!data || !data.available || !data.class) {
    const earlyN = data?.earlyNights ?? 0;
    const lateN = data?.lateNights ?? 0;
    return (
      <Card className={styles.card} aria-label={TITLE}>
        <h3 className={styles.title}>{TITLE}</h3>
        <p className={styles.subtle}>
          Insufficient history to classify the TECSA trajectory ({earlyN} early / {lateN} late
          usable nights in range).
        </p>
        <Link to={LINK} className={styles.link}>
          Open Breathing patterns →
        </Link>
      </Card>
    );
  }

  const presentation = tecsaPresentation(data.class);

  return (
    <Card className={styles.card} aria-label={TITLE} data-tecsa-class={data.class}>
      <div className={styles.header}>
        <h3 className={styles.title}>{TITLE}</h3>
        <span className={styles.candidateTag} aria-hidden="true">
          candidate
        </span>
      </div>

      <div className={styles.badgeRow}>
        <TecsaClassBadge tecsaClass={data.class} showSubtitle />
      </div>

      <p className={styles.copy}>{presentation.explainer}</p>

      <dl className={styles.kpis}>
        <div>
          <dt>Early CAI</dt>
          <dd>{data.earlyCai.toFixed(1)}/h</dd>
        </div>
        <div>
          <dt>Late CAI</dt>
          <dd>{data.lateCai.toFixed(1)}/h</dd>
        </div>
        <div>
          <dt>Threshold</dt>
          <dd>{data.caiThreshold.toFixed(1)}/h</dd>
        </div>
      </dl>

      <Link to={LINK} className={styles.link}>
        Open Breathing patterns →
      </Link>
    </Card>
  );
});

export default BreathingStabilityPanel;
