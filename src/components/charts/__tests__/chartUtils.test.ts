import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useChartColors, paletteColor } from '@/components/charts/useChartColors';
import type { ChartColors } from '@/components/charts/useChartColors';
import { useAppStore } from '@/stores/useAppStore';

describe('useChartColors', () => {
  beforeEach(() => {
    // Reset the app store to a known theme state
    useAppStore.setState({ resolvedTheme: 'light' });
  });

  it('should return an object with all expected colour keys', () => {
    const { result } = renderHook(() => useChartColors());
    const colors = result.current;

    expect(colors).toHaveProperty('chart1');
    expect(colors).toHaveProperty('chart2');
    expect(colors).toHaveProperty('chart3');
    expect(colors).toHaveProperty('chart4');
    expect(colors).toHaveProperty('chart5');
    expect(colors).toHaveProperty('chart6');
    expect(colors).toHaveProperty('chart7');
    expect(colors).toHaveProperty('chart8');
    expect(colors).toHaveProperty('grid');
    expect(colors).toHaveProperty('axis');
    expect(colors).toHaveProperty('tooltipBg');
    expect(colors).toHaveProperty('tooltipBorder');
    expect(colors).toHaveProperty('textPrimary');
    expect(colors).toHaveProperty('textSecondary');
    expect(colors).toHaveProperty('surfacePrimary');
  });

  it('should return strings for all colour values', () => {
    const { result } = renderHook(() => useChartColors());
    const colors = result.current;

    for (const [, value] of Object.entries(colors)) {
      expect(typeof value).toBe('string');
    }
  });

  it('should return empty strings in jsdom (no CSS custom properties defined)', () => {
    const { result } = renderHook(() => useChartColors());

    // In jsdom, getComputedStyle returns empty for custom properties
    expect(result.current.chart1).toBe('');
  });
});

describe('paletteColor', () => {
  const colors: ChartColors = {
    chart1: '#ff0000',
    chart2: '#00ff00',
    chart3: '#0000ff',
    chart4: '#ffff00',
    chart5: '#ff00ff',
    chart6: '#00ffff',
    chart7: '#888888',
    chart8: '#444444',
    grid: '#cccccc',
    axis: '#333333',
    tooltipBg: '#ffffff',
    tooltipBorder: '#dddddd',
    textPrimary: '#000000',
    textSecondary: '#666666',
    surfacePrimary: '#fafafa',
  };

  it('should return the correct colour for index 0', () => {
    expect(paletteColor(colors, 0)).toBe('#ff0000');
  });

  it('should return the correct colour for index 7', () => {
    expect(paletteColor(colors, 7)).toBe('#444444');
  });

  it('should wrap around when index exceeds palette length', () => {
    // index 8 should wrap to chart1 (index 0)
    expect(paletteColor(colors, 8)).toBe('#ff0000');
    // index 9 should wrap to chart2 (index 1)
    expect(paletteColor(colors, 9)).toBe('#00ff00');
  });

  it('should handle large indices by wrapping', () => {
    // index 16 → 16 % 8 = 0 → chart1
    expect(paletteColor(colors, 16)).toBe('#ff0000');
    // index 19 → 19 % 8 = 3 → chart4
    expect(paletteColor(colors, 19)).toBe('#ffff00');
  });
});
