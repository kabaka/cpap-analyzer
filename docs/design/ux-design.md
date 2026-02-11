# UX Design — CPAP Analyzer

**Version**: 1.0  
**Last Updated**: February 10, 2026  
**Audience**: Power users with data science backgrounds and dedicated laypersons

## Executive Summary

CPAP Analyzer is a comprehensive clinical data analysis platform designed for patients who want scientific rigor in their therapy analysis. This UX design balances two critical requirements: **information density** for users with quantitative backgrounds and **progressive disclosure** for learners. The interface serves as both a power tool and a teaching resource, with no data leaving the user's browser.

### Design Principles

1. **Data First, Chrome Last** — Every pixel serves the data; decoration is minimal
2. **Progressive Disclosure** — Simple overview to detailed analysis, without hiding capabilities
3. **Clinical Context Always** — Every metric links to explanation, every chart to interpretation
4. **Keyboard-Driven Power** — All functionality accessible without a mouse
5. **Privacy by Architecture** — UI reflects client-side-only constraint (no cloud sync, no share buttons)

---

## 1. Information Architecture

### 1.1 Site Structure

```
Application Root
│
├── Dashboard (Primary View)
│   ├── Date Range Selector (persistent component)
│   ├── Summary Cards (KPI Overview)
│   ├── Compliance Status
│   ├── Trend Charts (configurable)
│   └── Session List Table
│
├── Sessions (Detail Views)
│   ├── Session Detail
│   │   ├── Session Header (metadata)
│   │   ├── Signal Viewer (multi-channel waveforms)
│   │   ├── Event Timeline
│   │   ├── Session Statistics Table
│   │   └── User Annotations
│   │
│   └── Session Comparison
│       ├── Side-by-side metrics
│       ├── Waterfall change chart
│       └── Statistical significance testing
│
├── Analysis (Advanced Tools)
│   ├── Statistical Analysis
│   │   ├── Descriptive Statistics
│   │   ├── Time Series Analysis
│   │   │   ├── Rolling Averages
│   │   │   ├── STL Decomposition
│   │   │   ├── ACF/PACF
│   │   │   └── Change-Point Detection
│   │   ├── Correlation Analysis
│   │   │   ├── Correlation Matrix
│   │   │   ├── Cross-Correlation
│   │   │   └── Granger Causality
│   │   ├── Distribution Analysis
│   │   │   ├── Histograms
│   │   │   ├── QQ Plots
│   │   │   └── Violin Plots
│   │   └── Hypothesis Testing
│   │       ├── Mann-Whitney U
│   │       └── Effect Size Analysis
│   │
│   ├── Event Analysis
│   │   ├── Apnea Clustering
│   │   │   ├── FLG-Bridged Clusters
│   │   │   ├── K-Means++ Clusters
│   │   │   └── Single-Link Clusters
│   │   ├── False Negative Detection
│   │   ├── Event Duration Analysis
│   │   └── Kaplan-Meier Survival
│   │
│   ├── Pressure Optimization
│   │   ├── Titration Helper
│   │   ├── EPAP × AHI Scatter
│   │   └── Pressure Range Comparison
│   │
│   └── Integrations (Plugin)
│       ├── Fitbit Correlation
│       ├── Environmental Correlation
│       └── LLM Insights
│
├── Reports
│   ├── Report Generator
│   │   ├── Content Selection
│   │   ├── Date Range Selection
│   │   └── Output Format (PDF/CSV/JSON)
│   └── Report Templates
│       ├── Physician Summary
│       ├── Full Analysis Report
│       └── Custom Report Builder
│
├── Data Management
│   ├── Import
│   │   ├── SD Card Import
│   │   ├── Import Progress
│   │   └── Import History
│   ├── Export
│   │   ├── Session Export
│   │   ├── Data Export
│   │   └── Encryption Options
│   └── Storage
│       ├── Storage Usage
│       ├── Data Cleanup
│       └── Clear All Data
│
├── Settings
│   ├── Display
│   │   ├── Theme (Light/Dark/System)
│   │   ├── Chart Preferences
│   │   └── Date/Time Format
│   ├── Analysis
│   │   ├── Statistical Parameters
│   │   ├── Clustering Configuration
│   │   └── Clinical Thresholds
│   ├── Integrations
│   │   ├── Fitbit Setup
│   │   ├── Weather API
│   │   └── LLM Configuration
│   └── Privacy
│       ├── Data Retention
│       └── Export Security
│
└── Help & Documentation
    ├── Getting Started Guide
    ├── Metric Glossary
    ├── Clinical Reference
    ├── Statistical Methods
    ├── Keyboard Shortcuts
    ├── Privacy Policy
    └── About / Licenses
```

### 1.2 Navigation Hierarchy

**Primary Navigation** (Top-level tabs):

1. **Dashboard** — Default view, at-a-glance overview
2. **Sessions** — Browse and drill into individual nights
3. **Analysis** — Advanced statistical tools
4. **Reports** — Generate outputs for physicians or self
5. **Data** — Import/export management

**Secondary Navigation** (Context-dependent):

- Within Analysis: Category submenu (Statistical / Event / Pressure / Integrations)
- Within Sessions: List → Detail → Signal Viewer (progressive depth)
- Within Reports: Templates → Generator → Preview → Export

**Utility Navigation** (Top-right icons):

- `?` Help (context-sensitive)
- `⚙` Settings
- `🌓` Theme Toggle
- `📁` Quick Import (when no data loaded)

### 1.3 Persistent Components

**Date Range Selector**:

- Present in Dashboard, Sessions, Analysis, Reports
- State persists across navigation (user maintains temporal context)
- Presets: Last 7 days, Last 30 days, Last 90 days, Last year, All time, Custom

**Breadcrumb Navigation**:

- Not necessary for top-level tabs
- Essential for Analysis submenu depth (e.g., `Analysis > Time Series > STL Decomposition`)
- Session Detail (e.g., `Dashboard > January 15, 2026`)

**Status Bar** (Bottom):

- Session count for current date range
- Storage usage (clickable for detail)
- Background task indicators (import progress, analysis running)

---

## 2. Detailed User Flows

### 2.1 First-Time User Experience

**Flow: Initial Launch → First Data Import**

```
┌─────────────────────────────────────────────────────┐
│ Step 1: Welcome Screen                               │
│                                                       │
│  [Logo] CPAP Analyzer                                │
│                                                       │
│  "Comprehensive CPAP therapy analysis that runs      │
│   entirely in your browser."                         │
│                                                       │
│  🔒 Privacy First: All data processing happens       │
│     locally. Nothing leaves your device.             │
│                                                       │
│  [Import Your Data] ← Primary CTA                    │
│  [Learn More] [Skip Tour]                            │
└─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: Import Wizard                                │
│                                                       │
│  Select your CPAP machine's SD card                  │
│                                                       │
│  [Browse Folders] [Select Folder]                    │
│                                                       │
│  Detected: ResMed AirSense 10 AutoSet                │
│  Found: 89 sessions (Mar 2025 – Feb 2026)            │
│                                                       │
│  ⚠ This may take 30-60 seconds for a year of data   │
│                                                       │
│  [Import All Sessions] [Advanced Options]            │
└─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: Import Progress                              │
│                                                       │
│  Importing CPAP Data...                              │
│                                                       │
│  ████████████████░░░░░░░░░░  65% (58/89 sessions)   │
│                                                       │
│  Current: Jan 28, 2026                               │
│  Time Remaining: ~18 seconds                         │
│                                                       │
│  [Cancel Import]                                     │
└─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: Import Complete                              │
│                                                       │
│  ✓ Import Successful                                 │
│                                                       │
│  89 sessions imported (Mar 15, 2025 – Feb 9, 2026)  │
│  Storage used: 1.8 GB                                │
│                                                       │
│  Warnings:                                           │
│  • 2 corrupted files skipped (see details)           │
│                                                       │
│  [View Dashboard] [View Details]                     │
└─────────────────────────────────────────────────────┘
        │
        ▼ (Auto-navigate in 3 seconds)
┌─────────────────────────────────────────────────────┐
│ Step 5: Dashboard with Onboarding Tour (optional)    │
│                                                       │
│  [Tour overlay highlights key features]              │
│                                                       │
│  → Date Range Selector (change time period)          │
│  → Summary Cards (key metrics at a glance)           │
│  → Click any session for detail                      │
│  → Analysis tab for advanced tools                   │
│                                                       │
│  [Next] [Skip Tour]                                  │
└─────────────────────────────────────────────────────┘
```

**Design Decisions**:

- **No account creation** — Data is local, no authentication needed
- **Inline help, not separate wizard** — Contextual guidance reduces cognitive load
- **Progress transparency** — Show file count, time estimate, allow cancellation
- **Partial import success** — If 87/89 files succeed, consider it successful with warnings
- **Optional tour** — Skippable, replayable from Help menu

### 2.2 Returning User Experience

**Flow: App Launch → Resume Previous Context**

```
┌─────────────────────────────────────────────────────┐
│ App Launch                                           │
│                                                       │
│  [Loading application shell... <100ms]               │
│  [Loading cached data from IndexedDB... <500ms]      │
└─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────┐
│ Dashboard (Restored State)                           │
│                                                       │
│  Date Range: Jan 10 – Feb 9, 2026 ← Restored         │
│  Last viewed chart: AHI Trend ← Restored             │
│                                                       │
│  ⓘ New data available (3 sessions since last import) │
│     [Import Now] [Later]                             │
└─────────────────────────────────────────────────────┘
```

**State Restored**:

- Date range selection
- Active view and tab
- Chart zoom/pan state (if applicable)
- Sort/filter settings on tables
- Theme preference
- Sidebar open/closed state

**Intelligent Defaults**:

- If last visit was >7 days ago, suggest checking for new data
- If user had a specific analysis open, restore it but show dashboard first with option to "Return to [Analysis Name]"

### 2.3 Core Workflow: Dashboard Exploration

**Flow: Dashboard Overview → Session Detail → Signal Viewer**

```
┌─────────────────────────────────────────────────────┐
│ Dashboard (Last 30 Days)                             │
│                                                       │
│  ┌─── Date Range: Jan 10 – Feb 9 ─────────────────┐ │
│  │  ◄  [Presets ▼] [Custom Range]  ►              │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┏━━━━━━━━━━┓ ┏━━━━━━━━━━┓ ┏━━━━━━━━━━┓            │
│  ┃   AHI    ┃ ┃   Usage  ┃ ┃   Leak   ┃            │
│  ┃   4.2    ┃ ┃  6.3 hr  ┃ ┃  8 L/min ┃            │
│  ┃  ▼ 12%   ┃ ┃  ▲ 5%    ┃ ┃  ▼ 3%    ┃            │
│  ┃ [spark]  ┃ ┃ [spark]  ┃ ┃ [spark]  ┃            │
│  ┗━━━━━━━━━━┛ ┗━━━━━━━━━━┛ ┗━━━━━━━━━━┛            │
│                                     ↑ Click for help │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Session List (sortable table)                   │ │
│  │ Date       AHI  Usage  Leak  Notes              │ │
│  │ Feb 9      3.8   7.2h   6    ✓                  │ │
│  │ Feb 8      5.1   6.8h   9    —          ← Click │ │
│  │ Feb 7      4.2   7.5h   7    ✓                  │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
        │ User clicks Feb 8
        ▼
┌─────────────────────────────────────────────────────┐
│ Session Detail: February 8, 2026                     │
│                                                       │
│  ← Back to Dashboard                                 │
│                                                       │
│  ResMed AirSense 10 AutoSet                          │
│  Usage: 6.8 hours | AHI: 5.1 (Mild)                 │
│  EPAP: 9.2 cmH₂O | Leak: 9 L/min                    │
│                                                       │
│  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  │
│  ┃ Session Statistics (detailed table)             ┃  │
│  ┃  Obstructive AHI: 3.2                           ┃  │
│  ┃  Central AHI: 1.9                               ┃  │
│  ┃  Hypopnea AHI: 0                                ┃  │
│  ┃  95th %ile Leak: 18 L/min                      ┃  │
│  ┃  Mean Pressure: 11.4 cmH₂O                     ┃  │
│  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  │
│                                                       │
│  [View Signal Data] ← CTA to go deeper               │
│                                                       │
│  Event Timeline                                      │
│  ├─O────H─O───────C──────────O──────────►           │
│  22:00  23:00  00:00  01:00  02:00  03:00           │
│         ↑ Click event for detail                     │
└─────────────────────────────────────────────────────┘
        │ User clicks "View Signal Data"
        ▼
┌─────────────────────────────────────────────────────┐
│ Signal Viewer: February 8, 2026                      │
│                                                       │
│  ← Back to Session Detail                            │
│                                                       │
│  Flow Rate (L/min)                                   │
│  ▁▂▁▂▃▁▂▄▂▁▃▂▁▁▂▃▁▂▄▂▁▁▂▃▁ ← 25 Hz waveform         │
│                                                       │
│  Mask Pressure (cmH₂O)                               │
│  ▅▅▆▅▅▆▆▅▅▅▅▆▅▅▅▆▅▅▅▆▅▅▅▆▅                          │
│                                                       │
│  Events                                              │
│  ─────O───────────H─────────O────► ← Markers         │
│                                                       │
│  [Zoom: 8 hours] [Reset] [Channels ▼]               │
│  22:00         00:00         02:00         04:00     │
│  ◄────────────────────────────────────────────────► │
│          ↑ Drag to pan, wheel to zoom                │
└─────────────────────────────────────────────────────┘
```

**Interaction Details**:

1. **Summary Cards**: Hover for tooltip definition, click for glossary entry
2. **Sparklines**: Inline 30-day trend, not interactive (pure indicator)
3. **Session Table**: Sortable by any column, filterable, searchable by notes
4. **Session Detail**: Tabular metrics with inline help icons
5. **Signal Viewer**: Virtualized rendering (only visible viewport), smooth zoom/pan at 60fps

### 2.4 Advanced Analysis Workflow

**Flow: Dashboard → Analysis → Statistical Tool → Results Interpretation**

```
┌─────────────────────────────────────────────────────┐
│ User Question: "Has my AHI improved since my        │
│                 pressure was increased on Dec 1?"    │
└─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────┐
│ Analysis > Hypothesis Testing > Range Comparison     │
│                                                       │
│  Compare Metrics Between Date Ranges                 │
│                                                       │
│  Period A (Before): Nov 1 – Nov 30 (30 days)        │
│  Period B (After):  Dec 1 – Dec 31 (31 days)        │
│                                                       │
│  Metric: AHI ▼ [+ Add Metric]                       │
│                                                       │
│  Statistical Test: Mann-Whitney U (non-parametric)   │
│  Why this test? Your data is non-normal (see QQ)    │
│                                                       │
│  [Run Analysis]                                      │
└─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────┐
│ Results: AHI Comparison                              │
│                                                       │
│  Period A (Before): Mean = 6.8, Median = 6.2         │
│  Period B (After):  Mean = 4.3, Median = 4.1         │
│                                                       │
│  Mann-Whitney U = 287, p = 0.002 **                 │
│  Effect Size (rank-biserial): 0.62 (large)          │
│                                                       │
│  Interpretation:                                     │
│  ✓ Statistically significant improvement (p < 0.05) │
│  ✓ Large practical effect (Cohen's d equivalent)    │
│  ✓ Median AHI decreased by 2.1 events/hour          │
│                                                       │
│  [Waterfall Chart] [Export Results] [Save to Notes] │
│                                                       │
│  ⓘ What does this mean?                             │
│    Your AHI significantly decreased after the        │
│    pressure adjustment. This suggests the change     │
│    improved your therapy. Consider sharing this      │
│    with your sleep physician.                        │
└─────────────────────────────────────────────────────┘
```

**Progressive Disclosure Example**:

- **Level 1** (Default): Plain-language interpretation
- **Level 2** (Click "Show Details"): Statistical test name, p-value, effect size
- **Level 3** (Click "Methodology"): Full explanation of Mann-Whitney U, assumptions, when to use it

### 2.5 Report Generation Workflow

**Flow: Reports → Template Selection → Content Configuration → Export**

```
┌─────────────────────────────────────────────────────┐
│ Reports                                              │
│                                                       │
│  Generate a report for your physician or yourself    │
│                                                       │
│  Choose a template:                                  │
│  ○ Physician Summary (2 pages, high-level)          │
│  ● Full Analysis Report (10-20 pages, detailed)     │
│  ○ Custom Report (select sections manually)         │
│                                                       │
│  Date Range: Last 90 days ▼                         │
│                                                       │
│  [Next: Configure Content]                           │
└─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────┐
│ Report Content Selection                             │
│                                                       │
│  Full Analysis Report                                │
│                                                       │
│  ☑ Summary Statistics                               │
│  ☑ AHI Trend Chart                                  │
│  ☑ Usage Compliance Table                           │
│  ☑ Event Distribution Histogram                     │
│  ☑ Pressure Optimization Analysis                   │
│  ☐ Fitbit Correlation (not configured)              │
│  ☑ Change-Point Detection                           │
│                                                       │
│  [Preview Report] [Generate PDF]                     │
└─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────┐
│ Report Preview                                       │
│                                                       │
│  [Scrollable rendered PDF preview]                   │
│                                                       │
│  Page 1: Cover & Disclaimer                         │
│  Page 2: Summary Statistics                         │
│  Page 3-4: AHI Trend Analysis                       │
│  ...                                                 │
│                                                       │
│  [← Edit Content] [Download PDF] [Print]            │
│                                                       │
│  ⓘ PHI Warning: This report contains protected      │
│    health information. Store securely.              │
└─────────────────────────────────────────────────────┘
```

---

## 3. Interaction Patterns

### 3.1 Date Range Selection

**Component**: Persistent across all primary views

**Interaction Model**:

```
┌────────────────────────────────────────────┐
│ Date Range: ◄ Jan 10 – Feb 9, 2026 ►      │
│             [Presets ▼] [Custom Range]     │
└────────────────────────────────────────────┘
```

**Behaviors**:

- **Click left/right arrows**: Shift range backward/forward by current range duration
- **Click "Presets"**: Dropdown with Last 7/30/90 days, Last year, All time
- **Click "Custom Range"**: Calendar picker (dual date selection)
- **Keyboard**: `Ctrl/Cmd + Left/Right` to shift, `Ctrl/Cmd + R` to open range picker
- **URL sync**: Date range encoded in URL for bookmarking deep links

**Visual Feedback**:

- Active range highlighted
- All data views update simultaneously (debounced, 200ms)
- Loading indicators on each component during range change queries

### 3.2 Chart Interactions

**Standard Interactions for All Time-Series Charts**:

| Interaction       | Method                            | Behavior                                            |
| ----------------- | --------------------------------- | --------------------------------------------------- |
| **Zoom In**       | Mouse wheel up / Pinch out        | Zoom centered on cursor position                    |
| **Zoom Out**      | Mouse wheel down / Pinch in       | Zoom centered on cursor position                    |
| **Pan**           | Click-drag / Touch-drag           | Horizontal pan (time axis), constrain to data range |
| **Box Zoom**      | Shift + Click-drag                | Draw selection box, zoom to fit selection           |
| **Tooltip**       | Hover / Touch-hold                | Show exact values at data point, snap to nearest    |
| **Crosshair**     | Hover (while in multi-chart view) | Vertical line synced across all charts              |
| **Reset Zoom**    | Double-click / Two-finger tap     | Return to full date range view                      |
| **Legend Toggle** | Click legend item                 | Show/hide series, persist preference                |
| **Brush Select**  | Alt/Option + Click-drag           | Highlight time range for filtering                  |

**Interaction Feedback**:

- Cursor changes (grab hand for pan, crosshair for zoom box)
- Smooth animation on zoom (120ms ease-out)
- Immediate tooltip (no delay)
- Crosshair synced across all visible charts in view

**Accessibility Alternatives**:

- Tab to chart, Arrow keys to move crosshair datapoint-by-datapoint
- Enter to "activate" chart (zoom mode), Arrow keys to pan, +/- to zoom
- Each chart has an associated data table (Show/Hide toggle) for non-visual access

### 3.3 Table Interactions

**Session List Table** (Dashboard):

| Feature          | Interaction                                             |
| ---------------- | ------------------------------------------------------- |
| **Sort**         | Click column header (ascending → descending → unsorted) |
| **Filter**       | Type in column header filter box (instant search)       |
| **Select Row**   | Click row → Navigate to Session Detail                  |
| **Multi-Select** | Ctrl/Cmd + Click → Select multiple for bulk operations  |
| **Comparison**   | Select 2 sessions → "Compare" button appears            |
| **Notes**        | Double-click Notes column → Inline edit                 |

**Keyboard Shortcuts**:

- `↑/↓` Navigate rows
- `Enter` Open selected session
- `Space` Toggle row selection (multi-select mode)
- `Ctrl/Cmd + A` Select all (in current view)
- `/` Focus search filter

### 3.4 Signal Viewer Interactions

**Multi-Channel Time-Series Viewer** (most complex component):

**Zoom Levels**:

1. **Overview (8 hours)**: Downsampled to 1-second resolution, event markers only
2. **Intermediate (1 hour)**: 10-samples/second, flow patterns visible
3. **Detail (5 minutes)**: Full 25 Hz resolution, individual breaths visible
4. **Breath-level (<1 minute)**: Breath morphology analysis, measurement cursors

**Interaction Modes**:

- **Explore Mode** (default): Pan/zoom freely
- **Measure Mode**: Click two points to measure time/value delta
- **Annotate Mode**: Click to add note marker at timestamp
- **Comparison Mode**: Split view showing two time ranges side-by-side

**Channel Management**:

- Toggle channels on/off (maintain scale for consistency)
- Stack vertically (default) or overlay (for correlation visual inspection)
- Adjust individual channel scale (auto-scale or manual range)

**Event Overlay**:

- Event markers on timeline (color-coded by type)
- Click event → Detail popover (type, duration, pressure at time)
- Filter events by type (show only obstructive, only central, etc.)

### 3.5 Modal Dialogs

**Usage Pattern**: Settings, configuration, help articles

**Structure**:

```
┌──────────────────────────────────────────────┐
│ [✕]                                          │
│ Modal Title                                  │
│                                              │
│ [Content scrolls if too long]                │
│                                              │
│                    [Cancel] [Save/Confirm]   │
└──────────────────────────────────────────────┘
```

**Behaviors**:

- `Esc` to close (if no unsaved changes)
- Click outside modal → Close (if no unsaved changes, otherwise warn)
- Focus trap: Tab cycles within modal
- Return focus to trigger element on close

### 3.6 Contextual Help

**Inline Help Icons**: `ⓘ` next to every metric label

**Interaction**:

- **Hover**: Tooltip with one-line definition (appears after 300ms)
- **Click**: Open help drawer with detailed explanation
- **Keyboard**: Tab to focus, Enter to open detailed help

**Help Drawer** (slides in from right):

```
┌──────────────────────────────────────────────┐
│ ✕ AHI (Apnea-Hypopnea Index)                 │
├──────────────────────────────────────────────┤
│ [Tabs: Definition | Clinical | Statistical]  │
│                                              │
│ Definition:                                  │
│ The number of apnea and hypopnea events per │
│ hour of sleep. This is the primary metric   │
│ for diagnosing sleep apnea severity.        │
│                                              │
│ Normal Range: < 5 events/hour                │
│                                              │
│ Severity Bands:                              │
│ • Normal: < 5                                │
│ • Mild: 5-15                                 │
│ • Moderate: 15-30                            │
│ • Severe: > 30                               │
│                                              │
│ Clinical Significance:                       │
│ Higher AHI correlates with increased         │
│ cardiovascular risk...                       │
│                                              │
│ [Related Metrics] [See Statistical Methods]  │
└──────────────────────────────────────────────┘
```

---

## 4. Accessibility Strategy (WCAG AA)

### 4.1 Semantic HTML & ARIA

**Structure**:

- Proper heading hierarchy (`h1` for page title, `h2` for sections, etc.)
- Landmark regions: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`
- ARIA labels for custom controls (`role="tablist"`, `role="button"`, etc.)

**Dynamic Content**:

- Live regions for status updates: `aria-live="polite"` for import progress
- Modal dialogs: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
- Loading states: `aria-busy="true"` while content updates

### 4.2 Keyboard Navigation

**Global Shortcuts** (activate when no input focused):

| Shortcut       | Action                               |
| -------------- | ------------------------------------ |
| `D`            | Go to Dashboard                      |
| `S`            | Go to Sessions                       |
| `A`            | Go to Analysis                       |
| `R`            | Go to Reports                        |
| `I`            | Open Import Dialog                   |
| `?`            | Show Keyboard Shortcuts Reference    |
| `Ctrl/Cmd + K` | Command Palette (quick navigation)   |
| `/`            | Focus Search                         |
| `Esc`          | Close modal/drawer, cancel operation |

**Navigation & Focus**:

- **Tab Order**: Logical, left-to-right, top-to-bottom
- **Focus Indicators**: High-contrast focus ring (3px solid, 4.5:1 contrast)
- **Skip Links**: "Skip to main content" link (visible on focus)
- **Focus Management**: When opening modal, focus first interactive element; on close, return to trigger

### 4.3 Chart Accessibility

**Text Alternatives**:

- Each chart has an associated data table (toggle-able)
- `aria-describedby` links chart to table
- Screen reader announcement: "AHI trend line chart, 30 data points. View data table for details."

**Keyboard Chart Navigation**:

1. **Tab to chart** → Focus on chart container
2. **Enter** → Activate chart (keyboard navigation mode)
3. **Arrow keys** → Move crosshair datapoint by datapoint
4. **+/-** → Zoom in/out
5. **Shift + Arrow keys** → Pan
6. **Esc** → Exit keyboard navigation mode
7. **T** → Toggle to data table view

**Data Table Format**:

```
Date       | AHI  | Usage | Leak | Notes
-----------|------|-------|------|-------
Feb 9      | 3.8  | 7.2h  | 6    | —
Feb 8      | 5.1  | 6.8h  | 9    | High leak
```

### 4.4 Color & Contrast

**Minimum Contrast Ratios**:

- Body text: 4.5:1 (WCAG AA)
- Large text (≥18pt or ≥14pt bold): 3:1
- UI components (buttons, chart lines): 3:1
- Focus indicators: 3:1 against background

**Clinical Severity Colors** (tested for colorblindness):

| Severity | Light Theme    | Dark Theme     | Pattern (if color ambiguous) |
| -------- | -------------- | -------------- | ---------------------------- |
| Normal   | Green #22c55e  | Green #4ade80  | Solid line                   |
| Mild     | Yellow #eab308 | Yellow #facc15 | Dashed line (- - -)          |
| Moderate | Orange #f97316 | Orange #fb923c | Dotted line (· · ·)          |
| Severe   | Red #ef4444    | Red #f87171    | Bold solid line              |

**Never Color Alone**:

- Charts use both color and line style (solid, dashed, dotted)
- Status indicators use icons in addition to color (✓, ⚠, ✕)
- Trend arrows supplement color (▲ improving, ▼ worsening)

### 4.5 Motion & Animation

**Respect User Preferences**:

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Essential vs. Decorative**:

- **Decorative** (can be disabled): Chart zoom animations, sparkline transitions, hover effects
- **Essential** (always present): Focus indicators, loading spinners, error shake
- **User Control**: Settings → Display → "Enable animations" toggle

### 4.6 Screen Reader Testing Checklist

- [ ] All interactive elements (buttons, links, controls) have accessible names
- [ ] All images have alt text (or `alt=""` if decorative)
- [ ] All form inputs have associated labels
- [ ] Complex charts have text alternatives (data tables)
- [ ] Live regions announce meaningful state changes (import complete, analysis finished)
- [ ] Modal dialogs trap focus and announce their purpose
- [ ] Error messages are associated with their form fields via `aria-describedby`
- [ ] Expanding/collapsing sections use `aria-expanded`

---

## 5. Responsive Behavior

### 5.1 Breakpoint Strategy

| Breakpoint           | Width Range     | Layout Mode            | Target Device     |
| -------------------- | --------------- | ---------------------- | ----------------- |
| **Mobile**           | 320px – 639px   | Single column, stacked | Phone (portrait)  |
| **Mobile Landscape** | 640px – 767px   | Adaptable 2-column     | Phone (landscape) |
| **Tablet**           | 768px – 1023px  | Flexible 2-3 column    | Tablet            |
| **Desktop**          | 1024px – 1439px | Multi-panel            | Laptop            |
| **Large Desktop**    | 1440px+         | Wide multi-panel       | Desktop monitor   |

### 5.2 Mobile Layout (< 640px)

**Use Case**: "Show my doctor my data during an appointment"

**Dashboard**:

```
┌──────────────────────────┐
│ [☰] CPAP Analyzer  [?][⚙]│
├──────────────────────────┤
│ Date Range (full width)  │
├──────────────────────────┤
│ ┏━━━━━━━━━━━━━━━━━━━━┓  │
│ ┃ AHI: 4.2 ▼12%      ┃  │
│ ┃ [sparkline]        ┃  │
│ ┗━━━━━━━━━━━━━━━━━━━━┛  │
│ ┏━━━━━━━━━━━━━━━━━━━━┓  │
│ ┃ Usage: 6.3h ▲5%    ┃  │
│ ┃ [sparkline]        ┃  │
│ ┗━━━━━━━━━━━━━━━━━━━━┛  │
│ ┏━━━━━━━━━━━━━━━━━━━━┓  │
│ ┃ Leak: 8 L/min ▼3%  ┃  │
│ ┃ [sparkline]        ┃  │
│ ┗━━━━━━━━━━━━━━━━━━━━┛  │
├──────────────────────────┤
│ [Trend Chart - full]     │
│ (horizontal scroll OK)   │
├──────────────────────────┤
│ Session List             │
│ (sticky Date column)     │
│ (horizontal scroll)      │
└──────────────────────────┘
```

**Navigation**: Hamburger menu (☰) expands to overlay navigation

**Charts**:

- Full viewport width
- Touch-enabled (pinch-to-zoom, swipe-to-pan)
- Simplified tooltips (tap, not hover)

**Tables**:

- Horizontal scroll
- First column (Date) sticky
- Simplified view (3-4 columns max visible)

**Signal Viewer**:

- Full-screen mode automatic
- One channel at a time (toggle between channels)
- Gesture-driven zoom/pan

### 5.3 Tablet Layout (768px – 1023px)

**Use Case**: "Review data before bed" or "Bedside analysis"

**Dashboard**:

```
┌────────────────────────────────────────────┐
│ [Logo] CPAP Analyzer     [?] [⚙] [Theme]  │
│ Dashboard | Sessions | Analysis | Reports  │
├────────────────────────────────────────────┤
│ Date Range Selector (centered)             │
├────────────────────────────────────────────┤
│ ┏━━━━━━┓ ┏━━━━━━┓ ┏━━━━━━┓ ┏━━━━━━┓      │
│ ┃ AHI  ┃ ┃Usage ┃ ┃ Leak ┃ ┃EPAP  ┃      │
│ ┗━━━━━━┛ ┗━━━━━━┛ ┗━━━━━━┛ ┗━━━━━━┛      │
│                                            │
│ [Trend Chart - full width, 2 charts max]  │
│                                            │
│ Session List (full width, all columns)    │
└────────────────────────────────────────────┘
```

**Layout Changes**:

- Tab navigation visible (not hamburger)
- Summary cards 2×2 grid
- Charts: 1-2 side-by-side (configurable)
- Tables: All columns visible, no horizontal scroll

### 5.4 Desktop Layout (1024px+)

**Use Case**: "Primary analysis workstation"

**Dashboard**:

```
┌─────────────────────────────────────────────────────────────┐
│ [Logo] CPAP Analyzer              [?] [⚙] [Theme]           │
│ Dashboard | Sessions | Analysis | Reports | Data            │
├─────────────────────────────────────────────────────────────┤
│ Date Range Selector (left-aligned)    [Quick Actions: ▼]   │
├────────────────────────────────────┬────────────────────────┤
│ ┏━━━━━┓ ┏━━━━━┓ ┏━━━━━┓ ┏━━━━━┓ │ Compliance Status      │
│ ┃ AHI ┃ ┃Usage┃ ┃Leak ┃ ┃EPAP ┃ │ ✓ 28/30 nights ≥4h     │
│ ┗━━━━━┛ ┗━━━━━┛ ┗━━━━━┛ ┗━━━━━┛ │ Streak: 12 nights      │
│                                    │                        │
│ [Trend Chart 1] [Trend Chart 2]   │ Recent Notes           │
│                                    │ • Feb 8: High leak     │
│ Session List (with all columns)   │ • Feb 3: New mask      │
└────────────────────────────────────┴────────────────────────┘
```

**Layout Changes**:

- Sidebar for secondary information (compliance, notes, quick stats)
- Multi-chart dashboard (2-4 charts configurable)
- Drag-and-drop to rearrange widgets
- Keyboard shortcuts discoverable in UI

### 5.5 Touch Optimization

**Touch Targets**: Minimum 44×44px (WCAG 2.1 Level AAA guideline)

**Gestures**:

- **Tap**: Select, activate
- **Long press**: Context menu, tooltip
- **Swipe**: Navigate between views (if applicable)
- **Pinch**: Zoom in/out (charts)
- **Two-finger drag**: Pan (charts)

**Mobile Considerations**:

- Bottom navigation bar (thumbs-friendly)
- Larger font sizes (minimum 16px body)
- Generous padding (easier tapping)
- Avoid hover-dependent UI

---

## 6. Progressive Disclosure Strategy

### 6.1 Layered Information Model

**Three Disclosure Levels**:

1. **Summary (Default)** — What most users need most of the time
2. **Detail (On Demand)** — Additional context for deeper understanding
3. **Expert (Optional)** — Full technical detail for power users

**Example: AHI Display**

| Level       | Display                                                     | Audience               |
| ----------- | ----------------------------------------------------------- | ---------------------- |
| **Summary** | `AHI: 4.2` (with color indicator)                           | Everyone               |
| **Detail**  | `AHI: 4.2 (Mild) — Total: 29 events, 6.8 hours`             | Click "Details"        |
| **Expert**  | `Obstructive: 3.2, Central: 1.0, Hypopnea: 0` + event table | Click "Show Breakdown" |

### 6.2 Dashboard Progressive Complexity

**First Glance** (no scrolling):

- Date range
- 3-4 KPI cards with sparklines
- Compliance status

**Scroll Down** (immediate):

- Primary trend chart
- Session list (top 10 nights)

**Dig Deeper** (user-initiated):

- Click KPI card → Full analysis for that metric
- Click trend chart → Expanded chart with more detail
- Click session → Session detail view

### 6.3 Analysis Tools Progressive Exposure

**Analysis Menu** (tiered):

```
Analysis
├── Quick Analysis (always visible)
│   ├── Summary Statistics ← Most common
│   ├── Trend Analysis
│   └── Range Comparison
│
├── Statistical Tools (expandable)
│   ├── Correlation Analysis
│   ├── Change-Point Detection
│   └── Hypothesis Testing
│       └── Advanced Options (hidden until test selected)
│
└── Expert Tools (separate submenu)
    ├── Clustering Algorithms
    ├── Survival Analysis
    └── Custom Analysis Builder
```

**Within Each Tool**:

- **Simple Interface First**: Minimal required inputs, smart defaults
- **Advanced Options Collapsed**: "Show Advanced Options" expander
- **Methodology Link**: "How does this work?" → Help article

**Example: Change-Point Detection**

```
┌──────────────────────────────────────────┐
│ Change-Point Detection                   │
│                                          │
│ Metric: AHI ▼                           │
│ Date Range: [Use current range]         │
│                                          │
│ [Run Analysis] ← Simple, one click      │
│                                          │
│ ⌄ Advanced Options (click to expand)    │
└──────────────────────────────────────────┘

[User clicks "Advanced Options"]

┌──────────────────────────────────────────┐
│ Change-Point Detection                   │
│                                          │
│ Metric: AHI ▼                           │
│ Date Range: [Use current range]         │
│                                          │
│ Algorithm: PELT ▼                       │
│   ⓘ Pruned Exact Linear Time            │
│                                          │
│ Penalty: 10 (default) ⓘ                │
│   Lower = more sensitive (more breaks)  │
│   Higher = less sensitive (fewer breaks)│
│                                          │
│ Cost Function: Least Squares ▼          │
│                                          │
│ [Run Analysis] [Reset to Defaults]      │
│                                          │
│ ⌄ Hide Advanced Options                 │
└──────────────────────────────────────────┘
```

### 6.4 Help System Layering

**Tooltip** (Level 1):

- Hover: "AHI is the number of apnea/hypopnea events per hour"
- Appears after 300ms
- One sentence maximum

**Help Drawer** (Level 2):

- Click metric label: Slide-in panel with 2-3 paragraphs
- Tabs: Definition, Clinical Significance, How It's Calculated
- Links to related metrics

**Full Article** (Level 3):

- Click "Learn More" in help drawer
- Dedicated page with comprehensive explanation
- Includes formulas, examples, clinical studies, references

---

## 7. Help System Integration

### 7.1 Contextual Help Architecture

**Principle**: Help is never more than one click away from any context.

**Entry Points**:

1. **Inline help icons** — `ⓘ` next to every metric, control, or complex feature
2. **Global help button** — `?` in top-right, opens context-sensitive help
3. **Command palette** — `Ctrl/Cmd + K`, type "help [topic]"
4. **Empty states** — Guide users when no data or no results
5. **Error messages** — Include actionable help links

### 7.2 Help Content Structure

**Metric Help Template**:

```markdown
# [Metric Name]

## Quick Definition

[One-sentence plain-language explanation]

## Clinical Context

- What it measures
- Normal ranges
- Clinical significance
- When to be concerned

## How It's Calculated

[Formula or algorithm description]
[For power users — include statistical methodology]

## Related Metrics

[Links to related help articles]

## Further Reading

[Links to clinical studies, AASM guidelines]
```

**Analysis Method Help Template**:

```markdown
# [Analysis Method Name]

## What This Analysis Does

[Plain-language summary]

## When to Use It

[Appropriate scenarios]

## Understanding the Results

[How to interpret output]
[What p-values mean, effect sizes, etc.]

## Methodology

[Statistical method explanation]
[Assumptions and limitations]

## Example Use Cases

[Real-world scenarios with screenshots]
```

### 7.3 Onboarding Tour

**First Launch Only** (skippable, replayable from Help menu):

**Tour Structure** (5 steps, <60 seconds):

1. **Welcome & Privacy**
   - "Welcome to CPAP Analyzer"
   - "All data processing happens entirely in your browser"
   - "Nothing leaves your device — ever"

2. **Import Your Data**
   - [Highlight Import button]
   - "Select your CPAP machine's SD card to begin"
   - "This takes 30-60 seconds for a year of data"

3. **Dashboard Overview**
   - [Highlight KPI cards]
   - "Your key metrics at a glance"
   - "Click any card for more detail"

4. **Drill Down**
   - [Highlight session table]
   - "Click any night to see detailed analysis"
   - "View full-resolution waveforms and event timelines"

5. **Get Help Anytime**
   - [Highlight help icon]
   - "Click the ? icon or any ⓘ symbol for explanations"
   - "Full documentation available in the Help menu"

**Implementation**:

- Non-modal (user can click around, tour stays visible)
- "Next" / "Skip Tour" buttons
- Progress indicator (Step 2 of 5)
- Preference stored: "Don't show again"

### 7.4 In-App Documentation

**Help Menu** (accessible from `?` button):

```
Help & Documentation
├── Getting Started
│   ├── Importing Your Data
│   ├── Understanding the Dashboard
│   └── Your First Analysis
│
├── Metrics Glossary
│   ├── AHI & Event Metrics
│   ├── Pressure Metrics
│   ├── Usage & Compliance
│   └── Leak Metrics
│
├── Analysis Methods
│   ├── Statistical Methods
│   ├── Time Series Analysis
│   ├── Clustering Algorithms
│   └── Hypothesis Testing
│
├── Clinical Reference
│   ├── Sleep Apnea Overview
│   ├── CPAP Therapy Basics
│   ├── Interpreting Your Data
│   └── When to Contact Your Doctor
│
├── Keyboard Shortcuts
├── Privacy & Security
└── About / Licenses
```

**Search Functionality**:

- Full-text search across all help content
- Keyboard shortcut: `?` then type query
- Results show snippet + context
- Jump directly to relevant section

### 7.5 Error Guidance

**Error Message Template**:

```
┌──────────────────────────────────────────┐
│ ⚠ Import Failed                          │
│                                          │
│ We couldn't read some files from your   │
│ SD card.                                 │
│                                          │
│ What happened:                           │
│ • 2 files were corrupted or incomplete  │
│ • 87 of 89 sessions imported successfully│
│                                          │
│ What you can do:                         │
│ • Continue with partial data            │
│ • Try re-inserting the SD card          │
│ • [View Technical Details]              │
│ • [Get Help]                            │
│                                          │
│ [Continue with 87 Sessions] [Retry]     │
└──────────────────────────────────────────┘
```

**Error Categories**:

1. **User Action Needed** — Clear remedy (example: re-insert SD card)
2. **Partial Success** — Allow continuation with reduced data
3. **Fatal Error** — Explain limitation, suggest workaround
4. **Technical Error** — "Something went wrong", log to console, offer bug report

---

## 8. State Management & Persistence

### 8.1 UI State Categories

| State Category       | Persistence | Storage      | Example                                       |
| -------------------- | ----------- | ------------ | --------------------------------------------- |
| **Session State**    | No          | Memory       | Current scroll position, dropdown open/closed |
| **User Preferences** | Yes         | LocalStorage | Theme, date format, chart preferences         |
| **View State**       | Yes         | LocalStorage | Last date range, active tab, sort order       |
| **Application Data** | Yes         | IndexedDB    | Imported CPAP sessions, user annotations      |

### 8.2 Persisted Preferences

**Settings > Display**:

```javascript
{
  theme: "dark" | "light" | "system",
  chartAnimations: true | false,
  dateFormat: "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD",
  timeFormat: "12h" | "24h",
  language: "en-US",
  compactView: false | true
}
```

**Settings > Analysis**:

```javascript
{
  defaultChangePointPenalty: 10,
  defaultClusterAlgorithm: "flg-bridged",
  defaultStatisticalTest: "mann-whitney",
  showAdvancedOptions: false | true,
  significanceLevel: 0.05
}
```

**Settings > Chart**:

```javascript
{
  defaultCharts: ["ahi-trend", "usage-trend"],
  tooltipDelay: 300, // milliseconds
  smoothZoom: true,
  crosshairSync: true,
  showDataTables: false // accessibility preference
}
```

### 8.3 View State Persistence

**Dashboard State**:

```javascript
{
  dateRange: {
    start: "2026-01-10",
    end: "2026-02-09",
    preset: "last-30-days"
  },
  selectedCharts: ["ahi-trend", "usage-trend"],
  sessionTableSort: {
    column: "date",
    direction: "desc"
  },
  sessionTableFilters: {
    minAHI: null,
    maxAHI: null,
    searchText: ""
  }
}
```

**Session Detail State**:

```javascript
{
  lastViewedSession: "2026-02-08",
  signalViewerZoom: {
    start: "2026-02-08T22:15:00Z",
    end: "2026-02-08T23:45:00Z"
  },
  visibleChannels: ["flow", "pressure", "events"]
}
```

**Analysis State**:

```javascript
{
  activeAnalysis: "change-point-detection",
  analysisParams: {
    metric: "AHI",
    penalty: 10
  },
  cachedResults: {
    // Recently run analyses cached to avoid re-computation
  }
}
```

### 8.4 Data Storage Architecture

**IndexedDB Structure**:

```
Database: cpap-analyzer-v1
│
├── Object Store: sessions
│   Key: sessionId (UUID)
│   Indexes: date, machineId, AHI
│   Data: {sessionId, date, machineModel, summaryMetrics, ...}
│
├── Object Store: signals
│   Key: [sessionId, channelName]
│   Data: {sessionId, channel, sampleRate, samples: ArrayBuffer}
│
├── Object Store: events
│   Key: [sessionId, eventType, timestamp]
│   Data: {sessionId, eventType, timestamp, duration, ...}
│
├── Object Store: annotations
│   Key: annotationId
│   Indexes: sessionId, timestamp
│   Data: {sessionId, timestamp, noteText, createdAt}
│
└── Object Store: analysis-cache
    Key: [analysisType, params-hash]
    Data: {analysisType, params, results, computedAt}
```

**Storage Quota Management**:

```javascript
{
  totalSessions: 350,
  estimatedSize: "2.4 GB",
  quotaUsed: "64%",
  quotaRemaining: "1.4 GB"
}
```

**Actions Available**:

- View session-by-session storage usage
- Delete individual sessions
- Delete date range (bulk)
- Export data before delete
- Clear all data (with confirmation + re-confirmation)

### 8.5 State Restoration on Launch

**Launch Sequence**:

1. Load UI shell (< 100ms)
2. Check IndexedDB for existing data (< 200ms)
3. Restore last view state from LocalStorage (< 50ms)
4. Render Dashboard with cached summary data (< 500ms)
5. Check for new data on SD card (if path known, optional background task)

**If State Exists**:

- Navigate directly to last view (or Dashboard if last view unavailable)
- Restore date range, chart zoom, table filters
- User continues where they left off

**If No State** (fresh start):

- Show welcome screen
- Prompt for data import
- Initialize with default preferences

### 8.6 URL State Synchronization

**Bookmarkable URLs**:

- Date ranges: `/#/dashboard?start=2026-01-10&end=2026-02-09`
- Session detail: `/#/sessions/2026-02-08`
- Analysis with params: `/#/analysis/change-point?metric=AHI&penalty=10`

**Benefits**:

- Deep linking to specific views
- Share link with physician (data still local, only view configuration shared)
- Browser back/forward works as expected

---

## 9. UX Design Principles Summary

### 9.1 Design Values Hierarchy

When design decisions conflict, prioritize in this order:

1. **Privacy** — Never compromise client-side-only architecture
2. **Data Integrity** — Always preserve complete data, never silently discard
3. **Accessibility** — Feature must work for all users
4. **Performance** — Must handle years of data responsively
5. **Learnability** — Power features must be discoverable
6. **Visual Polish** — Last, but not neglected

### 9.2 User Experience Goals

| User Type             | Primary Goal               | Design Focus                                    | Success Metric                 |
| --------------------- | -------------------------- | ----------------------------------------------- | ------------------------------ |
| **Power User**        | Deep, rigorous analysis    | Information density, keyboard shortcuts, export | Time to complete analysis task |
| **Learner**           | Understand therapy metrics | Contextual help, progressive disclosure         | Comprehension (self-reported)  |
| **Patient-Physician** | Share findings with doctor | Clear summaries, professional reports           | Report quality rating          |

### 9.3 Interaction Design Tenets

1. **Immediate Feedback** — Every interaction acknowledged within 100ms
2. **Reversible Actions** — Undo/cancel for destructive operations
3. **Predictable Behavior** — Consistent patterns across all views
4. **Visible State** — User always knows where they are, what's happening
5. **Forgiving Input** — Validate, suggest corrections, don't block unnecessarily

### 9.4 Future Extensibility

**Plugin Support** (planned):

- Settings UI for enabling/disabling plugins
- Plugin-contributed navigation items
- Plugin-contributed chart types
- Plugin-contributed analysis methods

**Design Considerations**:

- Navigation structure must accommodate variable number of tabs
- Settings must scale to arbitrary number of plugin configs
- Help system must merge plugin documentation seamlessly

---

## 10. Implementation Priorities

### Phase 1: Core Patient Experience (MVP)

- ✅ Data import pipeline
- ✅ Dashboard with summary cards
- ✅ Session detail view
- ✅ Basic accessibility (keyboard nav, WCAG A)
- ✅ Responsive mobile layout
- ✅ Light/dark theme

### Phase 2: Analysis Tools

- Time-series analysis (rolling averages, STL)
- Correlation analysis
- Range comparison (Mann-Whitney U)
- Report generation (PDF export)
- Advanced accessibility (WCAG AA, screen reader testing)

### Phase 3: Signal Viewer & Advanced

- High-resolution signal viewer
- Event clustering algorithms
- False-negative detection
- Breath-level detail view

### Phase 4: Integrations (Plugins)

- Fitbit correlation
- Environmental correlation (weather, AQI)
- LLM insights (optional)

### Phase 5: Polish & Optimization

- Performance optimization for 5+ years of data
- Advanced keyboard shortcuts
- Customizable dashboard
- Multi-machine support

---

## Conclusion

This UX design creates a professional analytical platform that respects both the user's expertise and their learning journey. By combining information density with progressive disclosure, clinical rigor with accessible explanations, and powerful analysis with intuitive navigation, CPAP Analyzer serves as both a research-grade tool and a patient education resource — all while maintaining absolute privacy through client-side-only operation.

The design is structured to scale from a patient's first night of data to decades of therapy history, from simple nightly summaries to publication-quality statistical analysis, and from mobile phone consultations with physicians to desktop deep-dive investigations.

Every interaction pattern, every accessibility consideration, and every help system touchpoint is designed to answer a single question: **How can we give patients the same analytical power as sleep scientists, without requiring a PhD?**
