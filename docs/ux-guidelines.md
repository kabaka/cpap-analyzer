# UX Guidelines

## Design Philosophy

CPAP Analyzer is a clinical data analysis tool built for patients who are deeply engaged with their therapy data. The design must balance two competing needs:

1. **Information density** — power users want to see lots of data at once without excessive clicking.
2. **Learnability** — dedicated laypersons should be able to understand what they're seeing and learn the clinical context.

### Guiding Principles

1. **Data first**: Prioritize showing data over chrome. Minimize decorative elements. Every pixel should earn its place.
2. **Progressive disclosure**: Show summary information by default; let users dig deeper on demand. Never hide important data behind excessive navigation.
3. **Clinical context always available**: Every metric, chart, and number should have accessible explanations. Hover tooltips for brief definitions; click-through for detailed clinical context.
4. **No data leaves the browser**: The UI should never suggest, imply, or enable sending data to a server. No share buttons, no cloud sync, no "upload" language.
5. **Respect the user's time**: Import should be fast. Navigation should be instant. The app should remember where the user was.

## User Flows

### First Launch

```
Landing Page
    │
    ├── Welcome message (brief, respectful)
    ├── What this app does (1–2 sentences)
    ├── Privacy statement (prominent, not buried)
    │
    └── [Import Data] button (primary CTA)
            │
            ├── Select SD card / folder
            ├── Parsing progress (time remaining estimate)
            ├── Import summary (sessions found, date range, any warnings)
            │
            └── → Dashboard (auto-navigate on completion)
```

### Returning User

```
App Launch
    │
    └── → Dashboard (last-viewed date range preserved)
            │
            ├── Check for new sessions on known import path (optional)
            │   └── "New data available" banner if found
            │
            └── Full UI available immediately from local storage
```

### Dashboard (Daily Overview)

The dashboard is the primary view. It shows:

- **Date navigator**: Calendar or date range selector at the top. Default to last 30 days.
- **Summary cards**: AHI, leak rate, usage hours, mask fit — each as a card with trend indicator (improving/worsening arrow), sparkline, and current value.
- **Daily detail table**: Sortable, filterable table of sessions with key metrics.
- **Trend charts**: Configurable chart area showing 1–3 trend charts (AHI over time, leak over time, etc.).

Clicking a date in the table or a point on a chart navigates to Session Detail.

### Session Detail

Detailed view of a single night's session:

- **Header**: Date, machine model, total time, AHI, overall assessment.
- **Signal viewer**: High-resolution time-series viewer for flow rate, pressure, leak, SpO2 (if available). Supports pan, zoom, selection.
- **Event timeline**: Visual timeline of respiratory events (apneas, hypopneas, flow limitations) overlaid on the signal viewer or as a separate track.
- **Session statistics**: Table of all computed metrics for this session.
- **Annotations**: User can add notes to specific time points (stored locally).

### Analysis View

Advanced analysis tools accessible from the main navigation:

- **Statistical analysis**: Trend analysis, change-point detection, correlation analysis.
- **Clustering**: Group sessions by similarity to identify patterns.
- **Comparisons**: Before/after analysis (e.g., mask change, pressure change).
- **Reports**: Generate printable/exportable reports.

### Settings

- **Machine configuration**: Verify detected machine model, configure custom settings.
- **Display preferences**: Theme (light/dark), units, date format, default chart types.
- **Data management**: Storage usage, export data, clear data, manage import history.
- **API integrations**: Configure Fitbit/weather API keys (stored locally, never transmitted).
- **About**: Version, license, links to documentation.

## Navigation Structure

```
┌─────────────────────────────────────────────────┐
│  [Logo] CPAP Analyzer        [?] [⚙] [Theme]   │
├─────────────────────────────────────────────────┤
│  Dashboard │ Sessions │ Analysis │ Reports       │
├─────────────────────────────────────────────────┤
│                                                   │
│  ┌─── Date Range Selector ───────────────────┐  │
│  │  ◄  Jan 1 – Jan 31, 2026  ►   [Custom]   │  │
│  └───────────────────────────────────────────┘  │
│                                                   │
│  [Content Area]                                   │
│                                                   │
│                                                   │
│                                                   │
├─────────────────────────────────────────────────┤
│  Status: 412 sessions loaded │ Storage: 2.4 GB   │
└─────────────────────────────────────────────────┘
```

- **Top bar**: Logo, app name, global actions (help, settings, theme toggle).
- **Tab bar**: Primary navigation between major sections.
- **Date range selector**: Persistent across views. Changes here update all content.
- **Content area**: View-specific content.
- **Status bar**: Session count, storage usage, background task indicators.

## Accessibility (WCAG AA)

### Requirements

| Criterion | Requirement | Implementation |
| ---- | ---- | ---- |
| 1.1.1 Non-text Content | Alt text for all meaningful images/charts | Canvas charts provide text alternatives in adjacent elements or via `aria-label` |
| 1.3.1 Info and Relationships | Structure conveyed programmatically | Semantic HTML, proper heading hierarchy, ARIA landmarks |
| 1.4.1 Use of Color | Color not sole means of conveying information | All color-coded data has additional indicators (patterns, labels, icons) |
| 1.4.3 Contrast (Minimum) | 4.5:1 for normal text, 3:1 for large text | Verified in both light and dark themes |
| 1.4.11 Non-text Contrast | 3:1 for UI components and graphical objects | Chart lines, buttons, form controls all meet this ratio |
| 2.1.1 Keyboard | All functionality via keyboard | Tab order, focus management, keyboard shortcuts for common actions |
| 2.4.1 Bypass Blocks | Skip navigation | Skip-to-content link, ARIA landmarks |
| 2.4.7 Focus Visible | Visible focus indicator | High-contrast focus ring on all interactive elements |
| 4.1.2 Name, Role, Value | Programmatic name for all components | ARIA labels, roles, and states for custom components |

### Keyboard Navigation

- `Tab` / `Shift+Tab` — Move between interactive elements.
- `Arrow keys` — Navigate within components (tables, charts, date pickers).
- `Enter` / `Space` — Activate buttons, toggle selections.
- `Escape` — Close modals, cancel operations.
- `?` — Open keyboard shortcut reference (when no input is focused).

### Screen Reader Support

- All charts must have text-based summaries accessible to screen readers.
- Data tables are the primary accessible representation of chart data.
- Live regions announce background task completions (imports, analysis runs).
- Modal dialogs trap focus and announce their purpose.

### Motion and Animation

- Respect `prefers-reduced-motion` media query.
- All animations must be purely decorative and non-essential.
- Chart transitions can be disabled without losing information.

## Responsive Design

### Breakpoints

| Breakpoint | Width | Layout | Primary Use Case |
| ---- | ---- | ---- | ---- |
| Mobile | < 640px | Single column, stacked cards | "Show data to doctor on phone" |
| Tablet | 640px – 1024px | Two-column where appropriate | Bedside review |
| Desktop | > 1024px | Full multi-panel layout | Primary analysis workstation |

### Mobile-First Considerations

The "show my doctor" use case is critical. On mobile:

- Summary cards stack vertically with large, readable numbers.
- Trend charts resize to fit viewport width (full bleed).
- Data tables scroll horizontally with sticky first column.
- Signal viewer supports touch gestures (pinch-to-zoom, swipe-to-pan).
- Navigation collapses to a hamburger menu.
- Font sizes are appropriate for reading at arm's length.

### Desktop-First Considerations

Desktop is the primary analysis platform:

- Multi-panel layouts allow side-by-side chart comparison.
- Signal viewer takes up maximum available width.
- Tables show more columns without scrolling.
- Keyboard shortcuts are discoverable and comprehensive.
- Drag-and-drop for chart arrangement and widget placement.

## Theming

### Light and Dark Modes

Both themes must be fully functional and tested:

- **Light mode**: White backgrounds, dark text. Default for new users.
- **Dark mode**: Dark backgrounds, light text. Preferred for evening use (many users review CPAP data before bed).
- **System preference**: Respect `prefers-color-scheme` media query by default. Allow manual override that persists.

### CSS Implementation

Use CSS custom properties (design tokens) for all theme-dependent values:

```css
:root {
  /* Surface colors */
  --color-surface-primary: #ffffff;
  --color-surface-secondary: #f5f5f5;
  --color-surface-elevated: #ffffff;

  /* Text colors */
  --color-text-primary: #1a1a1a;
  --color-text-secondary: #666666;
  --color-text-muted: #999999;

  /* Clinical status colors */
  --color-status-normal: #22c55e;
  --color-status-mild: #eab308;
  --color-status-moderate: #f97316;
  --color-status-severe: #ef4444;

  /* Chart colors — must be distinguishable in both themes */
  --color-chart-1: #3b82f6;
  --color-chart-2: #ef4444;
  --color-chart-3: #22c55e;
  --color-chart-4: #a855f7;
  --color-chart-5: #f97316;

  /* Spacing scale */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;

  /* Typography */
  --font-family-body: system-ui, -apple-system, sans-serif;
  --font-family-mono: ui-monospace, 'Cascadia Code', monospace;
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-md: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;
}

[data-theme='dark'] {
  --color-surface-primary: #1a1a1a;
  --color-surface-secondary: #262626;
  --color-surface-elevated: #333333;
  --color-text-primary: #f5f5f5;
  --color-text-secondary: #a3a3a3;
  --color-text-muted: #737373;
}
```

### Chart Color Requirements

Clinical severity colors must be:

- Consistent across all charts.
- Distinguishable by colorblind users (test with Deuteranopia, Protanopia, Tritanopia simulators).
- Not relying solely on hue — also use patterns (dashed lines, markers) or labels.
- Meeting WCAG 1.4.11 (3:1 contrast against backgrounds) in both themes.

## Typography

### Font Stack

Use system fonts exclusively. No external font loading:

- **Body**: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Monospace**: `ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, monospace`
- **Rationale**: Fastest load time, zero network requests, respects user's OS preferences, privacy-compliant.

### Scale

- **Body text**: 16px (1rem) — comfortable reading size.
- **Small text**: 14px (0.875rem) — secondary information, table cells.
- **Extra small**: 12px (0.75rem) — labels, axis ticks. Never smaller than this.
- **Headings**: Use `rem` units scaling from 1.25rem to 2rem. No heading should be larger than necessary.

### Numbers

- **Tabular figures** (`font-variant-numeric: tabular-nums`): Required in all numeric displays so columns align.
- **Significant figures**: Clinical metrics display appropriate precision (AHI to one decimal, percentages to one decimal, hours to one decimal).

## Icons

All icons must be bundled with the application. No icon CDNs, no external font files.

Options (to be decided during implementation):

1. **Inline SVGs** — Maximum control, tree-shakeable, no additional requests.
2. **SVG sprite** — Single request, good caching.

Avoid icon fonts (Font Awesome, etc.) due to privacy policy (no external requests) and accessibility concerns.

## Empty States, Loading States, and Error States

### Empty States

Every view that can be empty must have a helpful empty state:

- **Dashboard (no data)**: Welcome message, import button, brief instructions.
- **Analysis (no results)**: Explanation of what the tool does, button to run analysis.
- **Search (no results)**: Clear message that no sessions match filters, suggestion to adjust.

### Loading States

- **Initial load**: Application shell renders immediately; data loads progressively.
- **Import**: Full progress UI with file count, percentage, time estimate, cancel button.
- **Analysis**: Progress indicator with description of current step.
- **Charts**: Skeleton or shimmer placeholder matching chart dimensions.
- **Never block the entire UI**: Background operations should not prevent navigation.

### Error States

- **Import errors**: Show which files failed and why. Allow retry. Partial imports succeed.
- **Storage full**: Clear warning with storage usage breakdown and options to free space.
- **Browser incompatibility**: Feature detection with clear message about what's missing.
- **Corrupt data**: Graceful degradation. Show what's available. Offer to re-import.

Error messages must:

- Be written in plain language (no stack traces in the UI).
- Suggest an action the user can take.
- Preserve context (don't navigate away from what the user was doing).
- Log technical details to the console for debugging.

## Clinical Data Display Guidelines

### AHI Severity

Always display AHI with its clinical severity classification:

| AHI Range | Severity | Color Token |
| ---- | ---- | ---- |
| < 5 | Normal | `--color-status-normal` |
| 5 – 14.9 | Mild | `--color-status-mild` |
| 15 – 29.9 | Moderate | `--color-status-moderate` |
| ≥ 30 | Severe | `--color-status-severe` |

### Leak Rate

| Metric | Threshold | Color Indicator |
| ---- | ---- | ---- |
| Median leak | < 24 L/min | Normal |
| 95th percentile leak | < 24 L/min | Normal |
| Any period > 24 L/min for > 30 min | - | Warning |

### Usage Compliance

Medicare compliance threshold: ≥ 4 hours per night on ≥ 70% of nights in a 30-day period.

- Display compliance status prominently when relevant.
- Show both the percentage of compliant nights and average usage hours.
- Calendar view color-codes each night by compliance (≥4h = compliant, <4h = non-compliant, no data = missed).

### Disclaimers

The application must display appropriate disclaimers:

> This application is for informational purposes only and is not a medical device. It does not provide medical advice, diagnosis, or treatment. Always consult your healthcare provider for interpretation of your CPAP therapy data.

This disclaimer should be:

- Visible on first launch.
- Accessible from the About/Help section at all times.
- Included in any exported/printed reports.

## Help System

### Contextual Help

- Every metric label should be a clickable link to its explanation.
- Hover tooltips provide one-line definitions.
- Click-through leads to a detailed help article covering:
  - What the metric measures
  - How it's calculated
  - What normal ranges look like
  - When to be concerned
  - What actions to consider (always deferring to healthcare provider)

### Documentation Audience

All help content is written for an audience of **patients with data science, mathematics, or bioinformatics backgrounds**, with enough explanatory material for **dedicated laypersons** to learn what they need.

This means:

- Don't dumb down the statistics — explain them properly.
- Include the mathematical formulas where helpful.
- Provide clinical context and references.
- Use progressive disclosure: summary first, then detail.

### Onboarding

First-time users see a brief, non-intrusive guided tour:

1. How to import data.
2. What the dashboard shows.
3. How to access detailed analysis.
4. Where to find help.

The tour can be skipped and replayed from settings. It should take less than 60 seconds.
