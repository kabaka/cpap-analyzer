/**
 * Distributions + event-stack row — a 1fr / 1fr / 1.4fr grid combining the AHI
 * histogram, the leak-spread box plot, and the per-night event mix.
 *
 * @module views/Dashboard/signalDeck/DistributionsRow
 */

import type { NightlyAggregate } from '@/types';

import AhiHistogramPanel from './AhiHistogramPanel';
import EventMixPanel from './EventMixPanel';
import LeakSpreadPanel from './LeakSpreadPanel';
import styles from './SignalDeck.module.css';

export interface DistributionsRowProps {
  readonly aggregates: readonly NightlyAggregate[];
}

export function DistributionsRow({ aggregates }: DistributionsRowProps): JSX.Element {
  return (
    <div className={styles.distributionsGrid}>
      <AhiHistogramPanel aggregates={aggregates} />
      <LeakSpreadPanel aggregates={aggregates} />
      <EventMixPanel aggregates={aggregates} />
    </div>
  );
}

export default DistributionsRow;
