/**
 * Wearable correlation lanes — resting HR, SpO₂ min, and HRV rmssd sparklines
 * aligned to therapy nights.
 *
 * Each lane's series is the nightly wearable value aligned to the deck window
 * (`null` where no sample exists that night — a gap, never `0`); the current
 * value is the null-skipping {@link seriesMean}. Colours come from the wearable
 * signal tokens. The parent only mounts this panel when wearable data exists.
 *
 * @module views/Dashboard/signalDeck/WearableLanes
 */

import { useChartColors } from '@/components/charts/useChartColors';

import Sparkline from './Sparkline';
import { seriesMean } from './metrics';
import styles from './WearableLanes.module.css';

export interface WearableLanesProps {
  /** Nightly resting-HR series aligned to the window (`null` = no sample). */
  readonly hrSeries: readonly (number | null)[];
  /** Nightly minimum-SpO₂ series aligned to the window. */
  readonly spo2Series: readonly (number | null)[];
  /** Nightly HRV rmssd series aligned to the window. */
  readonly hrvSeries: readonly (number | null)[];
}

interface Lane {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly unit: string;
  readonly values: readonly (number | null)[];
  readonly mean: number | null;
}

function fmtMean(value: number | null): string {
  return value === null ? '—' : String(Math.round(value));
}

export function WearableLanes({
  hrSeries,
  spo2Series,
  hrvSeries,
}: WearableLanesProps): JSX.Element {
  const colors = useChartColors();

  const lanes: Lane[] = [
    {
      key: 'hr',
      label: 'Resting HR',
      color: colors.wearableHr,
      unit: 'bpm',
      values: hrSeries,
      mean: seriesMean(hrSeries),
    },
    {
      key: 'spo2',
      label: 'SpO₂ min',
      color: colors.wearableSpo2,
      unit: '%',
      values: spo2Series,
      mean: seriesMean(spo2Series),
    },
    {
      key: 'hrv',
      label: 'HRV rmssd',
      color: colors.wearableHrv,
      unit: 'ms',
      values: hrvSeries,
      mean: seriesMean(hrvSeries),
    },
  ];

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Wearable correlation lanes</h2>
        <span className={styles.sub}>aligned to nights</span>
      </div>
      <div className={styles.lanes}>
        {lanes.map((lane) => (
          <div key={lane.key} className={styles.lane}>
            <span className={styles.laneLabel} style={{ color: lane.color }}>
              {lane.label}
            </span>
            <div className={styles.laneSpark}>
              <Sparkline
                values={lane.values}
                color={lane.color}
                width={400}
                height={30}
                fill
                dotRadius={2}
                ariaLabel={`${lane.label} trend, current ${fmtMean(lane.mean)} ${lane.unit}`}
              />
            </div>
            <span className={styles.laneValue}>
              {fmtMean(lane.mean)}
              <span className={styles.laneUnit}> {lane.unit}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default WearableLanes;
