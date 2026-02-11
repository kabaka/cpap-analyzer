/**
 * Date range selector component.
 *
 * Provides preset date range options (7d, 30d, 90d, 1y, all) connected
 * to the global app store's dateRange.
 *
 * @module components/domain/DateRangeSelector
 */

import { useCallback, useMemo } from 'react';
import { Select } from '@/components/ui';
import { useAppStore } from '@/stores/useAppStore';
import styles from './DateRangeSelector.module.css';

type PresetKey = '7d' | '30d' | '90d' | '1y' | 'all';

interface PresetOption {
  value: PresetKey;
  label: string;
  getDates: () => { start: Date; end: Date };
}

const PRESETS: PresetOption[] = [
  {
    value: '7d',
    label: 'Last 7 days',
    getDates: () => ({
      start: daysAgo(7),
      end: new Date(),
    }),
  },
  {
    value: '30d',
    label: 'Last 30 days',
    getDates: () => ({
      start: daysAgo(30),
      end: new Date(),
    }),
  },
  {
    value: '90d',
    label: 'Last 90 days',
    getDates: () => ({
      start: daysAgo(90),
      end: new Date(),
    }),
  },
  {
    value: '1y',
    label: 'Last year',
    getDates: () => ({
      start: daysAgo(365),
      end: new Date(),
    }),
  },
  {
    value: 'all',
    label: 'All time',
    getDates: () => ({
      start: new Date('2000-01-01'),
      end: new Date(),
    }),
  },
];

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

export function DateRangeSelector() {
  const dateRange = useAppStore((s) => s.dateRange);
  const setDateRange = useAppStore((s) => s.setDateRange);

  // Determine which preset is currently active based on the date range
  const activePreset = useMemo((): PresetKey => {
    const diffMs = dateRange.end.getTime() - dateRange.start.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 8) return '7d';
    if (diffDays <= 31) return '30d';
    if (diffDays <= 91) return '90d';
    if (diffDays <= 366) return '1y';
    return 'all';
  }, [dateRange]);

  const handleChange = useCallback(
    (value: string) => {
      const preset = PRESETS.find((p) => p.value === value);
      if (preset) {
        setDateRange(preset.getDates());
      }
    },
    [setDateRange],
  );

  const selectOptions = PRESETS.map((p) => ({
    value: p.value,
    label: p.label,
  }));

  return (
    <div className={styles.wrapper}>
      <Select
        label="Date range"
        options={selectOptions}
        value={activePreset}
        onValueChange={handleChange}
      />
    </div>
  );
}
