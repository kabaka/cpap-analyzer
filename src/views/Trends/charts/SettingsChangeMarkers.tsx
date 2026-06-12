/**
 * Vertical settings-change markers shared across every Trends chart.
 *
 * The Trends view detects machine-settings changes between consecutive nights
 * via {@link detectSettingsChanges}. Each change is rendered as a faint dashed
 * vertical Recharts {@link ReferenceLine}. We render a tiny SVG `<title>` per
 * marker so hovering the line surfaces the human-readable diff (`"max 12 →
 * 15"`); this is the lightest available hover affordance that does not
 * disrupt the existing crosshair sync between the synced charts.
 *
 * Recharts requires children of `ComposedChart` to be Recharts elements. We
 * return a React fragment of `ReferenceLine` elements rather than a custom
 * component wrapping them so the parent chart can keep them in its own
 * children tree (Recharts walks children by type at runtime).
 *
 * @module views/Trends/charts/SettingsChangeMarkers
 */

import { ReferenceLine } from 'recharts';
import type { ReactElement } from 'react';
import { describeSettingsChange } from '../utils/formatSettingsChange';
import type { SettingsChange } from '../utils/detectSettingsChanges';

interface RenderMarkersOptions {
  /** Stroke colour to apply to each marker. */
  readonly stroke: string;
  /** Optional `yAxisId` to bind the line to (multi-axis charts). */
  readonly yAxisId?: string;
}

/**
 * Shape recharts passes into a `ReferenceLine` custom shape renderer for
 * vertical lines (x-bound). We only depend on a handful of fields, all of
 * which are present on Recharts' internal shape props.
 */
interface ReferenceLineShapeProps {
  readonly x1?: number;
  readonly x2?: number;
  readonly y1?: number;
  readonly y2?: number;
  readonly stroke?: string;
  readonly strokeDasharray?: string;
  readonly strokeOpacity?: number;
}

/**
 * Build a faint-dashed vertical `ReferenceLine` for every settings change.
 *
 * Each marker is a custom shape: a visible dashed line plus an invisible
 * wider `<rect>` that carries an SVG `<title>` for native-tooltip hover. This
 * gives users the change summary (`"max 12.0 → 15.0"`) on hover without
 * disrupting the recharts crosshair sync (the recharts mouse handlers on the
 * `ComposedChart` see the rect as part of the chart, not a separate target).
 *
 * Designed to be spread inline into a `ComposedChart` child tree because
 * Recharts walks children by element type at render time.
 */
export function renderSettingsChangeMarkers(
  changes: readonly SettingsChange[],
  { stroke, yAxisId }: RenderMarkersOptions,
): readonly ReactElement[] {
  return changes.map((sc) => {
    const summary = describeSettingsChange(sc);
    const tooltip = `${sc.date}: ${summary}`;
    return (
      <ReferenceLine
        key={`sc-${sc.date}`}
        x={sc.date}
        stroke={stroke}
        strokeDasharray="4 4"
        strokeOpacity={0.5}
        ifOverflow="extendDomain"
        {...(yAxisId !== undefined ? { yAxisId } : {})}
        shape={(props: ReferenceLineShapeProps) => {
          const {
            x1 = 0,
            x2 = 0,
            y1 = 0,
            y2 = 0,
            stroke: s = stroke,
            strokeDasharray = '4 4',
            strokeOpacity = 0.5,
          } = props;
          const hitWidth = 8;
          const left = Math.min(x1, x2) - hitWidth / 2;
          const top = Math.min(y1, y2);
          const height = Math.abs(y2 - y1);
          return (
            <g aria-label={tooltip}>
              <title>{tooltip}</title>
              <line
                x1={x1}
                x2={x2}
                y1={y1}
                y2={y2}
                stroke={s}
                strokeDasharray={strokeDasharray}
                strokeOpacity={strokeOpacity}
              />
              {/* Invisible wider hover target so the native <title> tooltip
                  surfaces on a casual mouseover without the user having to
                  pixel-hunt the 1px dashed line. */}
              <rect
                x={left}
                y={top}
                width={hitWidth}
                height={height}
                fill="transparent"
                pointerEvents="visible"
              />
            </g>
          );
        }}
      />
    );
  });
}
