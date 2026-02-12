/**
 * Theme-aware Recharts scatter plot with optional regression line.
 *
 * @module components/charts/recharts/ThemedScatterPlot
 */

import React, { useMemo } from 'react';
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { paletteColor, useChartColors, type ChartColors } from '../useChartColors';
import tooltipStyles from './ThemedScatterPlot.module.css';

// ── Types ────────────────────────────────────────────────────────

export interface ScatterDataPoint {
  x: number;
  y: number;
  /** Optional category for colour-coding. */
  category?: string;
  [key: string]: unknown;
}

export interface ThemedScatterPlotProps {
  data: ScatterDataPoint[];
  xLabel?: string;
  yLabel?: string;
  height?: number;
  /** Field used to colour-code points. */
  categoryKey?: string;
  /** Show a simple linear regression line? */
  showRegression?: boolean;
  /** Fixed category→colour mapping — auto-assigned from palette if omitted. */
  categoryColors?: Record<string, string>;
}

// ── Helpers ──────────────────────────────────────────────────────

interface RegressionResult {
  slope: number;
  intercept: number;
  points: { x: number; y: number }[];
}

function linearRegression(points: ScatterDataPoint[]): RegressionResult | null {
  const n = points.length;
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const xMin = Math.min(...points.map((p) => p.x));
  const xMax = Math.max(...points.map((p) => p.x));

  return {
    slope,
    intercept,
    points: [
      { x: xMin, y: slope * xMin + intercept },
      { x: xMax, y: slope * xMax + intercept },
    ],
  };
}

function categoryMap(
  data: ScatterDataPoint[],
  categoryKey: string | undefined,
  customColors: Record<string, string> | undefined,
  colors: ChartColors,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!categoryKey) return map;

  const categories = [...new Set(data.map((d) => String(d[categoryKey] ?? 'Other')))];
  categories.forEach((cat, i) => {
    map.set(cat, customColors?.[cat] ?? paletteColor(colors, i));
  });
  return map;
}

// ── Custom Tooltip ───────────────────────────────────────────────

function ScatterTooltipContent({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as ScatterDataPoint | undefined;
  if (!point) return null;

  return (
    <div className={tooltipStyles.tooltip}>
      <div>
        <strong>x:</strong> {point.x}
      </div>
      <div>
        <strong>y:</strong> {point.y}
      </div>
      {point.category !== undefined && (
        <div>
          <strong>category:</strong> {point.category}
        </div>
      )}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────

const ThemedScatterPlot = React.memo(function ThemedScatterPlot({
  data,
  xLabel,
  yLabel,
  height = 300,
  categoryKey,
  showRegression = false,
  categoryColors,
}: ThemedScatterPlotProps) {
  const colors = useChartColors();

  const catMap = useMemo(
    () => categoryMap(data, categoryKey, categoryColors, colors),
    [data, categoryKey, categoryColors, colors],
  );

  const regression = useMemo(
    () => (showRegression ? linearRegression(data) : null),
    [data, showRegression],
  );

  if (!data || data.length === 0) {
    return null;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart margin={{ top: 8, right: 16, bottom: 32, left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
        <XAxis
          dataKey="x"
          type="number"
          tick={{ fill: colors.axis, fontSize: 12 }}
          stroke={colors.axis}
          name={xLabel}
          label={
            xLabel
              ? { value: xLabel, position: 'insideBottom', offset: -12, fill: colors.axis }
              : undefined
          }
        />
        <YAxis
          dataKey="y"
          type="number"
          tick={{ fill: colors.axis, fontSize: 12 }}
          stroke={colors.axis}
          name={yLabel}
          label={
            yLabel
              ? { value: yLabel, angle: -90, position: 'insideLeft', offset: 4, fill: colors.axis }
              : undefined
          }
        />
        <Tooltip
          content={<ScatterTooltipContent />}
          contentStyle={{
            backgroundColor: colors.tooltipBg,
            border: `1px solid ${colors.tooltipBorder}`,
          }}
        />
        {catMap.size > 0 && <Legend wrapperStyle={{ fontSize: 12 }} />}

        <Scatter data={data} fill={colors.chart1} isAnimationActive={false}>
          {categoryKey &&
            data.map((entry, i) => {
              const cat = String(entry[categoryKey] ?? 'Other');
              return <Cell key={`cell-${i}`} fill={catMap.get(cat) ?? colors.chart1} />;
            })}
        </Scatter>

        {regression && (
          <Line
            data={regression.points}
            dataKey="y"
            type="linear"
            stroke={colors.chart2}
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            isAnimationActive={false}
            legendType="none"
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
});

export default ThemedScatterPlot;
