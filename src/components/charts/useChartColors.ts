/**
 * Hook to read CSS custom property chart colors at runtime.
 *
 * Recharts requires resolved color strings (not CSS var() references),
 * so we pull them from the computed style of the document root.
 *
 * @module components/charts/useChartColors
 */

import { useMemo } from 'react';
import { useAppStore } from '@/stores/useAppStore';

export interface ChartColors {
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  chart6: string;
  chart7: string;
  chart8: string;
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  textPrimary: string;
  textSecondary: string;
  surfacePrimary: string;
  surfaceElevated: string;
  crosshair: string;
  // Wearable signal lanes
  wearableHr: string;
  wearableSpo2: string;
  wearableHrv: string;
  wearableSnore: string;
  // Hypnogram (sleep stage) bands
  hypnoWake: string;
  hypnoRem: string;
  hypnoLight: string;
  hypnoDeep: string;
  hypnoUnknown: string;
  // Detection-episode overlay
  detection: string;
  detectionBg: string;
  detectionBorder: string;
  // TECSA classification
  tecsaObstructive: string;
  tecsaTransient: string;
  tecsaPersistent: string;
  tecsaEmergent: string;
}

const PALETTE_KEYS: readonly (keyof ChartColors)[] = [
  'chart1',
  'chart2',
  'chart3',
  'chart4',
  'chart5',
  'chart6',
  'chart7',
  'chart8',
];

function readCSSVar(prop: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
}

function resolveColors(): ChartColors {
  return {
    chart1: readCSSVar('--color-chart-1'),
    chart2: readCSSVar('--color-chart-2'),
    chart3: readCSSVar('--color-chart-3'),
    chart4: readCSSVar('--color-chart-4'),
    chart5: readCSSVar('--color-chart-5'),
    chart6: readCSSVar('--color-chart-6'),
    chart7: readCSSVar('--color-chart-7'),
    chart8: readCSSVar('--color-chart-8'),
    grid: readCSSVar('--color-chart-grid'),
    axis: readCSSVar('--color-chart-axis'),
    tooltipBg: readCSSVar('--color-chart-tooltip-bg'),
    tooltipBorder: readCSSVar('--color-chart-tooltip-border'),
    textPrimary: readCSSVar('--color-text-primary'),
    textSecondary: readCSSVar('--color-text-secondary'),
    surfacePrimary: readCSSVar('--color-surface-primary'),
    surfaceElevated: readCSSVar('--color-surface-elevated'),
    crosshair: readCSSVar('--color-crosshair'),
    wearableHr: readCSSVar('--color-wearable-hr'),
    wearableSpo2: readCSSVar('--color-wearable-spo2'),
    wearableHrv: readCSSVar('--color-wearable-hrv'),
    wearableSnore: readCSSVar('--color-wearable-snore'),
    hypnoWake: readCSSVar('--color-hypno-wake'),
    hypnoRem: readCSSVar('--color-hypno-rem'),
    hypnoLight: readCSSVar('--color-hypno-light'),
    hypnoDeep: readCSSVar('--color-hypno-deep'),
    hypnoUnknown: readCSSVar('--color-hypno-unknown'),
    detection: readCSSVar('--color-detection'),
    detectionBg: readCSSVar('--color-detection-bg'),
    detectionBorder: readCSSVar('--color-detection-border'),
    tecsaObstructive: readCSSVar('--color-tecsa-obstructive'),
    tecsaTransient: readCSSVar('--color-tecsa-transient'),
    tecsaPersistent: readCSSVar('--color-tecsa-persistent'),
    tecsaEmergent: readCSSVar('--color-tecsa-emergent'),
  };
}

/**
 * Returns resolved chart colour strings that react to theme changes.
 * Re-computes whenever the resolved theme changes.
 */
export function useChartColors(): ChartColors {
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => resolveColors(), [resolvedTheme]);
}

/** Get the i-th palette colour (wraps around). */
export function paletteColor(colors: ChartColors, index: number): string {
  const key = PALETTE_KEYS[index % PALETTE_KEYS.length] ?? 'chart1';
  return colors[key];
}
