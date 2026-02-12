# Historical Trends View — Design Specification

**Status**: Design Specification  
**Last Updated**: February 12, 2026  
**Route**: `/trends`  
**Nav Label**: "Trends"

## Overview

A dedicated view for long-term trend analysis across the full data history or a user-selected date range. Displays multiple time-aligned charts stacked vertically, sharing a synchronized x-axis, crosshair, and zoom controls. Each data point represents one night/session.

This view serves the core analytical use case: identifying patterns, correlations, and changes across therapy metrics over weeks, months, or the entire therapy history.

### Design Principles Applied

- **Data first**: Maximize chart area; minimize chrome. All six charts are visible simultaneously on desktop.
- **Progressive disclosure**: Summary stats sidebar is collapsible. Annotations are visible on hover/click.
- **Clinical context always available**: Severity zones on AHI chart, threshold lines on usage, change markers on settings.

---

## 1. Layout

### Desktop (≥ 1200px)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ◄ Dashboard    Trends                          [DateRangeSelector]    │
├─────────────────────────────────────────────────────────────────────┬───┤
│                                                                     │   │
│  ┌── Date Range Brush ────────────────────────────────────────┐    │ S │
│  │  ▁▂▃▄▅▆▇█▇▆▅▄▃▂▁▂▃▄▅▆▇█▇▆▅  [========]  ▁▂▃▄▅▆▇        │    │ u │
│  └────────────────────────────────────────────────────────────┘    │ m │
│                                                                     │ m │
│  ┌── AHI ─────────────────────────────────────────────────────┐    │ a │
│  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  (severity zone bands)                │    │ r │
│  │  ─────────╲───╱──────  (AHI line)                           │    │ y │
│  └────────────────────────────────────────────────────────────┘    │   │
│                                                                     │ S │
│  ┌── Usage ───────────────────────────────────────────────────┐    │ t │
│  │  ██ ██ ██ ▐▌ ██ ██ ██  (bars)                               │    │ a │
│  │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  (4h line)                           │    │ t │
│  └────────────────────────────────────────────────────────────┘    │ s │
│                                                                     │   │
│  ┌── Leak Rate ───────────────────────────────────────────────┐    │ S │
│  │  ░░░░░░░░░░░░░░░░░░░░  (P95 band)                          │    │ i │
│  │  ─────────────────────  (median line)                       │    │ d │
│  └────────────────────────────────────────────────────────────┘    │ e │
│                                                                     │ b │
│  ┌── Pressure ────────────────────────────────────────────────┐    │ a │
│  │  ░░░░░░░░░░░░░░░░░░░░  (P95 band)                          │    │ r │
│  │  ─────────────────────  (mean line)                         │    │   │
│  └────────────────────────────────────────────────────────────┘    │   │
│                                                                     │   │
│  ┌── Events ──────────────────────────────────────────────────┐    │   │
│  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  (stacked area)                     │    │   │
│  └────────────────────────────────────────────────────────────┘    │   │
│                                                                     │   │
│  ┌── Settings ────────────────────────────────────────────────┐    │   │
│  │  ┐     ┐        ┐                                           │    │   │
│  │  └─────┘────────┘───  (step chart: pressure config)        │    │   │
│  └────────────────────────────────────────────────────────────┘    │   │
│                                                                     │   │
│  ┌── Shared X-Axis (dates) ──────────────────────────────────┐    │   │
│  │  Sep 17    Oct 1    Oct 15    Nov 1    Nov 15              │    │   │
│  └────────────────────────────────────────────────────────────┘    │   │
│                                                                     │   │
├─────────────────────────────────────────────────────────────────┴───┤
│  Annotations legend: ▲ Settings Change  ● Note                       │
└─────────────────────────────────────────────────────────────────────┘
```

### CSS Grid Specification

```css
.trendsLayout {
  display: grid;
  grid-template-columns: 1fr 300px; /* Charts | Sidebar */
  grid-template-rows: auto;
  gap: 0;
  height: 100%;
  overflow: hidden;
}

.chartsColumn {
  overflow-y: auto;
  padding: var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-md); /* 16px between charts */
}

.sidebar {
  border-left: 1px solid var(--color-border-default);
  padding: var(--space-lg);
  overflow-y: auto;
  background: var(--color-surface-secondary);
}
```

### Tablet (640px–1199px)

- Sidebar collapses to a slide-out drawer, triggered by a toggle button in the header.
- Charts take full width.
- Chart heights reduce to 160px each.

### Mobile (< 640px)

- Sidebar hidden by default; accessible via bottom sheet or modal.
- Charts stack at full width, 140px height each.
- Brush/zoom replaced by date range selector dropdown.
- Only show top 4 charts (AHI, Usage, Leak, Events); Pressure and Settings available via "Show more charts" toggle.

### Responsive Breakpoints

```css
@media (max-width: 1199px) {
  .trendsLayout {
    grid-template-columns: 1fr;
  }
  .sidebar {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    width: 320px;
    z-index: var(--z-overlay);
    transform: translateX(100%);
    transition: transform var(--transition-base);
  }
  .sidebar.open {
    transform: translateX(0);
  }
}

@media (max-width: 639px) {
  .chartsColumn {
    padding: var(--space-md);
    gap: var(--space-sm);
  }
}
```

---

## 2. Chart Specifications

All charts share the same x-axis domain and are rendered as a coordinated set. Each chart is wrapped in a `ChartPanel` container component.

### Common Chart Configuration

```typescript
interface ChartPanelProps {
  title: string;
  chartHeight: number; // px, responsive
  children: React.ReactNode; // Recharts chart
  accessibleSummary: string; // Screen reader text
}
```

**Shared properties across all charts:**

- X-axis: hidden on individual charts; a single shared axis renders at the bottom of the stack
- Y-axis: visible, right-aligned to keep data labels away from the chart edge
- Grid: horizontal lines only, `var(--color-chart-grid)`
- Cursor sync: all charts are wrapped in a `<SyncedChartGroup>` context provider
- Margin: `{ top: 8, right: 8, bottom: 0, left: 0 }`
- Animation: `isAnimationActive={false}` for performance with large datasets

### Chart Panel Visual

```
┌──────────────────────────────────────────────────┐
│  AHI                                    [⋮]     │  ← Title + options menu
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ── │
│                                                  │
│  [Chart content area]                            │
│                                                  │
└──────────────────────────────────────────────────┘
```

- Title: `var(--font-size-sm)`, `var(--font-weight-semibold)`, `var(--color-text-secondary)`
- Top border: 1px solid `var(--color-border-subtle)`
- Background: `var(--color-surface-primary)`
- Options menu (⋮): Toggle chart visibility, export chart data as CSV

---

### 2.1 AHI Chart

**Type**: `<ComposedChart>` (Recharts)

**Data fields** (from `NightlyAggregate[]`):

- **x**: `date`
- **y**: `ahi`

**Layers:**

| Layer                   | Recharts Component | Config                                                                |
| ----------------------- | ------------------ | --------------------------------------------------------------------- |
| Normal zone (0–5)       | `<ReferenceArea>`  | y1=0, y2=5, fill=`var(--color-status-normal-bg)`                      |
| Mild zone (5–15)        | `<ReferenceArea>`  | y1=5, y2=15, fill=`var(--color-status-mild-bg)`                       |
| Moderate zone (15–30)   | `<ReferenceArea>`  | y1=15, y2=30, fill=`var(--color-status-moderate-bg)`                  |
| Severe zone (30+)       | `<ReferenceArea>`  | y1=30, y2=domainMax, fill=`var(--color-status-severe-bg)`             |
| AHI line                | `<Line>`           | stroke=`var(--color-chart-1)`, strokeWidth=1.5, dot=false             |
| Settings change markers | `<ReferenceLine>`  | x=changeDate, stroke=`var(--color-text-muted)`, strokeDasharray="4 4" |

**Y-axis**: `[0, Math.max(maxAHI * 1.1, 10)]`  
**Height**: 180px (desktop), 160px (tablet), 140px (mobile)

**Zone labels**: Rendered as right-aligned text annotations inside each zone band (not as legend items). Use `<text>` elements in Recharts customization or CSS-positioned labels.

**Accessibility:**

- `aria-label="AHI trend chart with clinical severity zones"`
- Zone labels provide non-color information about thresholds.

---

### 2.2 Usage Hours Chart

**Type**: `<BarChart>` (Recharts)

**Data fields**:

- **x**: `date`
- **y**: `usageHours`

**Layers:**

| Layer            | Component         | Config                                                                      |
| ---------------- | ----------------- | --------------------------------------------------------------------------- |
| Usage bars       | `<Bar>`           | Per-bar coloring (see Dashboard spec), barSize responsive                   |
| CMS line (4h)    | `<ReferenceLine>` | y=4, stroke=`var(--color-warning)`, strokeDasharray="6 3", label="4h"       |
| Target line (6h) | `<ReferenceLine>` | y=6, stroke=`var(--color-status-normal)`, strokeDasharray="6 3", label="6h" |

**Bar sizing**: For date ranges < 60 days, use default bar width. For 60–180 days, reduce bar width. For 180+ days, switch to a `<Line>` chart with area fill for readability.

**Y-axis**: `[0, Math.max(maxUsage * 1.1, 8)]`  
**Height**: 160px

---

### 2.3 Leak Rate Chart

**Type**: `<ComposedChart>` (Recharts)

**Data fields**:

- **x**: `date`
- **Median line**: `leakMedian`
- **P95 band**: upper bound = `leakP95`, lower bound = `leakMedian`

**Layers:**

| Layer             | Component         | Config                                                                                        |
| ----------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| P95 band          | `<Area>`          | dataKey=`leakP95`, fill=`var(--color-chart-6)`, fillOpacity=0.15, stroke="none"               |
| Median baseline   | `<Area>`          | dataKey=`leakMedian`, fill=`var(--color-surface-primary)`, stroke="none" (clips the P95 band) |
| Median line       | `<Line>`          | dataKey=`leakMedian`, stroke=`var(--color-chart-6)`, strokeWidth=1.5, dot=false               |
| Warning threshold | `<ReferenceLine>` | y=24, stroke=`var(--color-warning)`, strokeDasharray="6 3", label="24 L/min"                  |

**Implementation note**: The band between median and P95 is achieved by stacking two areas. The bottom area (median) uses the surface background color to "erase" below the median, leaving only the region between median and P95 filled.

**Alternative approach**: Use Recharts' `<Area>` with a custom shape that draws the band, or compute the band as: `bandData = aggregates.map(a => ({ date: a.date, lower: a.leakMedian, upper: a.leakP95 }))` and render with two `<Area>` components using `baseLine` prop.

**Y-axis**: `[0, Math.max(maxLeakP95 * 1.1, 30)]`  
**Height**: 160px

---

### 2.4 Pressure Chart

**Type**: `<ComposedChart>` (Recharts)

**Data fields**:

- **x**: `date`
- **Mean line**: `pressureMean`
- **P95 band**: upper = `pressureP95`, lower = `pressureMean`

**Layers:**

| Layer          | Component         | Config                                                                                                          |
| -------------- | ----------------- | --------------------------------------------------------------------------------------------------------------- |
| P95 band       | `<Area>`          | Same band technique as Leak chart, fill=`var(--color-chart-4)`, fillOpacity=0.15                                |
| Mean line      | `<Line>`          | stroke=`var(--color-chart-4)`, strokeWidth=1.5, dot=false                                                       |
| Configured min | `<ReferenceLine>` | y=configuredMinPressure (from latest agg), stroke=`var(--color-text-muted)`, strokeDasharray="3 3", label="Min" |
| Configured max | `<ReferenceLine>` | y=configuredMaxPressure (from latest agg), stroke=`var(--color-text-muted)`, strokeDasharray="3 3", label="Max" |

**Y-axis**: `[Math.max(minPressure - 2, 0), maxPressure + 2]`  
**Height**: 160px

---

### 2.5 Event Breakdown Chart

**Type**: `<AreaChart>` (Recharts, stacked)

**Data fields** (from `NightlyAggregate.eventsByType`):

- **x**: `date`
- **Stacked series**:

| Series      | Data Field                 | Color                  | Stack Order |
| ----------- | -------------------------- | ---------------------- | ----------- |
| Obstructive | `eventsByType.obstructive` | `var(--color-chart-2)` | 1 (bottom)  |
| Central     | `eventsByType.central`     | `var(--color-chart-4)` | 2           |
| Hypopnea    | `eventsByType.hypopnea`    | `var(--color-chart-1)` | 3           |
| Mixed       | `eventsByType.mixed`       | `var(--color-chart-5)` | 4           |
| RERA        | `eventsByType.rera`        | `var(--color-chart-6)` | 5 (top)     |

**Configuration**: Same as Dashboard event chart, but with longer time range.  
**Legend**: Inline below the chart (horizontal flex, wrapping).  
**Height**: 160px

---

### 2.6 Machine Settings Chart

**Type**: `<ComposedChart>` (Recharts, step lines)

**Data source**: Derive from `NightlyAggregate[]` fields `configuredMinPressure`, `configuredMaxPressure`, `eprLevel`:

```typescript
// Transform aggregates into settings step data
interface SettingsDataPoint {
  date: string;
  minPressure: number | null;
  maxPressure: number | null;
  eprLevel: number | null;
}
```

**Layers:**

| Layer               | Component | Config                                                                                |
| ------------------- | --------- | ------------------------------------------------------------------------------------- |
| Max pressure        | `<Line>`  | type="stepAfter", stroke=`var(--color-chart-2)`, strokeWidth=1.5, dot=false           |
| Min pressure        | `<Line>`  | type="stepAfter", stroke=`var(--color-chart-3)`, strokeWidth=1.5, dot=false           |
| Pressure range fill | `<Area>`  | Between min and max, fill=`var(--color-chart-1)`, fillOpacity=0.08                    |
| EPR level           | `<Line>`  | type="stepAfter", stroke=`var(--color-chart-5)`, strokeDasharray="4 2", yAxisId="epr" |

**Dual y-axes:**

- Left: Pressure (cmH₂O)
- Right: EPR Level (0–3)

**Height**: 120px (shorter — settings change infrequently)

**Change markers**: On dates where settings differ from the previous day, render a vertical `<ReferenceLine>` with a label icon (▲). These same markers appear on all other charts as vertical dashed lines.

**Empty state**: If no settings data exists across any aggregates, hide this chart entirely and show a note below the Events chart: "Machine settings data not available."

---

## 3. Shared Interactions

### 3.1 Synchronized Crosshair

All charts share a crosshair that moves together. When the user hovers over any chart, all charts highlight the same x-position (date).

**Implementation**: Use a React context (`SyncedChartContext`) that stores the active date and crosshair position. Each chart subscribes to this context and renders a `<ReferenceLine>` at the active x position.

```typescript
interface SyncedChartContextValue {
  activeDate: string | null;
  activeX: number | null; // pixel position for crosshair
  setActiveDate: (date: string | null) => void;
  setActiveX: (x: number | null) => void;
}
```

**Visual**: Vertical line, 1px, `var(--color-text-muted)`, opacity 0.5. Follows cursor across all charts simultaneously.

**Tooltip**: A single floating tooltip panel appears next to the cursor (or at the top of the chart stack) showing all metrics for the hovered date:

```
┌──────────────────────────┐
│  Oct 15, 2024            │
│  ────────────────────── │
│  AHI          3.2        │
│  Usage        6.8 hrs    │
│  Leak (med)   12.4 L/min │
│  Leak (P95)   18.7 L/min │
│  Pressure     9.2 cmH₂O  │
│  Events       14         │
│  Min P        6.0 cmH₂O  │
│  Max P        20.0 cmH₂O │
└──────────────────────────┘
```

- Tooltip position: Anchored to the crosshair x-position, positioned at the top of the visible chart area so it doesn't occlude any single chart.
- Use `var(--font-family-mono)` for values, right-aligned. Use `var(--font-family-sans)` for labels.

**Keyboard interaction:**

- When the chart area is focused, `←` / `→` arrow keys move the crosshair one data point at a time.
- `Home` / `End` jump to the first / last data point in the visible range.
- The tooltip content is announced to screen readers as the crosshair moves (use `aria-live="polite"` on the tooltip container).

### 3.2 Shared X-Axis Zoom (Brush)

A date range brush control at the top of the chart stack allows zooming into a sub-range within the loaded data.

**Component**: `DateBrush`

**Implementation**: Use Recharts' `<Brush>` component on a miniature overview chart (AHI line, ~40px tall, no axes, simplified). The brush handle positions sync to all charts below via the `SyncedChartContext`.

```
┌──────────────────────────────────────────────────────────────┐
│  ▁▂▃▄▃▂▁▂▃▅▇█▇▅▃▂▁▂▃▄▃▂▁  [▓▓▓▓▓▓▓▓▓▓▓▓▓]  ▁▂▃▄▃▂▁▂▃   │
│                              ↑ drag handles ↑                │
└──────────────────────────────────────────────────────────────┘
```

**Brush behavior:**

- Drag handles to resize the visible range.
- Drag the selected region to pan.
- Double-click the brush to reset to full range.
- The brush miniature shows AHI as the overview metric (most clinically relevant).

**Keyboard interaction:**

- When brush is focused, `←` / `→` shift the window by one data point.
- `Shift + ←` / `Shift + →` expand/contract the window from the right edge.
- `Ctrl/Cmd + ←` / `Ctrl/Cmd + →` expand/contract from the left edge.

**Interactions with DateRangeSelector:**

- The `DateRangeSelector` in the header controls the _loaded_ data range (what's fetched from IndexedDB).
- The brush controls the _visible_ sub-range within the loaded data.
- Changing the `DateRangeSelector` resets the brush to show the full loaded range.

### 3.3 Date Range Selector

Reuse the existing `DateRangeSelector` component with presets:

| Preset        | Range                             |
| ------------- | --------------------------------- |
| Last 7 days   | Today − 7                         |
| Last 30 days  | Today − 30                        |
| Last 90 days  | Today − 90                        |
| Last 6 months | Today − 180                       |
| Last year     | Today − 365                       |
| All time      | Earliest session → latest session |
| Custom        | Date picker                       |

Default for the Trends view: **Last 90 days** (wider than Dashboard's 30-day default).

### 3.4 Click to Navigate

Clicking a data point on any chart navigates to the session detail view for that night.

```typescript
function handleDataPointClick(date: string) {
  // Look up sessionId from aggregates
  const agg = aggregates.find((a) => a.date === date);
  if (agg) {
    navigate(`/sessions/${agg.sessionId}`);
  }
}
```

**Visual feedback**: On hover, the data point enlarges (activeDot radius 5px → 7px). Cursor changes to `pointer`.

---

## 4. Summary Statistics Sidebar

Displays descriptive statistics for the visible date range (respecting the brush selection, not the full loaded range).

### Layout

```
┌──────────────────────────┐
│  Summary Statistics       │
│  Oct 1 – Oct 31, 2024    │  ← visible range
│                           │
│  AHI                      │
│  ─────────────────────── │
│  Mean     3.4             │
│  Median   2.8             │
│  Std Dev  1.7             │
│  Min      0.8             │
│  Max      8.2             │
│  Trend    ↓ 12%           │
│                           │
│  Usage Hours              │
│  ─────────────────────── │
│  Mean     6.2 hrs         │
│  Median   6.5 hrs         │
│  Std Dev  1.1 hrs         │
│  Min      3.2 hrs         │
│  Max      8.1 hrs         │
│  Trend    → stable        │
│                           │
│  Leak Rate (median)       │
│  ─────────────────────── │
│  Mean     14.2 L/min      │
│  Median   12.8 L/min      │
│  Std Dev  4.3 L/min       │
│  Min      6.1 L/min       │
│  Max      28.4 L/min      │
│  Trend    ↑ 8%            │
│                           │
│  Pressure (mean)          │
│  ─────────────────────── │
│  Mean     9.4 cmH₂O      │
│  Median   9.2 cmH₂O      │
│  Std Dev  0.8 cmH₂O      │
│  Min      7.1 cmH₂O      │
│  Max      12.3 cmH₂O     │
│  Trend    → stable        │
│                           │
│  Compliance               │
│  ─────────────────────── │
│  Rate     87%             │
│  Nights   26/30           │
│  CMS      ✓ Meets        │
│                           │
│  Events (per night avg)   │
│  ─────────────────────── │
│  Total    14.2            │
│  Obstr.   6.8             │
│  Central  2.1             │
│  Hypop.   4.1             │
│  Mixed    0.5             │
│  RERA     0.7             │
└──────────────────────────┘
```

### Component: `StatsSidebar`

**Props:**

```typescript
interface StatsSidebarProps {
  aggregates: NightlyAggregate[]; // Filtered to visible range
  visibleRange: { start: string; end: string };
  open: boolean; // For tablet/mobile drawer
  onClose: () => void;
}
```

**Computed statistics per metric:**

```typescript
interface MetricStats {
  label: string;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  trendDirection: 'up' | 'down' | 'stable';
  trendPercent: number;
}
```

**Computation**: Use a pure function `computeDescriptiveStats(values: number[]): Omit<MetricStats, 'label'>` that calculates mean, median, standard deviation, min, max. Trend is computed as the percentage difference between the mean of the first third and last third of the values.

**Typography:**

- Section headers: `var(--font-size-sm)`, `var(--font-weight-semibold)`, `var(--color-text-primary)`
- Labels: `var(--font-size-xs)`, `var(--color-text-secondary)`
- Values: `var(--font-size-sm)`, `var(--font-weight-medium)`, `var(--font-family-mono)`, `tabular-nums`

**Accessibility:**

- Sidebar has `role="complementary"` with `aria-label="Summary statistics for visible date range"`.
- On tablet/mobile drawer: has `role="dialog"` with `aria-modal="true"`, focus trapped within.
- Toggle button: `aria-expanded` reflects open/close state.

---

## 5. Annotations

### Settings Change Markers

Vertical dashed lines on all charts at dates where machine settings changed. Derived by comparing consecutive `NightlyAggregate` records for differences in `configuredMinPressure`, `configuredMaxPressure`, or `eprLevel`.

**Detection logic:**

```typescript
function detectSettingsChanges(aggregates: NightlyAggregate[]): SettingsChange[] {
  const sorted = [...aggregates].sort((a, b) => a.date.localeCompare(b.date));
  const changes: SettingsChange[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;

    if (
      prev.configuredMinPressure !== curr.configuredMinPressure ||
      prev.configuredMaxPressure !== curr.configuredMaxPressure ||
      prev.eprLevel !== curr.eprLevel
    ) {
      changes.push({
        date: curr.date,
        from: {
          minPressure: prev.configuredMinPressure,
          maxPressure: prev.configuredMaxPressure,
          eprLevel: prev.eprLevel,
        },
        to: {
          minPressure: curr.configuredMinPressure,
          maxPressure: curr.configuredMaxPressure,
          eprLevel: curr.eprLevel,
        },
      });
    }
  }
  return changes;
}
```

**Visual:**

- Vertical line: `var(--color-text-muted)`, 1px, strokeDasharray="4 4"
- Small triangle marker (▲) at the top of the line, 8px, `var(--color-text-muted)`
- On hover: tooltip showing what changed (e.g., "Max pressure changed from 16.0 to 20.0 cmH₂O")

**Annotations legend** at the bottom of the chart stack:

```
▲ Settings Change    ● User Note (future)
```

---

## 6. Component Hierarchy

```
TrendsView (view, route: /trends)
├── TrendsHeader
│   ├── Breadcrumb: "◄ Dashboard"
│   ├── h1: "Trends"
│   ├── DateRangeSelector (existing, with extended presets)
│   └── SidebarToggle (tablet/mobile) — aria-expanded
│
├── TrendsLayout (grid: charts + sidebar)
│   ├── ChartsColumn
│   │   ├── DateBrush
│   │   │   └── Recharts Brush on miniature AHI overview
│   │   │
│   │   ├── SyncedChartGroup (context provider)
│   │   │   ├── ChartPanel (AHI)
│   │   │   │   ├── ComposedChart
│   │   │   │   ├── ReferenceArea ×4 (severity zones)
│   │   │   │   ├── Line (AHI)
│   │   │   │   └── ReferenceLine[] (settings changes)
│   │   │   │
│   │   │   ├── ChartPanel (Usage)
│   │   │   │   ├── BarChart (or LineChart for 180+ days)
│   │   │   │   ├── ReferenceLine (4h CMS)
│   │   │   │   ├── ReferenceLine (6h target)
│   │   │   │   └── ReferenceLine[] (settings changes)
│   │   │   │
│   │   │   ├── ChartPanel (Leak Rate)
│   │   │   │   ├── ComposedChart
│   │   │   │   ├── Area (P95 band)
│   │   │   │   ├── Line (median)
│   │   │   │   ├── ReferenceLine (24 L/min warning)
│   │   │   │   └── ReferenceLine[] (settings changes)
│   │   │   │
│   │   │   ├── ChartPanel (Pressure)
│   │   │   │   ├── ComposedChart
│   │   │   │   ├── Area (P95 band)
│   │   │   │   ├── Line (mean)
│   │   │   │   ├── ReferenceLine (configured min)
│   │   │   │   ├── ReferenceLine (configured max)
│   │   │   │   └── ReferenceLine[] (settings changes)
│   │   │   │
│   │   │   ├── ChartPanel (Events)
│   │   │   │   ├── AreaChart (stacked)
│   │   │   │   ├── Area ×5 (event types)
│   │   │   │   └── ReferenceLine[] (settings changes)
│   │   │   │
│   │   │   ├── ChartPanel (Settings) — conditional
│   │   │   │   ├── ComposedChart
│   │   │   │   ├── Line (minPressure, stepAfter)
│   │   │   │   ├── Line (maxPressure, stepAfter)
│   │   │   │   ├── Area (pressure range fill)
│   │   │   │   └── Line (EPR, secondary y-axis)
│   │   │   │
│   │   │   └── SharedXAxis
│   │   │       └── XAxis (dates, tick formatting)
│   │   │
│   │   ├── SyncedTooltip (floating, positioned at crosshair)
│   │   └── AnnotationsLegend
│   │
│   └── StatsSidebar
│       ├── MetricStatsSection (AHI)
│       ├── MetricStatsSection (Usage)
│       ├── MetricStatsSection (Leak)
│       ├── MetricStatsSection (Pressure)
│       ├── ComplianceSection
│       └── EventBreakdownSection
│
└── ErrorBoundary (per-chart, not per-view)
```

---

## 7. Data Requirements

### Hooks Needed

| Hook                      | Exists? | Returns                      | Used By                  |
| ------------------------- | ------- | ---------------------------- | ------------------------ |
| `useAppStore` (dateRange) | Yes     | `{ start: Date, end: Date }` | Data loading             |
| `useNightlyAggregates`    | Yes     | `NightlyAggregate[]`         | All charts, sidebar      |
| `useSessionData`          | Yes     | `Session[]`                  | Click-to-navigate lookup |

### New Hooks / Utilities

**`useBrushRange`** — Manages the brush (sub-range) state within the loaded data:

```typescript
interface UseBrushRangeResult {
  visibleRange: { startIndex: number; endIndex: number };
  visibleAggregates: NightlyAggregate[];
  setVisibleRange: (start: number, end: number) => void;
  resetRange: () => void;
}
```

**`useSyncedCrosshair`** — Context hook for coordinating crosshair across charts:

```typescript
interface SyncedCrosshairState {
  activeDate: string | null;
  activeIndex: number | null;
  setActive: (date: string | null, index: number | null) => void;
  clear: () => void;
}
```

**`computeDescriptiveStats`** — Pure function (not a hook):

```typescript
// src/analysis/descriptiveStats.ts
export function computeDescriptiveStats(values: number[]): {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
};
```

**`detectSettingsChanges`** — Pure function:

```typescript
// src/analysis/detectSettingsChanges.ts
export function detectSettingsChanges(aggregates: NightlyAggregate[]): SettingsChange[];
```

### Data Volume Considerations

| Date Range  | Data Points | Strategy                                                                                                 |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| ≤ 90 days   | ≤ 90        | Render all points, full detail                                                                           |
| 91–365 days | 91–365      | Render all points, reduce dot size, narrower bars                                                        |
| 366+ days   | 366+        | Downsample to weekly averages for line/area charts; keep bars but switch to weekly average if > 180 days |

Downsampling is done client-side in a `useMemo` with the aggregates array as dependency. The sidebar always computes stats from the full (non-downsampled) visible data.

---

## 8. Navigation Integration

### Route Registration

Add to `src/router.tsx`:

```typescript
const Trends = lazy(() => import('@/views/Trends/TrendsView'));

// Inside route children:
{
  path: 'trends',
  element: (
    <SuspenseWrapper>
      <Trends />
    </SuspenseWrapper>
  ),
},
```

### Navigation Tab

Add "Trends" to the main navigation tab bar, between "Sessions" and "Analysis":

```
Dashboard │ Sessions │ Trends │ Analysis │ Reports
```

Tab order reflects the workflow: overview → browse sessions → analyze trends → deep analysis → reports.

---

## 9. Performance Considerations

- **Virtualization**: Charts themselves don't need virtualization (Recharts handles SVG path optimization). But if the chart stack is long, only render charts in the viewport using `IntersectionObserver`.
- **Memoization**: Each chart should be wrapped in `React.memo` and only re-render when its data slice or brush range changes.
- **Worker computation**: If `computeDescriptiveStats` becomes slow for very large datasets (1000+ points), move it to a web worker. For typical CPAP data (365 points/year), main-thread computation is fine.
- **Debounced brush**: Brush drag should debounce chart re-renders at 16ms (one frame) to prevent jank.
- **SVG optimization**: With `isAnimationActive={false}`, Recharts renders static SVG which is fast. Avoid `<Dot>` components on line charts for datasets > 90 points.

---

## 10. File Structure

```
src/views/Trends/
├── TrendsView.tsx                ← Main view
├── TrendsView.module.css         ← Layout grid
├── TrendsHeader.tsx              ← Title, breadcrumb, date selector, sidebar toggle
├── TrendsHeader.module.css
├── charts/
│   ├── ChartPanel.tsx            ← Reusable chart container
│   ├── ChartPanel.module.css
│   ├── AHITrendChart.tsx
│   ├── UsageChart.tsx
│   ├── LeakRateChart.tsx
│   ├── PressureChart.tsx
│   ├── EventBreakdownChart.tsx
│   ├── SettingsChart.tsx
│   ├── DateBrush.tsx             ← Brush/zoom control
│   ├── DateBrush.module.css
│   ├── SharedXAxis.tsx           ← Rendered once at bottom
│   └── SyncedTooltip.tsx         ← Floating combined tooltip
├── sidebar/
│   ├── StatsSidebar.tsx
│   ├── StatsSidebar.module.css
│   ├── MetricStatsSection.tsx    ← Reusable stats block
│   └── MetricStatsSection.module.css
└── context/
    ├── SyncedChartContext.tsx     ← Crosshair sync provider
    └── BrushRangeContext.tsx      ← Brush range state

src/analysis/
├── descriptiveStats.ts           ← Pure computation
├── descriptiveStats.test.ts
├── detectSettingsChanges.ts      ← Settings diff logic
└── detectSettingsChanges.test.ts
```

---

## 11. Design Token Usage Reference

| Element                | Token                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Chart background       | `var(--color-surface-primary)`                                                      |
| Chart panel border     | `var(--color-border-subtle)`, 1px solid                                             |
| Chart panel title      | `var(--font-size-sm)`, `var(--font-weight-semibold)`, `var(--color-text-secondary)` |
| Sidebar background     | `var(--color-surface-secondary)`                                                    |
| Sidebar border         | `var(--color-border-default)`                                                       |
| Sidebar section header | `var(--font-size-sm)`, `var(--font-weight-semibold)`                                |
| Sidebar values         | `var(--font-family-mono)`, `var(--font-size-sm)`, `tabular-nums`                    |
| Sidebar labels         | `var(--font-size-xs)`, `var(--color-text-secondary)`                                |
| Crosshair line         | `var(--color-text-muted)`, 1px, opacity 0.5                                         |
| Tooltip background     | `var(--color-chart-tooltip-bg)`                                                     |
| Tooltip border         | `var(--color-chart-tooltip-border)`                                                 |
| Tooltip shadow         | `var(--shadow-md)`                                                                  |
| Brush handle           | `var(--color-primary)`                                                              |
| Brush selected region  | `var(--color-primary)`, opacity 0.1                                                 |
| Settings change marker | `var(--color-text-muted)`, strokeDasharray "4 4"                                    |
| Annotation triangle    | `var(--color-text-muted)`, 8px                                                      |

---

## 12. Accessibility Summary

| Requirement                | Implementation                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| Keyboard chart navigation  | Arrow keys move crosshair; Home/End jump to range edges                                            |
| Screen reader chart access | Each `ChartPanel` has `aria-label` and hidden summary text                                         |
| Crosshair announcements    | `aria-live="polite"` on tooltip, announces metric values                                           |
| Color independence         | Severity zones have text labels; event types have legend labels; threshold lines have value labels |
| Focus management           | Sidebar drawer traps focus when open; Escape closes it                                             |
| Brush keyboard control     | Arrow keys shift, Shift+Arrow resizes, documented in keyboard shortcuts                            |
| Reduced motion             | `isAnimationActive={false}` default; respects `prefers-reduced-motion`                             |
| Touch support              | Brush supports touch drag; charts support tap for data point selection                             |
