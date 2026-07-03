/**
 * Vertical settings-change markers shared across every Trends chart.
 *
 * The Trends view detects machine-settings changes between consecutive nights
 * via {@link detectSettingsChanges}. Each change is drawn as a faint dashed
 * vertical line. Now that the charts render on a Canvas2D base, these markers are
 * an SVG OVERLAY positioned over the canvas (so the canvas stays a pure raster
 * plot): each marker keeps its native `<title>` + `aria-label` hover affordance
 * surfacing the human-readable diff (`"max 12 → 15"`), exactly as before, plus an
 * invisible wider hit-rect so a casual mouseover lands the tooltip without
 * pixel-hunting the 1px line.
 *
 * The markers sit at the category's X position. For point-scale charts (every
 * non-bar Trends chart) that is the `scalePoint` coordinate; for the bar chart
 * (Usage) it is the band CENTRE. The component computes this from the same
 * category geometry the Canvas renderer uses, so a marker lands on the same pixel
 * column the dashed Recharts `ReferenceLine` used to.
 *
 * @module views/Trends/charts/SettingsChangeMarkers
 */

import React from 'react';
import { describeSettingsChange } from '../utils/formatSettingsChange';
import type { SettingsChange } from '../utils/detectSettingsChanges';
import type { ChartMargins } from './canvas/TrendsCanvasChart';

interface SettingsMarkerOverlayProps {
  readonly changes: readonly SettingsChange[];
  /** The night rows, in render order, for date → index mapping. */
  readonly data: readonly { readonly date: string }[];
  /** Same margins the Canvas chart uses (so X math matches the plot). */
  readonly margins: ChartMargins;
  /** Resolved stroke colour. */
  readonly stroke: string;
  /** True for the bar chart (band-centre placement); false for point scales. */
  readonly isBand?: boolean;
  /** Optional explicit top inset for the line (defaults to `margins.top`). */
  readonly top?: number;
  /** Optional explicit bottom inset for the line (defaults to `margins.bottom`). */
  readonly bottom?: number;
}

/**
 * SVG overlay of dashed vertical settings-change markers, absolutely positioned
 * to fill the chart area. Uses a percentage-free pixel layout via a
 * 100%-stretched SVG with a viewBox set to the live pixel size is avoided —
 * instead each marker's X is expressed as a CSS `calc()` over the plot width so
 * it tracks responsively without measuring the DOM.
 */
export const SettingsMarkerOverlay = React.memo(function SettingsMarkerOverlay({
  changes,
  data,
  margins,
  stroke,
  isBand = false,
  top,
  bottom,
}: SettingsMarkerOverlayProps) {
  if (changes.length === 0 || data.length === 0) return null;

  const count = data.length;
  const indexOf = (date: string): number => data.findIndex((d) => d.date === date);

  const lineTop = top ?? margins.top;
  const lineBottomInset = bottom ?? margins.bottom;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden={false}>
      {changes.map((sc) => {
        const idx = indexOf(sc.date);
        if (idx < 0) return null;
        const summary = describeSettingsChange(sc);
        const tooltip = `${sc.date}: ${summary}`;
        // X within the plot, as a calc() over the responsive plot width.
        // For a point scale: pointX with a normalized 0..1 plot. For a band
        // scale: band centre. We express the fraction along the plot width.
        const frac = isBand
          ? // band centre fraction = (i + 0.5) / count
            (idx + 0.5) / count
          : // point fraction = i / (count - 1), single category centred.
            count <= 1
            ? 0.5
            : idx / (count - 1);
        const leftCalc = `calc(${margins.left}px + (100% - ${margins.left + margins.right}px) * ${frac})`;
        return (
          <div
            key={`sc-${sc.date}`}
            style={{
              position: 'absolute',
              top: lineTop,
              bottom: lineBottomInset,
              left: leftCalc,
              width: 0,
              pointerEvents: 'none',
            }}
          >
            {/* Visible dashed line. */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: 0,
                borderLeft: `1px dashed ${stroke}`,
                opacity: 0.5,
              }}
            />
            {/* Invisible wider hover target carrying the native title + label. */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: -4,
                width: 8,
                pointerEvents: 'auto',
                cursor: 'help',
              }}
              title={tooltip}
              aria-label={tooltip}
              role="img"
            />
          </div>
        );
      })}
    </div>
  );
});
