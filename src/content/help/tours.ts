/**
 * Guided tour definitions — step-by-step instructional overlays.
 *
 * Each tour is an array of steps with a target CSS selector, title,
 * description, and preferred tooltip position.
 */

export interface TourStep {
  readonly targetSelector: string;
  readonly title: string;
  readonly description: string;
  readonly position: 'top' | 'right' | 'bottom' | 'left';
}

export interface GuidedTourDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly TourStep[];
}

export const guidedTours: readonly GuidedTourDefinition[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    description: 'Learn the basics of CPAP Analyzer — importing data and navigating the app.',
    steps: [
      {
        targetSelector: '[data-tour="sidebar-nav"]',
        title: 'Navigation',
        description:
          'The sidebar provides access to all major sections: Dashboard, Sessions, Analysis, Reports, Data Management, Settings, and Help. Click any icon to navigate.',
        position: 'right',
      },
      {
        targetSelector: '[data-tour="import-button"]',
        title: 'Import your data',
        description:
          "Start by importing data from your CPAP machine's SD card. Click here to open the import wizard. You'll select the SD card directory and CPAP Analyzer will parse all available session data.",
        position: 'bottom',
      },
      {
        targetSelector: '[data-tour="dashboard-link"]',
        title: 'Dashboard overview',
        description:
          'After importing, the Dashboard shows a high-level summary: AHI trend, usage hours, compliance rate, and leak statistics. KPI cards at the top provide at-a-glance status with clinical color coding.',
        position: 'right',
      },
      {
        targetSelector: '[data-tour="sessions-link"]',
        title: 'Explore sessions',
        description:
          'The Sessions view lists every therapy night. Click any session to see detailed statistics, signal waveforms, and event timelines. Compare multiple sessions side-by-side.',
        position: 'right',
      },
      {
        targetSelector: '[data-tour="help-link"]',
        title: 'Get help anytime',
        description:
          "Press the ? key at any time to open the help panel. You'll find a glossary of 50+ terms, detailed guides, and contextual tooltips throughout the app. Every metric label is hoverable for a quick explanation.",
        position: 'right',
      },
    ],
  },
  {
    id: 'dashboard-tour',
    title: 'Dashboard Tour',
    description: 'Understand every element of the Dashboard view.',
    steps: [
      {
        targetSelector: '[data-tour="date-range-selector"]',
        title: 'Date range selector',
        description:
          'Control the time window for all dashboard data. Choose a preset range (7 days, 30 days, 90 days, etc.) or pick custom dates. All KPI cards and charts update dynamically.',
        position: 'bottom',
      },
      {
        targetSelector: '[data-tour="kpi-cards"]',
        title: 'Key performance indicators',
        description:
          'These cards show your most important metrics: AHI, Usage Hours, Compliance Rate, and Leak Rate. Each displays the current value, change from previous period, and a color indicator (green = excellent, yellow = mild concern, orange = moderate, red = needs attention).',
        position: 'bottom',
      },
      {
        targetSelector: '[data-tour="trend-charts"]',
        title: 'Trend charts',
        description:
          'Interactive charts show metric trends over time. Individual nights appear as dots; the solid line is a rolling average; the dashed line shows the LOESS smoothed trend. Click and drag to zoom in.',
        position: 'top',
      },
      {
        targetSelector: '[data-tour="compliance-calendar"]',
        title: 'Compliance calendar',
        description:
          'This heatmap calendar shows your nightly compliance status. Green = met the 4-hour target. Red = below target. Gray = no data. The percentage shows your rolling 30-day compliance rate.',
        position: 'top',
      },
    ],
  },
  {
    id: 'first-analysis',
    title: 'Your First Analysis',
    description: 'Walk through performing your first detailed analysis.',
    steps: [
      {
        targetSelector: '[data-tour="analysis-link"]',
        title: 'Open Analysis hub',
        description:
          'The Analysis section provides four types of deep analysis: Statistical, Event, Pressure, and Integration. Each examines your data from a different angle.',
        position: 'right',
      },
      {
        targetSelector: '[data-tour="statistical-analysis"]',
        title: 'Statistical Analysis',
        description:
          'Statistical Analysis provides descriptive statistics (mean, median, percentiles), trend testing (is your AHI truly improving?), distribution analysis, and correlation matrices. Start here for a comprehensive data overview.',
        position: 'bottom',
      },
      {
        targetSelector: '[data-tour="event-analysis"]',
        title: 'Event Analysis',
        description:
          'Event Analysis breaks down your respiratory events by type, examines clustering patterns, and performs time-to-event analysis. This shows when and how frequently events occur during the night.',
        position: 'bottom',
      },
      {
        targetSelector: '[data-tour="pressure-analysis"]',
        title: 'Pressure Analysis',
        description:
          'Pressure Analysis examines the relationship between delivered pressure and therapy outcomes. For APAP users, see how the machine adjusts and whether your pressure range is optimal.',
        position: 'bottom',
      },
      {
        targetSelector: '[data-tour="analysis-results"]',
        title: 'Interpreting results',
        description:
          'Each analysis view includes interpretive context alongside the numbers. Hover over metric labels for quick explanations. Click "Learn more" links for detailed background. The help glossary is always accessible via the ? key.',
        position: 'top',
      },
    ],
  },
] as const;

/** Map of tour id → tour for O(1) lookup */
export const tourMap: ReadonlyMap<string, GuidedTourDefinition> = new Map(
  guidedTours.map((t) => [t.id, t]),
);
