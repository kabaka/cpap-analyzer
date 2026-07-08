/**
 * ⌘K command palette (spec B5).
 *
 * A focus-trapped modal dialog surfacing three result sections — SECTIONS (nav
 * destinations), SESSIONS (jump to a night by date), and ACTIONS (import, theme,
 * time window) — over a fuzzy filter. Keyboard-first: ↑/↓ move a wrapping cursor
 * (tracked via `aria-activedescendant`), ↵ activates, Esc/backdrop close.
 *
 * The modal frame + a11y contract (role=dialog, combobox input, Esc/backdrop
 * close, focus trap, focus restore, reduced-motion) are owned here and were
 * established by the shell stub; this module adds the results and behaviour.
 *
 * Open state lives in `useAppStore.commandPaletteOpen` (ephemeral). The global
 * ⌘K/Ctrl+K shortcut and the header trigger toggle it (both in RootLayout).
 *
 * Performance/privacy: the session date-jump resolves a single date-indexed
 * metadata query (`getSessionsByDateRange(iso, iso)`) only once the query parses
 * as a date — never an eager corpus load, and never any signal-sample data.
 *
 * @module components/CommandPalette
 */

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/ui';
import { useAppStore } from '@/stores/useAppStore';
import { getDB } from '@/services/storage/getDB';
import { parseLocalDate } from '@/utils/formatDate';
import { fuzzyMatch, highlightSegments, type HighlightSegment } from './fuzzy';
import { parseDateQuery } from './parseDateQuery';
import styles from './CommandPalette.module.css';

type ThemeValue = 'light' | 'dark' | 'system';

/** Nav destinations — mirrors RootLayout's nav item arrays (Analysis + Data +
 *  footer). NOTE(orchestrator): a shared nav-config module consumed by both
 *  RootLayout and this palette would remove the duplication; flagged as a small
 *  follow-up rather than refactoring RootLayout here. */
interface NavDestination {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly icon: IconName;
  readonly keywords: string;
}

const NAV_DESTINATIONS: readonly NavDestination[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/', icon: 'dashboard', keywords: 'home overview' },
  {
    id: 'sessions',
    label: 'Sessions',
    path: '/sessions',
    icon: 'sessions',
    keywords: 'nights list',
  },
  {
    id: 'trends',
    label: 'Trends',
    path: '/trends',
    icon: 'trends',
    keywords: 'history charts over time',
  },
  {
    id: 'explore',
    label: 'Explore',
    path: '/explore',
    icon: 'explore',
    keywords: 'analysis events correlations',
  },
  {
    id: 'reports',
    label: 'Reports',
    path: '/reports',
    icon: 'reports',
    keywords: 'export pdf csv',
  },
  {
    id: 'data',
    label: 'Data',
    path: '/data',
    icon: 'data',
    keywords: 'manage storage backup import',
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    icon: 'settings',
    keywords: 'preferences options config',
  },
  {
    id: 'help',
    label: 'Help',
    path: '/help',
    icon: 'help',
    keywords: 'docs guide glossary shortcuts',
  },
];

const THEME_ACTIONS: readonly {
  id: string;
  label: string;
  value: ThemeValue;
  icon: IconName;
  keywords: string;
}[] = [
  {
    id: 'theme-light',
    label: 'Switch to light theme',
    value: 'light',
    icon: 'theme-light',
    keywords: 'appearance mode colour scheme',
  },
  {
    id: 'theme-dark',
    label: 'Switch to dark theme',
    value: 'dark',
    icon: 'theme-dark',
    keywords: 'appearance mode colour scheme',
  },
  {
    id: 'theme-system',
    label: 'Use system theme',
    value: 'system',
    icon: 'theme-system',
    keywords: 'appearance mode colour scheme auto os',
  },
];

/** Time-window presets — day-spans mirror WindowToggle's `PRESET_DAYS` (the
 *  header control is the source of truth for the global range behaviour). */
const WINDOW_PRESETS: readonly { id: string; label: string; days: number; keywords: string }[] = [
  { id: '7d', label: 'Set time window: Last 7 days', days: 7, keywords: 'range date period week' },
  {
    id: '30d',
    label: 'Set time window: Last 30 days',
    days: 30,
    keywords: 'range date period month',
  },
  {
    id: '90d',
    label: 'Set time window: Last 90 days',
    days: 90,
    keywords: 'range date period quarter',
  },
  {
    id: '6m',
    label: 'Set time window: Last 6 months',
    days: 182,
    keywords: 'range date period half year',
  },
  {
    id: '12m',
    label: 'Set time window: Last 12 months',
    days: 365,
    keywords: 'range date period year annual',
  },
];

const MS_PER_DAY = 86_400_000;

/** Midnight-anchored date `days` before now (mirrors WindowToggle). */
function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

/** The window-preset id a stored range represents by day-span, else null. */
function derivePresetId(range: { start: Date; end: Date }): string | null {
  const diffDays = Math.round((range.end.getTime() - range.start.getTime()) / MS_PER_DAY);
  return WINDOW_PRESETS.find((preset) => preset.days === diffDays)?.id ?? null;
}

/** Human-friendly night label, e.g. "Sat, Jul 4, 2026". */
function formatSessionDate(isoDate: string): string {
  const date = parseLocalDate(isoDate);
  if (!date) return isoDate;
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** A single activatable result row. */
interface PaletteItem {
  readonly key: string;
  readonly icon: IconName;
  readonly label: string;
  readonly sub?: string;
  readonly segments: HighlightSegment[];
  readonly current?: boolean;
  readonly run: () => void;
}

/** A rendered section: its heading plus items carrying their flattened index. */
interface RenderGroup {
  readonly id: string;
  readonly title: string;
  readonly items: (PaletteItem & { index: number })[];
  readonly loading?: boolean;
  readonly emptyText?: string;
}

/** Metadata subset used by the SESSIONS rows — no signal data. */
interface SessionLite {
  readonly id: string;
  readonly date: string;
  readonly machineModel: string;
}

interface ScoredDef<T> {
  readonly def: T;
  readonly segments: HighlightSegment[];
}

/**
 * Filter a set of definitions by the query: an empty query passes everything
 * (natural order); otherwise each definition is fuzzy-matched against its label
 * (with highlight) and then, as a lower-priority fallback, its keywords (no
 * highlight). Results are sorted best-first.
 */
function filterDefs<T extends { label: string; keywords?: string }>(
  defs: readonly T[],
  query: string,
): ScoredDef<T>[] {
  if (query.trim() === '') {
    return defs.map((def) => ({ def, segments: [{ text: def.label, match: false }] }));
  }

  const scored: (ScoredDef<T> & { score: number })[] = [];
  for (const def of defs) {
    const labelMatch = fuzzyMatch(query, def.label);
    if (labelMatch) {
      scored.push({
        def,
        segments: highlightSegments(def.label, labelMatch.indices),
        // Label hits always outrank keyword-only hits.
        score: labelMatch.score + 1000,
      });
      continue;
    }
    if (def.keywords) {
      const keywordMatch = fuzzyMatch(query, def.keywords);
      if (keywordMatch) {
        scored.push({
          def,
          segments: [{ text: def.label, match: false }],
          score: keywordMatch.score,
        });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ def, segments }) => ({ def, segments }));
}

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const dateRange = useAppStore((s) => s.dateRange);
  const setDateRange = useAppStore((s) => s.setDateRange);

  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  // Result of the date-indexed session lookup, tagged with the iso it answers
  // so a stale in-flight result never renders under a newer query.
  const [sessionResult, setSessionResult] = useState<{
    iso: string;
    sessions: SessionLite[];
  } | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The control that had focus when the palette opened; focus returns to it on
  // close (WCAG 2.4.3 focus order — never strand focus on the dismissed dialog).
  const invokerRef = useRef<HTMLElement | null>(null);
  const listId = useId();
  const optionIdBase = useId();

  const close = useCallback(() => setOpen(false), [setOpen]);

  const parsedIso = useMemo(() => parseDateQuery(query), [query]);
  const currentPresetId = useMemo(() => derivePresetId(dateRange), [dateRange]);

  // Capture the invoker + move focus to the input on open; restore focus on
  // close. The cleanup runs when `open` flips back to false (or on unmount).
  useEffect(() => {
    if (!open) return;
    invokerRef.current = document.activeElement as HTMLElement | null;
    const raf = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(raf);
      invokerRef.current?.focus?.();
      setQuery('');
    };
  }, [open]);

  // Escape closes; Tab is trapped within the panel.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  // Session date-jump: resolve the parsed date to session metadata via the
  // date-indexed range query (start === end). Cancellable; only commits results
  // for the date still being asked about. No signal data is touched.
  useEffect(() => {
    if (!open || !parsedIso) {
      setSessionResult(null);
      setSessionLoading(false);
      return;
    }
    let cancelled = false;
    setSessionLoading(true);
    void (async () => {
      try {
        const db = await getDB();
        const sessions = await db.getSessionsByDateRange(parsedIso, parsedIso);
        if (cancelled) return;
        setSessionResult({
          iso: parsedIso,
          sessions: sessions
            .filter((s) => !s.deleted)
            .slice(0, 8)
            .map((s) => ({ id: s.id, date: s.date, machineModel: s.machineModel })),
        });
      } catch {
        // A failed lookup degrades to "no session found" for that date.
        if (!cancelled) setSessionResult({ iso: parsedIso, sessions: [] });
      } finally {
        if (!cancelled) setSessionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, parsedIso]);

  // Build the grouped + flattened result set from the current query.
  const { groups, flatItems } = useMemo(() => {
    const sectionItems: PaletteItem[] = filterDefs(NAV_DESTINATIONS, query).map(
      ({ def, segments }) => ({
        key: def.id,
        icon: def.icon,
        label: def.label,
        segments,
        run: () => navigate(def.path),
      }),
    );

    const actionDefs = [
      {
        id: 'import',
        label: 'Import therapy data',
        keywords: 'upload add sd card load new',
        icon: 'import' as IconName,
        current: false,
        run: () => navigate('/data/import'),
      },
      ...THEME_ACTIONS.map((action) => ({
        id: action.id,
        label: action.label,
        keywords: action.keywords,
        icon: action.icon,
        current: theme === action.value,
        run: () => setTheme(action.value),
      })),
      ...WINDOW_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        keywords: preset.keywords,
        icon: 'calendar' as IconName,
        current: currentPresetId === preset.id,
        run: () => setDateRange({ start: daysAgo(preset.days), end: new Date() }),
      })),
    ];
    const actionItems: PaletteItem[] = filterDefs(actionDefs, query).map(({ def, segments }) => ({
      key: def.id,
      icon: def.icon,
      label: def.label,
      segments,
      current: def.current,
      run: def.run,
    }));

    const sessionItems: PaletteItem[] =
      parsedIso && sessionResult?.iso === parsedIso
        ? sessionResult.sessions.map((s) => ({
            key: `session-${s.id}`,
            icon: 'sessions' as IconName,
            label: formatSessionDate(s.date),
            sub: s.machineModel,
            segments: [{ text: formatSessionDate(s.date), match: false }],
            run: () => navigate(`/sessions/${s.id}`),
          }))
        : [];

    type OrderedGroup = {
      id: string;
      title: string;
      rawItems: PaletteItem[];
      loading?: boolean;
      emptyText?: string;
    };
    const ordered: OrderedGroup[] = [];
    if (sectionItems.length > 0) {
      ordered.push({ id: 'sections', title: 'Sections', rawItems: sectionItems });
    }
    if (parsedIso) {
      const stillLoading = sessionLoading || sessionResult?.iso !== parsedIso;
      ordered.push({
        id: 'sessions',
        title: 'Sessions',
        rawItems: sessionItems,
        loading: stillLoading,
        emptyText: stillLoading ? undefined : `No session recorded on ${parsedIso}.`,
      });
    }
    if (actionItems.length > 0) {
      ordered.push({ id: 'actions', title: 'Actions', rawItems: actionItems });
    }

    // Assign each activatable item a stable flattened index (for the roving
    // cursor + aria-activedescendant).
    const flat: (PaletteItem & { index: number })[] = [];
    const rendered: RenderGroup[] = ordered.map((group) => {
      const items = group.rawItems.map((item) => {
        const withIndex = { ...item, index: flat.length };
        flat.push(withIndex);
        return withIndex;
      });
      return {
        id: group.id,
        title: group.title,
        items,
        loading: group.loading,
        emptyText: group.emptyText,
      };
    });

    return { groups: rendered, flatItems: flat };
  }, [
    query,
    parsedIso,
    sessionResult,
    sessionLoading,
    theme,
    currentPresetId,
    navigate,
    setTheme,
    setDateRange,
  ]);

  // Reset the cursor to the top whenever the result set changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, sessionResult]);

  const clampedActive = flatItems.length > 0 ? Math.min(activeIndex, flatItems.length - 1) : -1;
  const activeOptionId = clampedActive >= 0 ? `${optionIdBase}-opt-${clampedActive}` : undefined;

  // Keep the active row scrolled into view during keyboard navigation. `nearest`
  // avoids smooth scrolling, so it is inert under reduced-motion.
  useEffect(() => {
    if (!open || !activeOptionId) return;
    const el = document.getElementById(activeOptionId);
    // Guard: not all environments implement scrollIntoView (e.g. jsdom).
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [open, activeOptionId]);

  const activate = useCallback(
    (item: PaletteItem) => {
      item.run();
      setOpen(false);
    },
    [setOpen],
  );

  const moveActive = useCallback(
    (delta: number) => {
      const count = flatItems.length;
      if (count === 0) return;
      setActiveIndex((prev) => {
        const base = Math.min(prev, count - 1);
        return (base + delta + count) % count;
      });
    },
    [flatItems.length],
  );

  const onInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveActive(1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          moveActive(-1);
          break;
        case 'Home':
          if (flatItems.length > 0) {
            event.preventDefault();
            setActiveIndex(0);
          }
          break;
        case 'End':
          if (flatItems.length > 0) {
            event.preventDefault();
            setActiveIndex(flatItems.length - 1);
          }
          break;
        case 'Enter': {
          const item = flatItems[clampedActive];
          if (item) {
            event.preventDefault();
            activate(item);
          }
          break;
        }
        default:
          break;
      }
    },
    [moveActive, flatItems, clampedActive, activate],
  );

  if (!open) return null;

  const showEmptyState = query.trim() !== '' && !parsedIso && flatItems.length === 0;
  const resultCount = flatItems.length;

  return (
    // Backdrop: clicking outside the panel dismisses (mousedown target is the
    // overlay itself, not a descendant of the panel).
    <div className={styles.overlay} onClick={close}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className={styles.panel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.inputRow}>
          <Icon name="search" size="sm" className={styles.searchIcon} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeOptionId}
            aria-label="Search sections, sessions, actions"
            placeholder="Search sections, sessions, actions…"
            className={styles.input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          <span className={styles.keyChip}>Esc</span>
        </div>

        {/* Polite result-count announcement (spec Part E). */}
        <div role="status" aria-live="polite" className={styles.srOnly}>
          {resultCount === 1 ? '1 result' : `${resultCount} results`}
        </div>

        <ul id={listId} role="listbox" aria-label="Command results" className={styles.results}>
          {groups.map((group) => (
            <Fragment key={group.id}>
              <li role="presentation" className={styles.sectionHeader}>
                {group.title}
              </li>
              {group.loading && (
                <li role="presentation" className={styles.infoRow}>
                  Searching sessions…
                </li>
              )}
              {!group.loading && group.items.length === 0 && group.emptyText && (
                <li role="presentation" className={styles.infoRow}>
                  {group.emptyText}
                </li>
              )}
              {group.items.map((item) => {
                const isActive = item.index === clampedActive;
                const optionId = `${optionIdBase}-opt-${item.index}`;
                return (
                  <li
                    key={item.key}
                    id={optionId}
                    role="option"
                    aria-selected={isActive}
                    className={`${styles.option} ${isActive ? styles.optionActive : ''}`}
                    onMouseMove={() => setActiveIndex(item.index)}
                    onClick={() => activate(item)}
                  >
                    <span className={styles.optionIconSlot}>
                      <Icon name={item.icon} style={{ width: '18px', height: '18px' }} />
                    </span>
                    <span className={styles.optionMain}>
                      <span className={styles.optionLabel}>
                        {item.segments.map((segment, i) =>
                          segment.match ? (
                            <span key={i} className={styles.match}>
                              {segment.text}
                            </span>
                          ) : (
                            <Fragment key={i}>{segment.text}</Fragment>
                          ),
                        )}
                      </span>
                      {item.sub && <span className={styles.optionSub}>{item.sub}</span>}
                    </span>
                    {item.current && !isActive && <span className={styles.optionTag}>Current</span>}
                    {isActive && (
                      <span className={styles.keyChip} aria-hidden="true">
                        ↵
                      </span>
                    )}
                  </li>
                );
              })}
            </Fragment>
          ))}

          {showEmptyState && (
            <li role="presentation" className={styles.empty}>
              <p className={styles.emptyPrimary}>No matches for “{query.trim()}”.</p>
              <p className={styles.emptyHint}>
                Try a section name, a date like 2026-07-04, or an action.
              </p>
            </li>
          )}
        </ul>

        <div className={styles.footer} aria-hidden="true">
          <span className={styles.hint}>
            <span className={styles.keyChip}>↑↓</span> Navigate
          </span>
          <span className={styles.hint}>
            <span className={styles.keyChip}>↵</span> Open
          </span>
          <span className={styles.hint}>
            <span className={styles.keyChip}>Esc</span> Close
          </span>
        </div>
      </div>
    </div>
  );
}
