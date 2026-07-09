/**
 * Global time-window control for the command strip.
 *
 * The single global range control (spec B3). It is responsive:
 *
 * - **Desktop (≥768px)** — a `solid`+`sm` SegmentedControl of five presets
 *   (7D/30D/90D/6M/12M) plus a Custom button that opens a date popover.
 * - **Mobile (<768px)** — the header is too cramped for the horizontal segment,
 *   so the same choices collapse into a compact command-surface menu: a small
 *   button showing the active window label opens a Popover whose radiogroup lists
 *   the five presets plus a "Custom range…" entry that reveals the same date
 *   fields. Touch users can therefore still change the analysis window.
 *
 * Both surfaces write the shared `useAppStore.dateRange` through the SAME
 * handlers (no per-surface range logic), and the active preset is DERIVED from
 * the stored range's day-span (mirroring SignalDeck's `activeWindow`) so the
 * control reflects whatever set the range — a preset click, a custom pick, or a
 * URL restore. When the range matches no preset the segmented shows no selection
 * and the Custom affordance reads active.
 *
 * @module components/layouts/WindowToggle
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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
 * and the "All data" quick range). Fetches ONCE, only after a picker is first
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

interface CustomRangeFieldsProps {
  readonly defaultStart: string;
  readonly defaultEnd: string;
  readonly min: string | undefined;
  readonly max: string;
  readonly colorScheme: 'light' | 'dark';
  readonly quickRanges: readonly QuickRange[];
  /** Called with a validated, non-inverted range (start ≤ end). */
  readonly onApply: (start: Date, end: Date) => void;
  readonly onQuick: (days: number | 'all') => void;
  readonly onCancel: () => void;
  /** Label for the dismiss button (desktop: "Cancel"; mobile back: "Back"). */
  readonly cancelLabel?: string;
}

/**
 * The custom-range panel body (Start/End inputs, quick ranges, Cancel/Apply).
 * Extracted so the desktop Custom popover and the mobile menu render the SAME
 * markup + validation from a single source of truth. It owns its own input refs
 * (each mounted instance is independent) and defers the commit to `onApply` —
 * the parent decides which popover to close. Apply is a no-op for an empty or
 * inverted range, so the picker stays open for correction (the caller's popover
 * only closes when `onApply` actually fires).
 */
function CustomRangeFields({
  defaultStart,
  defaultEnd,
  min,
  max,
  colorScheme,
  quickRanges,
  onApply,
  onQuick,
  onCancel,
  cancelLabel = 'Cancel',
}: CustomRangeFieldsProps) {
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  const handleApply = useCallback(() => {
    const startValue = startRef.current?.value;
    const endValue = endRef.current?.value;
    if (!startValue || !endValue) return;
    const start = parseLocalDate(startValue);
    const end = parseLocalDate(endValue);
    // Apply requires a valid, non-inverted range (start <= end).
    if (!start || !end || start.getTime() > end.getTime()) return;
    onApply(start, end);
  }, [onApply]);

  return (
    <div className={styles.popover}>
      <p className={styles.popTitle}>Custom range</p>
      <div className={styles.fields}>
        <label className={styles.field}>
          Start
          <input
            ref={startRef}
            type="date"
            defaultValue={defaultStart}
            min={min}
            max={max}
            className={styles.dateInput}
            style={{ colorScheme }}
          />
        </label>
        <label className={styles.field}>
          End
          <input
            ref={endRef}
            type="date"
            defaultValue={defaultEnd}
            min={min}
            max={max}
            className={styles.dateInput}
            style={{ colorScheme }}
          />
        </label>
      </div>
      <p className={styles.popTitle}>Quick ranges</p>
      <div className={styles.quickRow}>
        {quickRanges.map((q) => (
          <button
            key={q.key}
            type="button"
            className={styles.quickBtn}
            onClick={() => onQuick(q.days)}
          >
            {q.label}
          </button>
        ))}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className={styles.applyBtn} onClick={handleApply}>
          Apply
        </button>
      </div>
    </div>
  );
}

export function WindowToggle() {
  const dateRange = useAppStore((s) => s.dateRange);
  const setDateRange = useAppStore((s) => s.setDateRange);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);

  // Desktop custom-range popover + mobile menu popover open states. Independent
  // so closing one never disturbs the other (only one is visible per breakpoint).
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Within the mobile menu: false = preset list, true = the custom-range fields.
  const [mobileShowCustom, setMobileShowCustom] = useState(false);
  const corpusStart = useCorpusStart(open || mobileOpen);

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

  // Range mutations only; each caller closes its own popover afterwards so the
  // shared handlers stay surface-agnostic.
  const applyQuick = useCallback(
    (days: number | 'all') => {
      if (days === 'all') {
        const start = corpusStart ? parseLocalDate(corpusStart) : null;
        setDateRange({ start: start ?? daysAgo(365), end: new Date() });
      } else {
        setDateRange({ start: daysAgo(days), end: new Date() });
      }
    },
    [corpusStart, setDateRange],
  );

  // ── Desktop custom popover handlers ──
  const handleDesktopApply = useCallback(
    (start: Date, end: Date) => {
      setDateRange({ start, end });
      setOpen(false);
    },
    [setDateRange],
  );
  const handleDesktopQuick = useCallback(
    (days: number | 'all') => {
      applyQuick(days);
      setOpen(false);
    },
    [applyQuick],
  );

  // ── Mobile menu handlers ──
  const handleMobileOpenChange = useCallback((next: boolean) => {
    setMobileOpen(next);
    // Reset to the preset list whenever the menu closes so it always reopens
    // showing the presets, not the custom fields.
    if (!next) setMobileShowCustom(false);
  }, []);
  const selectMobilePreset = useCallback(
    (index: number) => {
      const opt = PRESET_OPTIONS[index];
      if (!opt) return;
      applyPreset(opt.value);
      setMobileOpen(false);
    },
    [applyPreset],
  );
  const handleMobileApply = useCallback(
    (start: Date, end: Date) => {
      setDateRange({ start, end });
      setMobileOpen(false);
    },
    [setDateRange],
  );
  const handleMobileQuick = useCallback(
    (days: number | 'all') => {
      applyQuick(days);
      setMobileOpen(false);
    },
    [applyQuick],
  );

  // Roving-tabindex + arrow navigation for the mobile preset radiogroup (mirrors
  // SegmentedControl's keyboard model). Arrow keys move focus only; Enter/Space
  // (and click) select the preset and close the menu, so navigating never fires
  // an incidental range recompute.
  const mobileRadioRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusMobileRadio = useCallback((index: number) => {
    mobileRadioRefs.current[index]?.focus();
  }, []);
  const handleMobileRadioKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const last = PRESET_OPTIONS.length - 1;
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          event.preventDefault();
          focusMobileRadio(index === last ? 0 : index + 1);
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          event.preventDefault();
          focusMobileRadio(index === 0 ? last : index - 1);
          break;
        case 'Home':
          event.preventDefault();
          focusMobileRadio(0);
          break;
        case 'End':
          event.preventDefault();
          focusMobileRadio(last);
          break;
        case ' ':
        case 'Enter':
          event.preventDefault();
          selectMobilePreset(index);
          break;
        default:
          break;
      }
    },
    [focusMobileRadio, selectMobilePreset],
  );

  const mobileSelectedIndex = PRESET_OPTIONS.findIndex((o) => o.value === activePreset);
  const mobileHasSelection = mobileSelectedIndex >= 0;
  const activeMobileLabel = isCustom
    ? 'Custom'
    : (PRESET_OPTIONS.find((o) => o.value === activePreset)?.label ?? 'Window');

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

  const mobileTrigger = (
    <button
      type="button"
      aria-label="Time window"
      className={[styles.mobileTrigger, isCustom ? styles.mobileTriggerActive : null]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon name="calendar" style={{ width: '13px', height: '13px' }} />
      <span className={styles.mobileTriggerLabel}>{activeMobileLabel}</span>
      <span className={styles.caret} aria-hidden="true">
        {mobileOpen ? '▲' : '▼'}
      </span>
    </button>
  );

  return (
    <>
      {/* Desktop (≥768px): horizontal segment + Custom popover. */}
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
          <CustomRangeFields
            defaultStart={formatDate(dateRange.start)}
            defaultEnd={formatDate(dateRange.end)}
            min={corpusStart ?? undefined}
            max={today}
            colorScheme={resolvedTheme}
            quickRanges={QUICK_RANGES}
            onApply={handleDesktopApply}
            onQuick={handleDesktopQuick}
            onCancel={() => setOpen(false)}
          />
        </Popover>
      </div>

      {/* Mobile (<768px): compact menu exposing the same presets + custom range. */}
      <div className={styles.mobile}>
        <Popover
          open={mobileOpen}
          onOpenChange={handleMobileOpenChange}
          side="bottom"
          align="end"
          sideOffset={8}
          elevated
          contentClassName={styles.popoverPanel}
          trigger={mobileTrigger}
        >
          {mobileShowCustom ? (
            <CustomRangeFields
              defaultStart={formatDate(dateRange.start)}
              defaultEnd={formatDate(dateRange.end)}
              min={corpusStart ?? undefined}
              max={today}
              colorScheme={resolvedTheme}
              quickRanges={QUICK_RANGES}
              onApply={handleMobileApply}
              onQuick={handleMobileQuick}
              onCancel={() => setMobileShowCustom(false)}
              cancelLabel="Back"
            />
          ) : (
            <div className={styles.mobileMenu}>
              <div role="radiogroup" aria-label="Time window" className={styles.mobileGroup}>
                {PRESET_OPTIONS.map((opt, index) => {
                  const checked = opt.value === activePreset;
                  const isTabStop = mobileHasSelection ? checked : index === 0;
                  const name = opt.ariaLabel ?? opt.label;
                  return (
                    <button
                      key={opt.value}
                      ref={(el) => {
                        mobileRadioRefs.current[index] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      aria-label={name}
                      tabIndex={isTabStop ? 0 : -1}
                      className={[styles.mobileItem, checked ? styles.mobileItemActive : null]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => selectMobilePreset(index)}
                      onKeyDown={(e) => handleMobileRadioKeyDown(e, index)}
                    >
                      <span className={styles.mobileItemLabel} aria-hidden="true">
                        {opt.label}
                      </span>
                      <span className={styles.mobileItemName} aria-hidden="true">
                        {name}
                      </span>
                      {checked && (
                        <span className={styles.mobileCheck} aria-hidden="true">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className={styles.mobileCustomItem}
                onClick={() => setMobileShowCustom(true)}
              >
                Custom range…
              </button>
            </div>
          )}
        </Popover>
      </div>
    </>
  );
}
