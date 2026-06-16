import { metricMap } from '@/content/help';
import { reliabilityTierLabel } from '@/analysis/uncertainty';
import { Tooltip } from '@/components/ui';
import type { ReactNode } from 'react';
import styles from './MetricTooltip.module.css';

interface MetricTooltipProps {
  /** The metric identifier key (must match an entry in metricDefinitions) */
  metricId: string;
  /** The trigger element (typically a metric label) */
  children: ReactNode;
  /** Tooltip placement */
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * Contextual tooltip for metric labels.
 * Wraps Radix Tooltip and looks up content from the metric registry.
 */
export function MetricTooltip({ metricId, children, side = 'top' }: MetricTooltipProps) {
  const metric = metricMap.get(metricId);

  if (!metric) {
    return <>{children}</>;
  }

  const content = (
    <div className={styles.tooltipContent}>
      <div className={styles.header}>
        <span className={styles.label}>{metric.label}</span>
        <span className={styles.unit}>{metric.unit}</span>
      </div>
      <p className={styles.description}>{metric.tooltip}</p>
      <p className={styles.interpretation}>{metric.interpretation}</p>
      {metric.reliability && (
        <p className={styles.reliability}>
          <span className={styles.reliabilityLabel}>
            {reliabilityTierLabel(metric.reliability.tier)}
          </span>{' '}
          {metric.reliability.note}
        </p>
      )}
    </div>
  );

  return (
    <Tooltip content={content} side={side}>
      <button type="button" className={styles.trigger} aria-label={`Help for ${metric.label}`}>
        {children}
      </button>
    </Tooltip>
  );
}
