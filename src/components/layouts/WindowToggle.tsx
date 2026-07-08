/**
 * Global time-window control for the command strip.
 *
 * The single global range control (spec B3): a `solid`+`sm` SegmentedControl of
 * five presets (7D/30D/90D/6M/12M) plus a Custom button that opens a date
 * popover. Both write the shared `useAppStore.dateRange`, and the active preset
 * is DERIVED from the stored range's day-span (mirroring SignalDeck's
 * `activeWindow`) so the toggle reflects whatever set the range — a preset
 * click, a custom pick, or a URL restore. When the range matches no preset the
 * segmented shows no selection and the Custom button reads active.
 *
 * @module components/layouts/WindowToggle
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Popover, SegmentedControl, type SegmentedControlOption } from '@/components/ui';
import { useAppStore } from '@/stores/useAppStore';
import { getDB } from '@/services/storage/getDB';
import { formatDate, parseLocalDate } from '@/utils/formatDate';
import styles from './WindowToggle.module.css';

type Preset = '7d' | '30d' | '90d' | '6m' | '12m';
type WindowValue = Preset | 'custom';

/** Day-span for each preset. Also the basis for deriving the active preset. */
const PRESET_DAYS: Record<Preset, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '6m': 182,
  '12m': 365,
};

const PRESET_OPTIONS: SegmentedControlOption<WindowValue>[] = [
  { value: '7d', label: '7D', ariaLabel: 'Last 7 days' },
  { value: '30d', label: '30D', ariaLabel: 'Last 30 days' },
  { value: '90d', label: '90D', ariaLabel: 'Last 90 days' },
  { value: '6m', label: '6M', ariaLabel: 'Last 6 months' },
  { value: '12m', label: '12M', ariaLabel: 'Last 12 months' },
];

interface QuickRange {
  readonly key: string;
  readonly label: string;
  /** Number of days back from today, or 'all' for the full corpus. */
  readonly days: number | 'all';
}

const QUICK_RANGES: readonly QuickRange[] = [
  { key: '14d', label: 'Last 14 days', days: 14 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '6m', label: 'Last 6 months', days: 182 },
  { key: 'all', label: 'All data', days: 'all' },
];

/** Midnight-anchored date `days` before now (mirrors SignalDeck/DateRangeSelector). */
function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

/** Which preset a stored range represents (by exact day-span), else 'custom'. */
function derivePreset(range: { start: Date; end: Date }): WindowValue {
  const diffDays = Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000);
  const match = (Object.keys(PRESET_DAYS) as Preset[]).find((p) => PRESET_DAYS[p] === diffDays);
  return match ?? 'custom';
}

/**
 * Lazily resolve the earliest imported night (for the custom-range `min` clamp
 * and the "All data" quick range). Fetches ONCE, only after the popover is first
 * opened — a deliberate user action — so the always-mounted header never runs a
 * corpus-wide query on load. Session records are metadata (no signal samples),
 * so this is bounded by night count. Extent is a nicety; failures are ignored.
 */
function useCorpusStart(enabled: boolean): string | null {
  const [start, setStart] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (!enabled || attempted.current) return;
    attempted.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const db = await getDB();
        const sessions = await db.getAllSessions();
        if (cancelled) return;
        const dates = sessions.filter((s) => !s.deleted).map((s) => s.date);
        if (dates.length === 0) return;
        setStart(dates.reduce((a, b) => (a < b ? a : b)));
      } catch {
        // Extent clamp is non-essential; leave unclamped on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return start;
}

export function WindowToggle() {
  const dateRange = useAppStore((s) => s.dateRange);
  const setDateRange = useAppStore((s) => s.setDateRange);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);

  const [open, setOpen] = useState(false);
  const corpusStart = useCorpusStart(open);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  const activePreset = useMemo(() => derivePreset(dateRange), [dateRange]);
  const isCustom = activePreset === 'custom';
  const today = formatDate(new Date());

  const applyPreset = useCallback(
    (value: WindowValue) => {
      if (value === 'custom') return;
      setDateRange({ start: daysAgo(PRESET_DAYS[value]), end: new Date() });
    },
    [setDateRange],
  );

  const applyQuick = useCallback(
    (days: number | 'all') => {
      if (days === 'all') {
        const start = corpusStart ? parseLocalDate(corpusStart) : null;
        setDateRange({ start: start ?? daysAgo(365), end: new Date() });
      } else {
        setDateRange({ start: daysAgo(days), end: new Date() });
      }
      setOpen(false);
    },
    [corpusStart, setDateRange],
  );

  const applyCustom = useCallback(() => {
    const startValue = startRef.current?.value;
    const endValue = endRef.current?.value;
    if (!startValue || !endValue) return;
    const start = parseLocalDate(startValue);
    const end = parseLocalDate(endValue);
    // Apply requires a valid, non-inverted range (start <= end).
    if (!start || !end || start.getTime() > end.getTime()) return;
    setDateRange({ start, end });
    setOpen(false);
  }, [setDateRange]);

  const customTrigger = (
    <button
      type="button"
      // Radix Popover.Trigger merges aria-haspopup/expanded/controls via asChild;
      // we only own the accessible name + visual state classes.
      aria-label="Custom date range"
      className={[
        styles.customBtn,
        isCustom ? styles.customBtnActive : null,
        open ? styles.customBtnOpen : null,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon name="calendar" style={{ width: '13px', height: '13px' }} />
      <span>Custom</span>
      <span className={styles.caret} aria-hidden="true">
        {open ? '▲' : '▼'}
      </span>
    </button>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.presets}>
        <SegmentedControl<WindowValue>
          label="Time window"
          options={PRESET_OPTIONS}
          value={activePreset}
          onChange={applyPreset}
          variant="solid"
          size="sm"
        />
      </div>
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="bottom"
        align="end"
        sideOffset={8}
        elevated
        contentClassName={styles.popoverPanel}
        trigger={customTrigger}
      >
        <div className={styles.popover}>
          <p className={styles.popTitle}>Custom range</p>
          <div className={styles.fields}>
            <label className={styles.field}>
              Start
              <input
                ref={startRef}
                type="date"
                defaultValue={formatDate(dateRange.start)}
                min={corpusStart ?? undefined}
                max={today}
                className={styles.dateInput}
                style={{ colorScheme: resolvedTheme }}
              />
            </label>
            <label className={styles.field}>
              End
              <input
                ref={endRef}
                type="date"
                defaultValue={formatDate(dateRange.end)}
                min={corpusStart ?? undefined}
                max={today}
                className={styles.dateInput}
                style={{ colorScheme: resolvedTheme }}
              />
            </label>
          </div>
          <p className={styles.popTitle}>Quick ranges</p>
          <div className={styles.quickRow}>
            {QUICK_RANGES.map((q) => (
              <button
                key={q.key}
                type="button"
                className={styles.quickBtn}
                onClick={() => applyQuick(q.days)}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className={styles.applyBtn} onClick={applyCustom}>
              Apply
            </button>
          </div>
        </div>
      </Popover>
    </div>
  );
}
