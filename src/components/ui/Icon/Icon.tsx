import type { CSSProperties } from 'react';

/**
 * Inline-SVG icon set for the app chrome.
 *
 * Zero runtime dependencies — every glyph is hand-built path data on a 24×24
 * viewBox using `currentColor` so icons inherit text colour and theme tokens.
 * Sizing is driven by the `--icon-size-*` design tokens.
 */
export type IconName =
  | 'dashboard'
  | 'sessions'
  | 'trends'
  | 'explore'
  | 'reports'
  | 'data'
  | 'settings'
  | 'help'
  | 'theme-light'
  | 'theme-dark'
  | 'theme-system'
  | 'menu'
  | 'close'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-up'
  | 'chevron-down'
  | 'storage'
  | 'calendar'
  | 'clock'
  | 'check-circle'
  | 'alert-triangle'
  | 'x-circle'
  | 'circle-dashed'
  | 'circle-dot'
  | 'spinner'
  | 'search'
  | 'import'
  | 'brand';

export type IconSize = 'sm' | 'md' | 'lg';

const SIZE_TOKEN: Record<IconSize, string> = {
  sm: 'var(--icon-size-sm)',
  md: 'var(--icon-size-md)',
  lg: 'var(--icon-size-lg)',
};

interface IconProps {
  name: IconName;
  size?: IconSize;
  /** Optional accessible label. When provided the SVG becomes role="img"; otherwise it is decorative (aria-hidden). */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Per-icon path geometry. Each entry returns the inner SVG markup; shared
 * presentation attributes (viewBox, stroke, linecaps) live on the wrapping
 * <svg>. A handful of icons override stroke width for crispness at small sizes.
 */
const PATHS: Record<IconName, JSX.Element> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  sessions: (
    <>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  trends: (
    <>
      <polyline points="3 21 3 3" />
      <line x1="3" y1="21" x2="21" y2="21" />
      <polyline points="3 17 9 11 13 14 21 5" />
    </>
  ),
  explore: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="20" y1="20" x2="15.5" y2="15.5" />
      <path d="M7 11 q1.75 -3 3.5 0 t3.5 0" strokeWidth="1.5" />
    </>
  ),
  reports: (
    <>
      <path d="M6 3 h7 l5 5 v13 H6 Z" />
      <polyline points="13 3 13 8 18 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </>
  ),
  data: (
    <>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5 v6 c0 1.4 3.1 2.5 7 2.5 s7 -1.1 7 -2.5 v-6" />
      <path d="M5 11.5 v6 c0 1.4 3.1 2.5 7 2.5 s7 -1.1 7 -2.5 v-6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.2a2.8 2.8 0 1 1 4.3 2.6c-.9.6-1.5 1.1-1.5 2.2" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  'theme-light': (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </>
  ),
  'theme-dark': <path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z" />,
  'theme-system': (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </>
  ),
  menu: (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </>
  ),
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  'chevron-left': <polyline points="15 5 8 12 15 19" />,
  'chevron-right': <polyline points="9 5 16 12 9 19" />,
  'chevron-up': <polyline points="5 15 12 8 19 15" />,
  'chevron-down': <polyline points="5 9 12 16 19 9" />,
  storage: (
    <>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5 v6 c0 1.4 3.1 2.5 7 2.5 s7 -1.1 7 -2.5 v-6" />
      <path d="M5 11.5 v6 c0 1.4 3.1 2.5 7 2.5 s7 -1.1 7 -2.5 v-6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="8" y1="3" x2="8" y2="6" />
      <line x1="16" y1="3" x2="16" y2="6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </>
  ),
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="8 12 11 15 16 9" />
    </>
  ),
  'alert-triangle': (
    <>
      <path d="M12 3.5 21 19 H3 Z" strokeLinejoin="round" />
      <line x1="12" y1="9" x2="12" y2="13.5" />
      <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  'x-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </>
  ),
  'circle-dashed': <circle cx="12" cy="12" r="9" strokeDasharray="3.6 3.4" />,
  'circle-dot': (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
    </>
  ),
  // Open ~270° arc (top → right → bottom → left, missing the top-left quadrant).
  // The consumer rotates this with CSS to spin it (and disables that under
  // prefers-reduced-motion, falling back to a static status glyph).
  spinner: <path d="M12 3 a9 9 0 1 1 -6.36 2.64" />,
  // Magnifying glass (⌘K trigger + command-palette input). Matches the
  // prototype's circle+handle at the 24×24 / 1.75-stroke house style.
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </>
  ),
  // Tray-import: a down-arrow dropping into an open tray (header Import button).
  import: (
    <>
      <path d="M12 3v10" />
      <polyline points="8 9 12 13 16 9" />
      <path d="M4 14v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>
  ),
  brand: (
    <>
      <path
        d="M2 14 C5 14 5 6 8 6 C10 6 10 18 12 18 C14 18 14 9 17 9 C20 9 19 14 22 14"
        strokeWidth="2"
      />
      <circle cx="8" cy="6" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
};

export function Icon({ name, size = 'md', title, className, style }: IconProps) {
  const dimension = SIZE_TOKEN[size];
  const labelled = title !== undefined && title.length > 0;

  // Sizing is applied via CSS width/height (which accept `var()`) rather than
  // the SVG presentation attributes `width`/`height` (which do NOT accept
  // `var()` — WebKit reports "Invalid value for <svg> attribute" while
  // Chromium/Firefox silently ignore it). Caller-provided style overrides win.
  const sizedStyle: CSSProperties = {
    width: dimension,
    height: dimension,
    ...style,
  };

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={sizedStyle}
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
      aria-label={labelled ? title : undefined}
      focusable="false"
    >
      {labelled ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
