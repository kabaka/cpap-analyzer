# Dashboard Redesign — Control Room

**Status**: Design Specification  
**Last Updated**: February 12, 2026  
**Target**: `src/views/Dashboard/Dashboard.tsx` (replaces current implementation)

## Overview

Replace the current minimal dashboard (4 KPI cards + sessions table) with a dense, information-rich "control room" layout. The redesigned dashboard surfaces deep analytical insight across six distinct panels, giving data-literate patients a comprehensive therapy overview at a glance.

### Design Principles Applied

- **Data first**: Every panel shows real data, not decoration. No filler content.
- **Progressive disclosure**: Summary metrics visible immediately; hover/click for deeper detail.
- **Clinical context always available**: Severity badges, threshold lines, and tooltip explanations on every metric.

---

## 1. Layout Grid

### Desktop (≥ 1200px) — 12-column grid

```
┌─────────────────────────────────────────────────────────────┐
│  Header: "Dashboard"                    [DateRangeSelector] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                  │
│  │ AHI │ │Leak │ │Comp%│ │Usage│ │P95  │   ← KPI Row       │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘                  │
│                                                             │
│  ┌──────────────────────┐ ┌──────────────────────┐         │
│  │   AHI Trend Chart    │ │  Usage Hours Chart   │         │
│  │   (severity zones)   │ │  (compliance lines)  │         │
│  └──────────────────────┘ └──────────────────────┘         │
│                                                             │
│  ┌──────────────────────┐ ┌──────────────────────┐         │
│  │  Event Distribution  │ │  Insights Panel      │         │
│  │  (stacked area)      │ │  (auto-generated)    │         │
│  └──────────────────────┘ └──────────────────────┘         │
│                                                             │
│  ┌──────────────────────┐ ┌──────────────────────┐         │
│  │  Machine Settings    │ │  Recent Sessions     │         │
│  │  (config summary)    │ │  (compact table)     │         │
│  └──────────────────────┘ └──────────────────────┘         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### CSS Grid Specification

```css
.dashboardGrid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  grid-template-rows: auto;
  gap: var(--space-lg); /* 24px */
  padding: var(--space-lg);
}

/* Row 1: KPI cards — 5 cards spanning 12 columns */
.kpiRow {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--space-md); /* 16px */
}

/* Row 2: Therapy Overview — two equal charts */
.therapyOverview {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-lg);
}

/* Row 3: Event Distribution + Insights — two equal panels */
.analyticsRow {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-lg);
}

/* Row 4: Machine Settings + Recent Sessions */
.bottomRow {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 2fr; /* Settings narrower than table */
  gap: var(--space-lg);
}
```

### Tablet (640px–1199px)

- KPI row: 3 + 2 cards (wrapping)
- Therapy Overview charts: stack vertically (1 column)
- Event Distribution + Insights: stack vertically
- Machine Settings + Recent Sessions: stack vertically

### Mobile (< 640px)

- All panels: single column, full width, stacked
- KPI cards: 2 per row, then 1 for the fifth
- Charts: full bleed with horizontal scroll for legends if needed

### Responsive Breakpoint Implementation

```css
/* Tablet */
@media (max-width: 1199px) {
  .kpiRow {
    grid-template-columns: repeat(3, 1fr);
  }
  .therapyOverview {
    grid-template-columns: 1fr;
  }
  .analyticsRow {
    grid-template-columns: 1fr;
  }
  .bottomRow {
    grid-template-columns: 1fr;
  }
}

/* Mobile */
@media (max-width: 639px) {
  .kpiRow {
    grid-template-columns: repeat(2, 1fr);
  }
  .dashboardGrid {
    padding: var(--space-md);
    gap: var(--space-md);
  }
}
```

---

## 2. Panel Specifications

### 2.1 Key Metrics Row (Enhanced KPI Cards)

Extends the existing `KPICard` component with sparklines and richer metadata.

#### Component: `EnhancedKPICard`

**Props Interface:**

```typescript
interface EnhancedKPICardProps {
  title: string;
  value: string;
  unit: string;
  trend: TrendDirection; // 'up' | 'down' | 'stable'
  trendPercent: number; // e.g., -15.2 (%)
  severity?: Severity; // 'normal' | 'mild' | 'moderate' | 'severe'
  sparklineData: number[]; // 30 values for the mini chart
  loading?: boolean;
  tooltip?: string; // Contextual help on hover
}
```

**Visual Specification:**

```
┌──────────────────────────────┐
│  AHI             [Normal ●]  │  ← Title + severity badge
│                              │
│  2.3  events/hr    ↓ 15%    │  ← Value + unit + trend w/ %
│                              │
│  ▁▂▃▂▁▂▃▄▃▂▁▁▂▃▂▁▂▃▂▁▂▃▂▁  │  ← Sparkline (30 days)
└──────────────────────────────┘
```

- **Sparkline**: Rendered with `Recharts` `<LineChart>` minimal config — no axes, no grid, no tooltip. Just the line path. Height: 32px. Color: `var(--color-chart-1)` by default, or severity-colored for AHI.
- **Trend arrow + percent**: Show the percentage change between the first and last 7-day average within the 30-day window. Arrow uses `var(--color-status-normal)` for favorable trends (AHI/leak down, usage/compliance up) and `var(--color-status-moderate)` for unfavorable trends.
- **Severity badge**: Only on AHI card; uses existing `Badge` component.
- **Tooltip**: On title hover, show a one-line clinical definition (e.g., "Apnea-Hypopnea Index — respiratory events per hour of sleep").

**Cards and their data sources (from `NightlyAggregate`):**

| Card          | Value Source                        | Sparkline Source                               | Trend Favorable Direction | Unit      |
| ------------- | ----------------------------------- | ---------------------------------------------- | ------------------------- | --------- |
| AHI           | `mean(ahi)`                         | `ahi[]`                                        | Down (lower is better)    | events/hr |
| Leak Rate     | `mean(leakMedian)`                  | `leakMedian[]`                                 | Down                      | L/min     |
| Compliance    | `compliantCount / totalCount * 100` | `(complianceStatus === 'compliant' ? 1 : 0)[]` | Up                        | %         |
| Usage         | `mean(usageHours)`                  | `usageHours[]`                                 | Up                        | hrs/night |
| Pressure 95th | `mean(pressureP95)`                 | `pressureP95[]`                                | Stable (informational)    | cmH₂O     |

**Accessibility:**

- Each card is an `article` landmark with `aria-label` describing the metric.
- Sparkline has `role="img"` with `aria-label` describing the trend in words (e.g., "30-day AHI trend, decreasing from 4.2 to 2.3").
- Trend arrow has text available to screen readers via `aria-label="Trend: down 15 percent"`.

---

### 2.2 Therapy Overview Panel

Two side-by-side Recharts charts within a shared `Card` container.

#### 2.2a AHI Trend Chart

**Chart Type**: `<LineChart>` (Recharts `<ComposedChart>` to allow reference areas)

**Data fields** (from `NightlyAggregate[]`, last 30 days sorted by date):

- **x-axis**: `date` (formatted as "Mon DD")
- **y-axis**: `ahi`

**Severity zone bands** (using Recharts `<ReferenceArea>`):

| Zone     | y1  | y2    | Fill Color                        | Label    |
| -------- | --- | ----- | --------------------------------- | -------- |
| Normal   | 0   | 5     | `var(--color-status-normal-bg)`   | Normal   |
| Mild     | 5   | 15    | `var(--color-status-mild-bg)`     | Mild     |
| Moderate | 15  | 30    | `var(--color-status-moderate-bg)` | Moderate |
| Severe   | 30  | y-max | `var(--color-status-severe-bg)`   | Severe   |

**Visual configuration:**

- Line color: `var(--color-chart-1)`
- Line width: 2px
- Dot radius: 3px (active dot: 5px)
- Grid: horizontal only, `var(--color-chart-grid)`
- Y-axis domain: `[0, Math.max(maxAHI * 1.1, 10)]` — always show at least 0–10
- Tooltip: Show date, AHI value, and severity label
- Chart height: 280px (desktop), 220px (tablet/mobile)

**Accessibility:**

- `aria-label="AHI trend over the last 30 days"`
- Provide a visually hidden summary: "AHI ranged from X to Y over the period, with a mean of Z (severity)."
- Severity zone labels should NOT rely solely on color — include text labels positioned at the right edge of each zone band.

#### 2.2b Usage Hours Bar Chart

**Chart Type**: `<BarChart>` (Recharts)

**Data fields** (from `NightlyAggregate[]`, last 30 days sorted by date):

- **x-axis**: `date`
- **y-axis**: `usageHours`

**Reference lines:**

| Line           | Value   | Style                                     | Label       |
| -------------- | ------- | ----------------------------------------- | ----------- |
| CMS Compliance | 4.0 hrs | Dashed, `var(--color-warning)`, 1px       | "4h (CMS)"  |
| Target         | 6.0 hrs | Dashed, `var(--color-status-normal)`, 1px | "6h target" |

**Bar coloring:**

- `usageHours >= 6`: `var(--color-status-normal)` (met target)
- `4 <= usageHours < 6`: `var(--color-chart-1)` (compliant but below target)
- `usageHours < 4`: `var(--color-status-severe)` (non-compliant)

Use a custom Recharts `<Cell>` renderer for per-bar coloring.

**Visual configuration:**

- Bar radius: `[var(--radius-sm), var(--radius-sm), 0, 0]` (rounded top corners)
- Grid: horizontal only
- Y-axis domain: `[0, Math.max(maxUsage * 1.1, 8)]`
- Tooltip: Show date and formatted hours
- Chart height: 280px

**Accessibility:**

- `aria-label="Nightly usage hours for the last 30 days"`
- Threshold lines are also described in a visually hidden text block.
- Bar colors are supplemented by the reference lines (not color-only information).

---

### 2.3 Event Distribution Panel

**Chart Type**: `<AreaChart>` (Recharts, stacked)

**Data fields** (from `NightlyAggregate[]`, last 30 days sorted by date):

- **x-axis**: `date`
- **Stacked series** (from `eventsByType`):

| Series      | Data Field                 | Color Token                     | Stack Order (bottom → top) |
| ----------- | -------------------------- | ------------------------------- | -------------------------- |
| Obstructive | `eventsByType.obstructive` | `var(--color-chart-2)` (red)    | 1                          |
| Central     | `eventsByType.central`     | `var(--color-chart-4)` (purple) | 2                          |
| Hypopnea    | `eventsByType.hypopnea`    | `var(--color-chart-1)` (blue)   | 3                          |
| Mixed       | `eventsByType.mixed`       | `var(--color-chart-5)` (orange) | 4                          |
| RERA        | `eventsByType.rera`        | `var(--color-chart-6)` (cyan)   | 5                          |

**Visual configuration:**

- Area opacity: 0.6
- Stroke width: 1.5px
- Stacked mode: `stackId="events"`
- Grid: horizontal only
- Chart height: 280px
- Legend: Below chart, horizontal, using colored squares with labels
- Tooltip: Show all event types for the hovered date, with total

**Accessibility:**

- Legend items are not color-only — each has a text label.
- Screen reader summary: "Event distribution across 5 event types over 30 days. Obstructive events are the most frequent at an average of X per night."
- Patterns (stripes, dots) should be considered as a future enhancement for colorblind users. For now, rely on the legend labels and tooltip.

---

### 2.4 Machine Settings Panel

**Component**: `MachineSettingsPanel`

Displays the current machine configuration as a structured key-value list within a `Card`.

**Data source**: `Session.machineSettings` from the most recent session in the date range. If multiple settings configurations exist across the date range, show the current one with a "Settings changed on [date]" notice.

**Fields to display:**

| Label           | Source Field                      | Format                   | Shown When |
| --------------- | --------------------------------- | ------------------------ | ---------- |
| Therapy Mode    | `machineSettings.therapyMode`     | String (e.g., "APAP")    | Always     |
| Min Pressure    | `machineSettings.minPressure`     | `X.X cmH₂O`              | Not null   |
| Max Pressure    | `machineSettings.maxPressure`     | `X.X cmH₂O`              | Not null   |
| EPR Level       | `machineSettings.eprLevel`        | `0–3`                    | Not null   |
| EPR Type        | `machineSettings.eprType`         | String                   | Not null   |
| Ramp Time       | `machineSettings.rampTime`        | `X min` / "Auto" / "Off" | Not null   |
| Ramp Pressure   | `machineSettings.rampPressure`    | `X.X cmH₂O`              | Not null   |
| Mask Type       | `machineSettings.maskType`        | String                   | Not null   |
| Humidifier      | `machineSettings.humidifierLevel` | `Level X/8`              | Not null   |
| Climate Control | `machineSettings.climateControl`  | "On" / "Off"             | Not null   |
| SmartStart      | `machineSettings.smartStart`      | "On" / "Off"             | Not null   |

**Layout:**

```
┌─────────────────────────────────┐
│  Machine Settings         [i]  │  ← Card header + info tooltip
│                                 │
│  Therapy Mode      APAP        │
│  Pressure Range    6.0–20.0    │  ← Combine min/max into range
│  EPR               Level 2     │
│  Ramp              15 min      │
│  Mask Type         Nasal       │
│  Humidifier        Level 4     │
│  ───────────────────────────── │
│  ⚠ Settings changed Nov 3     │  ← If detected
└─────────────────────────────────┘
```

- Use a two-column `<dl>` (definition list) for the key-value pairs.
- Font: `var(--font-family-mono)` for values. `var(--font-family-sans)` for labels.
- If `machineSettings` is null on all sessions, show an empty state: "No machine settings data available. Settings are read from the STR.edf file on your SD card."

**Settings change detection logic:**

```typescript
// Compare configuredMinPressure, configuredMaxPressure, eprLevel
// across all NightlyAggregates in the date range.
// If any differ from the most recent, show a "changed on [date]" notice
// with the date being the first aggregate where the change appears.
```

**Accessibility:**

- `<dl>` with `<dt>` for labels and `<dd>` for values is natively accessible.
- Settings change notice uses `role="status"`.

---

### 2.5 Quick Stats / Insights Panel

**Component**: `InsightsPanel`

Auto-generated natural language insights computed from `NightlyAggregate[]` data in the selected date range. Displayed as a list of insight cards within a `Card` container.

**Insight Generation Rules:**

```typescript
interface Insight {
  id: string;
  icon: 'trending-down' | 'trending-up' | 'check' | 'alert' | 'info';
  severity: 'positive' | 'neutral' | 'warning';
  message: string;
}
```

| Condition                          | Icon          | Severity | Message Template                                                  |
| ---------------------------------- | ------------- | -------- | ----------------------------------------------------------------- |
| AHI trending down >10% over period | trending-down | positive | "Your AHI has decreased {X}% over the last {N} days"              |
| AHI trending up >10%               | trending-up   | warning  | "Your AHI has increased {X}% — consider reviewing recent changes" |
| Compliance ≥ 70% (CMS threshold)   | check         | positive | "Compliance rate is {X}% (above CMS threshold)"                   |
| Compliance < 70%                   | alert         | warning  | "Compliance rate is {X}% (below CMS 70% threshold)"               |
| Mean usage ≥ 6 hrs                 | check         | positive | "Average usage is {X} hours — excellent adherence"                |
| Mean usage < 4 hrs                 | alert         | warning  | "Average usage is {X} hours — below CMS minimum"                  |
| Leak P95 > 24 L/min                | alert         | warning  | "95th percentile leak is {X} L/min — check mask fit"              |
| Leak trending up >15%              | trending-up   | warning  | "Leak rates are trending up — check mask fit and seal"            |
| All metrics stable and good        | check         | positive | "All metrics are within normal ranges — keep it up!"              |
| Central apnea index > 5            | info          | neutral  | "Central apnea index is {X} — discuss with your provider"         |
| Machine settings changed in period | info          | neutral  | "Machine settings were changed on {date}"                         |

**Visual specification:**

```
┌─────────────────────────────────┐
│  Insights                       │
│                                 │
│  ✓  Your AHI has decreased 15% │
│     over the last 30 days       │
│                                 │
│  ✓  Compliance rate is 92%      │
│     (above CMS threshold)       │
│                                 │
│  ⚠  Leak rates are trending up  │
│     — check mask fit            │
│                                 │
│  ℹ  Central apnea index is 6.2  │
│     — discuss with your provider│
└─────────────────────────────────┘
```

- Each insight is a flex row: icon (24×24) + message text.
- Positive insights: icon `var(--color-status-normal)`, text `var(--color-text-primary)`.
- Warning insights: icon `var(--color-status-moderate)`, text `var(--color-text-primary)`.
- Neutral/info insights: icon `var(--color-info)`, text `var(--color-text-primary)`.
- Max insights shown: 5. If more are generated, show the most severe first.
- Empty state (no insights): "No significant trends detected in this date range."

**Accessibility:**

- Container has `aria-label="Therapy insights"`.
- Each insight is a `<li>` in an `<ul>`.
- Icons are decorative (`aria-hidden="true"`); the text alone conveys meaning.

---

### 2.6 Recent Sessions (Compact Table)

Reuses the existing `SessionsTable` component with a reduced `limit` and a subset of columns optimized for the dashboard.

**Columns (compact mode):**

| Column | Source                 | Format                 |
| ------ | ---------------------- | ---------------------- |
| Date   | `session.date`         | "Mon DD" (short)       |
| Usage  | `session.usageMinutes` | "X.Xh"                 |
| AHI    | `agg.ahi`              | "X.X" + severity color |
| Leak   | `agg.leakMedian`       | "X.X L/min"            |
| Events | `agg.eventCount`       | Integer                |
| Status | `agg.complianceStatus` | Badge: ✓ / ✗           |

- **Limit**: 7 sessions (one week)
- **Sort**: Date descending (most recent first)
- **Row click**: Navigate to `/sessions/{sessionId}`
- **Footer link**: "View all sessions →" links to `/sessions`

**Accessibility:**

- Inherits all accessibility from existing `SessionsTable` (keyboard navigation, sort indicators, row link semantics).

---

## 3. Component Hierarchy

```
Dashboard (view)
├── DashboardHeader
│   ├── h1 "Dashboard"
│   └── DateRangeSelector (existing)
│
├── KPIRow (section, aria-label="Key performance indicators")
│   ├── EnhancedKPICard (AHI)
│   ├── EnhancedKPICard (Leak Rate)
│   ├── EnhancedKPICard (Compliance)
│   ├── EnhancedKPICard (Usage)
│   └── EnhancedKPICard (Pressure P95)
│
├── TherapyOverviewRow (section, aria-label="Therapy overview charts")
│   ├── AHITrendChart
│   │   ├── Recharts ComposedChart
│   │   ├── ReferenceArea (severity zones) ×4
│   │   └── Line (AHI)
│   └── UsageBarChart
│       ├── Recharts BarChart
│       ├── ReferenceLine (4h CMS)
│       ├── ReferenceLine (6h target)
│       └── Bar (usage, per-bar coloring)
│
├── AnalyticsRow (section)
│   ├── EventDistributionChart
│   │   ├── Recharts AreaChart (stacked)
│   │   └── Area ×5 (event types)
│   └── InsightsPanel
│       └── InsightItem[] (list of generated insights)
│
├── BottomRow (section)
│   ├── MachineSettingsPanel
│   │   ├── SettingsList (dl)
│   │   └── SettingsChangeNotice (conditional)
│   └── RecentSessionsCard
│       ├── SessionsTable (compact, limit=7)
│       └── ViewAllLink
│
└── ErrorBanner (conditional, existing pattern)
```

---

## 4. Data Requirements

### Hooks Needed

| Hook                      | Exists?               | Returns                      | Used By                              |
| ------------------------- | --------------------- | ---------------------------- | ------------------------------------ |
| `useAppStore` (dateRange) | Yes                   | `{ start: Date, end: Date }` | All panels                           |
| `useSessionData`          | Yes                   | `Session[]`                  | Machine Settings, Recent Sessions    |
| `useSummaryStats`         | Yes (needs extension) | `SummaryStats`               | KPI cards, Insights                  |
| `useNightlyAggregates`    | Yes                   | `NightlyAggregate[]`         | All charts, Insights, KPI sparklines |

### Extensions to `useSummaryStats`

The existing `SummaryStats` interface should be extended:

```typescript
export interface SummaryStats {
  // ... existing fields ...

  // New fields for enhanced KPI cards
  meanPressureP95: number;
  trendAHIPercent: number; // % change (first 7d avg vs last 7d avg)
  trendLeakPercent: number;
  trendUsagePercent: number;
  trendCompliancePercent: number;
  trendPressureP95Percent: number;

  // Extended trend data (already partially exists as trendData[])
  // Ensure trendData includes pressureP95 and complianceStatus
}

export interface TrendDataPoint {
  date: string;
  ahi: number;
  leakMedian: number;
  usageHours: number;
  pressureP95: number; // Add
  complianceStatus: string; // Add
  eventsByType: {
    // Add
    obstructive: number;
    central: number;
    mixed: number;
    hypopnea: number;
    rera: number;
  };
}
```

### Insight Generation

Create a pure function (not a hook) for testability:

```typescript
// src/analysis/generateInsights.ts
export function generateInsights(aggregates: NightlyAggregate[], stats: SummaryStats): Insight[];
```

This function should be unit-tested independently.

---

## 5. Interaction Patterns

### Chart Tooltips

All charts use a shared custom tooltip component:

```typescript
interface ChartTooltipProps {
  date: string;
  metrics: { label: string; value: string; color?: string }[];
}
```

- Background: `var(--color-chart-tooltip-bg)`
- Border: `var(--color-chart-tooltip-border)`, 1px solid
- Border radius: `var(--radius-md)`
- Shadow: `var(--shadow-md)`
- Font: `var(--font-size-sm)`, `var(--font-family-sans)`
- Values: `var(--font-family-mono)`, `tabular-nums`

### Chart Click-Through

Clicking a data point on any chart navigates to that session's detail view (`/sessions/{sessionId}`). This requires looking up the `SessionId` from `NightlyAggregate.sessionId` by date.

### Loading States

- KPI cards: Use existing skeleton pattern in `KPICard` — extend to sparkline area.
- Charts: Show a shimmer/skeleton placeholder matching chart dimensions (280px height).
- Machine Settings: Skeleton lines for each row.
- Insights: Skeleton for 3 insight rows.

### Error States

- Per-panel error boundaries. If one chart fails, others continue to render.
- Error within a panel: Show a compact error card with "Failed to load [panel name]. Retry" button.
- Never block the entire dashboard for a single panel failure.

### Empty States

- No data at all: Show existing `EmptyState` component (import CTA).
- Partial data (e.g., no machine settings): Each panel handles its own empty state with a helpful message.

---

## 6. Performance Considerations

- Charts should render with the 30-day default window. The `DateRangeSelector` controls the range.
- If the date range exceeds 90 days, consider downsampling chart data points (weekly averages) for performance. Show a notice: "Showing weekly averages for ranges over 90 days."
- Sparkline rendering in KPI cards must be lightweight — use Recharts `<LineChart>` with `isAnimationActive={false}` and no axis components.
- Memoize computed insights with `useMemo` keyed on aggregates array reference.
- Lazy-render below-fold panels (Event Distribution, Machine Settings, Recent Sessions) using `IntersectionObserver` or a simple "load on scroll" pattern if initial render is slow.

---

## 7. File Structure

```
src/views/Dashboard/
├── Dashboard.tsx              ← Main view (updated)
├── Dashboard.module.css       ← Grid layout (updated)
├── EmptyState.tsx             ← Existing, unchanged
├── EmptyState.module.css
├── panels/
│   ├── KPIRow.tsx             ← 5 EnhancedKPICards
│   ├── KPIRow.module.css
│   ├── TherapyOverview.tsx    ← AHI trend + Usage bar
│   ├── TherapyOverview.module.css
│   ├── EventDistribution.tsx  ← Stacked area chart
│   ├── EventDistribution.module.css
│   ├── MachineSettingsPanel.tsx
│   ├── MachineSettingsPanel.module.css
│   ├── InsightsPanel.tsx
│   ├── InsightsPanel.module.css
│   ├── RecentSessions.tsx     ← Wrapper around SessionsTable
│   └── RecentSessions.module.css

src/components/domain/
├── EnhancedKPICard.tsx        ← New component
├── EnhancedKPICard.module.css
├── ChartTooltip.tsx           ← Shared chart tooltip
└── ChartTooltip.module.css

src/analysis/
├── generateInsights.ts        ← Pure function
└── generateInsights.test.ts
```

---

## 8. Design Token Usage Reference

| Element                   | Token                                                                        |
| ------------------------- | ---------------------------------------------------------------------------- |
| Panel background          | `var(--color-surface-elevated)`                                              |
| Panel border              | `var(--color-border-default)`, 1px solid                                     |
| Panel border radius       | `var(--radius-lg)`                                                           |
| Panel shadow              | `var(--shadow-sm)`                                                           |
| Panel padding             | `var(--space-lg)`                                                            |
| Section title font        | `var(--font-size-lg)`, `var(--font-weight-semibold)`                         |
| Metric value font         | `var(--font-size-2xl)`, `var(--font-weight-bold)`, `var(--font-family-mono)` |
| Metric unit font          | `var(--font-size-sm)`, `var(--color-text-secondary)`                         |
| Sparkline stroke          | Metric-specific (see KPI table above)                                        |
| Chart grid                | `var(--color-chart-grid)`                                                    |
| Chart axis labels         | `var(--font-size-xs)`, `var(--color-chart-axis)`                             |
| Tooltip background        | `var(--color-chart-tooltip-bg)`                                              |
| Trend arrow (favorable)   | `var(--color-status-normal)`                                                 |
| Trend arrow (unfavorable) | `var(--color-status-moderate)`                                               |
| Insight positive icon     | `var(--color-status-normal)`                                                 |
| Insight warning icon      | `var(--color-status-moderate)`                                               |
| Insight info icon         | `var(--color-info)`                                                          |
