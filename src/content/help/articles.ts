/**
 * Help articles — structured content for the in-app help system.
 *
 * Each article has a slug (URL parameter), title, summary, icon category,
 * and content organized into sections with headings and paragraphs.
 */

export interface ArticleSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export interface HelpArticle {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly icon: ArticleIcon;
  readonly featured?: boolean;
  readonly sections: readonly ArticleSection[];
}

export type ArticleIcon =
  | 'getting-started'
  | 'import'
  | 'dashboard'
  | 'sessions'
  | 'statistics'
  | 'events'
  | 'pressure'
  | 'reports'
  | 'settings'
  | 'clinical';

export const helpArticles: readonly HelpArticle[] = [
  // ─── GETTING STARTED ──────────────────────────────────────────────
  {
    slug: 'getting-started',
    title: 'Getting Started',
    summary: 'What CPAP Analyzer does, how your data stays private, and how to begin.',
    icon: 'getting-started',
    featured: true,
    sections: [
      {
        heading: 'What is CPAP Analyzer?',
        paragraphs: [
          "CPAP Analyzer is a client-side web application that helps you understand your CPAP therapy data at a scientific level. It reads the data files from your CPAP machine's SD card and provides detailed statistical analysis, interactive visualizations, event analysis, and clinical context — all within your browser.",
          'Unlike cloud-based apps like ResMed myAir, CPAP Analyzer never sends your data to any server. Everything runs locally on your device. There is no account to create, no data to upload, and no telemetry. Your health data stays yours.',
        ],
      },
      {
        heading: 'Who is it for?',
        paragraphs: [
          'CPAP Analyzer is designed for patients who want to go beyond the surface-level summaries provided by manufacturer apps. Whether you have a background in data science, mathematics, engineering, or are simply a motivated learner, this tool gives you the depth to truly understand your therapy.',
          'The help system includes layered explanations: quick summaries for those who just need the gist, and detailed breakdowns with formulas and clinical references for those who want to verify every calculation.',
        ],
      },
      {
        heading: 'Quick start',
        paragraphs: [
          '1. Remove the SD card from your CPAP machine (consult your machine manual for the SD card location).',
          '2. Insert the SD card into your computer using an SD card reader.',
          '3. Click "Import Data" from the sidebar or dashboard, and select the SD card directory.',
          '4. CPAP Analyzer will parse your data files and display a summary of the imported sessions.',
          '5. Explore the Dashboard for an overview, or dive into Sessions for night-by-night detail.',
        ],
      },
      {
        heading: 'Privacy guarantee',
        paragraphs: [
          "CPAP Analyzer is architecturally incapable of transmitting your data. It runs entirely in your browser using client-side JavaScript. There are no server endpoints, no analytics services, no tracking pixels, and no external API calls. Your data is stored in your browser's local storage (IndexedDB and OPFS) and never leaves your device.",
          'You can verify this yourself: the application works fully offline after the initial page load. Open developer tools and monitor the Network tab — you will see zero data transmissions.',
        ],
      },
    ],
  },

  // ─── IMPORTING DATA ───────────────────────────────────────────────
  {
    slug: 'importing-data',
    title: 'Importing Data',
    summary: 'How to get your CPAP data from the SD card into the analyzer.',
    icon: 'import',
    sections: [
      {
        heading: 'Overview',
        paragraphs: [
          "CPAP Analyzer reads data directly from your CPAP machine's SD card. ResMed devices store therapy data in a structured directory format with EDF (European Data Format) files containing detailed signal recordings and summary statistics.",
        ],
      },
      {
        heading: 'Preparing your SD card',
        paragraphs: [
          'Turn off your CPAP machine before removing the SD card. The SD card slot is typically located on the side or back of the device. For ResMed AirSense 10 and 11, gently press the card to release it.',
          "Insert the card into your computer's SD card reader. The card should appear as a removable drive. Do not modify or delete any files on the card.",
        ],
      },
      {
        heading: 'Importing with File Picker',
        paragraphs: [
          'Click "Import Data" and use the file picker dialog to select the root directory of your SD card (the folder containing the DATALOG, SETTINGS, and other directories). CPAP Analyzer will scan the directory structure and identify all available session data.',
          'The import process reads the following files: Identification.tgt (machine identification), STR.edf (session summary records), and individual EDF files in DATALOG subdirectories (detailed signal data). Settings files in the SETTINGS directory provide machine configuration context.',
        ],
      },
      {
        heading: 'What gets imported',
        paragraphs: [
          'Session summaries: date, duration, AHI, leak statistics, pressure statistics for each night.',
          'Detailed signals: high-resolution flow, pressure, and leak waveforms sampled at 25 Hz (25 readings per second). These enable breath-by-breath analysis and event visualization.',
          'Machine settings: therapy mode (CPAP/APAP/BiPAP), pressure settings, EPR configuration, ramp settings, and mask type.',
        ],
      },
      {
        heading: 'Import duration',
        paragraphs: [
          'Import time depends on how many nights of data are on the SD card. Typical import times: 30 days takes 5–15 seconds; 6 months takes 30–60 seconds; 1+ year may take 1–3 minutes. Detailed signal data (EDF files) is the largest component. You can monitor progress in the import wizard.',
        ],
      },
      {
        heading: 'Re-importing and updates',
        paragraphs: [
          'You can re-import at any time to add new nights. CPAP Analyzer will detect which sessions already exist and only import new data. Existing data is not duplicated.',
        ],
      },
    ],
  },

  // ─── DASHBOARD GUIDE ──────────────────────────────────────────────
  {
    slug: 'dashboard',
    title: 'Dashboard Guide',
    summary:
      'Understanding KPI cards, trend charts, compliance tracking, and the date range selector.',
    icon: 'dashboard',
    sections: [
      {
        heading: 'Overview',
        paragraphs: [
          'The Dashboard provides a high-level summary of your CPAP therapy. It shows key performance indicators (KPIs), trend charts, and compliance status at a glance. Use the date range selector to focus on specific periods.',
        ],
      },
      {
        heading: 'KPI cards',
        paragraphs: [
          'The top of the dashboard displays cards for your most important metrics: AHI ($\\text{AHI} = \\frac{\\text{apneas} + \\text{hypopneas}}{\\text{hours}}$), Usage Hours (average per night), Compliance Rate ($\\frac{\\text{nights} \\geq 4\\text{h}}{N} \\times 100\\%$), and Leak Rate (median). Each card shows the current period value, a comparison to the previous period, and a clinical status indicator (green/yellow/orange/red).',
          'Hover over any metric label to see its definition and interpretation guide. Click "View Details" on a card to navigate to the relevant analysis view.',
        ],
      },
      {
        heading: 'Trend charts',
        paragraphs: [
          'Below the KPI cards, interactive trend charts show how your key metrics change over time. The charts include nightly values (dots), a 7-day rolling average (solid line), and a LOESS trend line (dashed) for identifying non-linear patterns.',
          'Click and drag on a chart to zoom into a specific time range. Use the toolbar to toggle between different metrics, change the rolling average window, or export the chart.',
        ],
      },
      {
        heading: 'Compliance tracking',
        paragraphs: [
          'The compliance card tracks your adherence against the standard threshold: ≥ 4 hours per night for ≥ 70% of nights in a rolling 30-day window. A calendar heatmap shows which nights met the target (green) and which did not (red). The compliance trend helps predict future compliance risk.',
        ],
      },
      {
        heading: 'Date range selector',
        paragraphs: [
          'Use the date range selector to filter all dashboard data. Preset ranges include: Last 7 days, Last 30 days, Last 90 days, Last 6 months, Last year, and All time. You can also set a custom range by clicking the start and end dates. All KPI cards and charts update dynamically when the range changes.',
        ],
      },
    ],
  },

  // ─── SESSIONS GUIDE ───────────────────────────────────────────────
  {
    slug: 'sessions',
    title: 'Sessions Guide',
    summary:
      'How to browse sessions, view session details, explore signal data, and compare nights.',
    icon: 'sessions',
    sections: [
      {
        heading: 'Session list',
        paragraphs: [
          'The Sessions view shows all imported therapy sessions in a sortable, filterable table. Each row displays the date, usage hours, AHI, leak rate, and pressure summary. Click any column header to sort. Use the search bar to filter by date range or metric thresholds.',
          'Color indicators on each row reflect clinical status: green (excellent control), yellow (mild concerns), orange (moderate concerns), red (significant concerns). These thresholds follow AASM severity classifications.',
        ],
      },
      {
        heading: 'Session detail',
        paragraphs: [
          'Click any session to open its detail view. The detail view shows comprehensive statistics for that single night: event breakdown (obstructive, central, mixed, hypopnea), pressure profile, leak statistics, and usage timeline.',
          'The event timeline visualizes when events occurred during the night. Clustering of events may indicate positional effects (supine vs. lateral), REM-related worsening, or pressure inadequacy during specific sleep stages.',
        ],
      },
      {
        heading: 'Signal viewer',
        paragraphs: [
          'The signal viewer displays high-resolution waveform data recorded by your CPAP machine. Available channels include flow (breathing pattern), mask pressure, and leak rate. The viewer uses LTTB downsampling for smooth rendering of hundreds of thousands of data points.',
          'Click and drag to zoom into any time region. At full zoom, individual breaths are visible — you can identify apneas (flat-line flow), hypopneas (reduced amplitude), and flow limitation (flattened inspiratory shape). The signal viewer marks scored events with colored overlays.',
        ],
      },
      {
        heading: 'Session comparison',
        paragraphs: [
          'Select two or more sessions to compare side-by-side. The comparison view aligns metrics in a table for easy comparison and overlays trend data. This is useful for evaluating the effect of therapy changes (new mask, pressure adjustment, medication change) by comparing nights before and after the change.',
        ],
      },
    ],
  },

  // ─── STATISTICAL ANALYSIS ─────────────────────────────────────────
  {
    slug: 'statistical-analysis',
    title: 'Statistical Analysis',
    summary: 'Understanding the statistical methods, trend tests, and what the numbers mean.',
    icon: 'statistics',
    sections: [
      {
        heading: 'Overview',
        paragraphs: [
          'The Statistical Analysis view applies rigorous statistical methods to your therapy data. Rather than just showing averages, it provides confidence intervals, trend significance, distributional analysis, and correlation matrices to help you understand patterns and make informed decisions.',
        ],
      },
      {
        heading: 'Descriptive statistics',
        paragraphs: [
          'For each metric, you will see: mean ($\\bar{x}$), median ($\\tilde{x}$), standard deviation ($s$), interquartile range (IQR), and key percentiles ($P_5$, $P_{25}$, $P_{75}$, $P_{95}$). These give a complete picture of both the central tendency and the spread of your data.',
          'The mean is the arithmetic average: $\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i$. The median is the middle value. When these differ substantially (common with AHI data), the distribution is skewed. In skewed distributions, the median often better represents the "typical" night than the mean.',
        ],
      },
      {
        heading: 'Trend analysis',
        paragraphs: [
          'Trend analysis determines whether your metrics are improving, worsening, or stable over time. The analysis uses linear regression ($y = \\beta_0 + \\beta_1 x$, for overall direction), Mann-Kendall test (a non-parametric trend test that handles non-normal data), and LOESS smoothing (to reveal non-linear trends).',
          'Results include: slope $\\hat{\\beta}_1$ (rate of change per day/week), $p$-value (statistical significance of the trend), and confidence interval for the slope. A statistically significant downward AHI trend is good news — it suggests therapy is progressively improving.',
        ],
      },
      {
        heading: 'Distribution analysis',
        paragraphs: [
          'Histograms and box plots show the shape of your data distribution. Is AHI consistently low, or does it vary widely? Are there distinct "good night" and "bad night" clusters? The distribution view helps answer these questions visually.',
          "The Shapiro-Wilk test checks whether your data follows a normal distribution, $f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}$. This matters because some statistical methods assume normality — CPAP Analyzer automatically selects appropriate methods based on your data's actual distribution.",
        ],
      },
      {
        heading: 'Correlation analysis',
        paragraphs: [
          'The correlation matrix shows relationships between metrics. For example: Is higher leak associated with higher AHI? Does AHI vary with usage hours? Correlations are displayed as a heatmap with Pearson ($r$) and Spearman ($\\rho$) coefficients.',
          'Important: correlation does not imply causation. A correlation between two metrics means they tend to move together, but not necessarily that one causes the other. Use correlations as starting points for investigation, not as conclusions.',
        ],
      },
      {
        heading: 'Change point detection',
        paragraphs: [
          'Change point detection identifies dates when your data underwent a significant shift — perhaps a pressure adjustment, mask change, or clinical event. The algorithm scans your time series for statistically significant breaks in the mean, variance, or trend.',
          'Each detected change point includes the date, the metric affected, the magnitude of change, and a confidence level. You can annotate change points with notes about what happened on that date.',
        ],
      },
    ],
  },

  // ─── EVENT ANALYSIS ───────────────────────────────────────────────
  {
    slug: 'event-analysis',
    title: 'Event Analysis',
    summary: 'Event clustering, temporal patterns, false negatives, and survival curve analysis.',
    icon: 'events',
    sections: [
      {
        heading: 'Overview',
        paragraphs: [
          'Event Analysis goes beyond counting events (AHI) to examine when, how, and why respiratory events occur. Understanding event patterns provides insights that a single AHI number cannot — event clustering, type distribution, and temporal patterns all have clinical significance.',
        ],
      },
      {
        heading: 'Event type breakdown',
        paragraphs: [
          'Events are categorized as obstructive apneas, central apneas, mixed apneas, and hypopneas. The distribution of event types matters: predominantly obstructive events respond well to CPAP pressure adjustments; predominantly central events may indicate complex sleep apnea or treatment-emergent central apnea requiring a different therapy mode.',
          'A pie chart and table show the proportion of each event type. Trend charts track how the mix changes over time — watch for an increase in central events after CPAP initiation.',
        ],
      },
      {
        heading: 'Event clustering',
        paragraphs: [
          'Events that cluster together in time are more disruptive than evenly spaced events. A burst of 10 events in one hour followed by 7 quiet hours is clinically different from 10 events evenly spread over 8 hours — even though the AHI is the same.',
          'The clustering analysis identifies event bursts (clusters of ≥ 3 events within 5 minutes) and visualizes their timing. Clusters during specific time windows may suggest positional or sleep stage effects.',
        ],
      },
      {
        heading: 'Time-to-event analysis',
        paragraphs: [
          'A Kaplan-Meier survival curve shows the probability of remaining event-free as time passes during the night. The estimator is computed as $$\\hat{S}(t) = \\prod_{t_i \\leq t} \\frac{n_i - d_i}{n_i}$$ where $n_i$ is the number at risk and $d_i$ is the number of events at time $t_i$. This reveals patterns like: events concentrated in the first 2 hours (ramp/acclimation), events concentrated in early morning (REM-dominant), or events evenly distributed.',
          'The hazard rate plot complements this by showing the instantaneous risk of an event at each time point during the night.',
        ],
      },
      {
        heading: 'Limitations',
        paragraphs: [
          'CPAP machines use proprietary algorithms to detect and classify events. Their scoring may differ from gold-standard polysomnography (PSG) by 10–30%. Machines cannot detect arousals (requires EEG) or distinguish all event subtypes with PSG accuracy. Use device-reported events as clinical screening tools, not definitive diagnoses.',
        ],
      },
    ],
  },

  // ─── PRESSURE ANALYSIS ────────────────────────────────────────────
  {
    slug: 'pressure-analysis',
    title: 'Pressure Analysis',
    summary: 'Pressure-response relationships, titration insights, and APAP/BiPAP analysis.',
    icon: 'pressure',
    sections: [
      {
        heading: 'Overview',
        paragraphs: [
          "Pressure Analysis helps you understand how your machine's pressure delivery relates to therapy effectiveness. This is especially valuable for APAP users, where the machine continuously adjusts pressure, and for evaluating whether a fixed CPAP setting is optimal.",
        ],
      },
      {
        heading: 'Pressure profile',
        paragraphs: [
          'The pressure profile shows the distribution of delivered pressures during each session. For fixed CPAP, this should be a single value (with EPR variation on exhalation). For APAP, it shows the full range of pressures the machine used, with key percentiles (P50, P90, P95).',
          'The pressure histogram reveals whether the machine spends most of its time at lower pressures (good airway stability) or frequently ramps to maximum (potential pressure inadequacy).',
        ],
      },
      {
        heading: 'Pressure-response relationship',
        paragraphs: [
          'An interactive scatter plot shows the relationship between delivered pressure and residual events. This helps answer: "At what pressure does my AHI reach its minimum?" and "Is my current pressure setting in the optimal range?"',
          'The analysis identifies the minimum effective pressure (lowest pressure with acceptable AHI) and the pressure plateau (above which additional pressure provides no further benefit).',
        ],
      },
      {
        heading: 'APAP utilization',
        paragraphs: [
          'For APAP users, this section shows how much of the allowed pressure range the machine actually uses. If P95 is consistently near Pmax, the upper limit may need to be increased. If P95 is consistently well below Pmax, the range is adequate.',
          'Time-at-pressure analysis shows what percentage of the night is spent at each pressure level. This data is commonly used by sleep physicians to determine an optimal fixed CPAP setting when transitioning from APAP.',
        ],
      },
      {
        heading: 'BiPAP/ASV analysis',
        paragraphs: [
          "For bilevel users, the analysis separately tracks IPAP and EPAP trends, pressure support (IPAP − EPAP), and the relationship between pressure support and event control. ASV-specific metrics include the machine's learned target ventilation and actual versus target minute ventilation.",
        ],
      },
    ],
  },

  // ─── REPORTS GUIDE ────────────────────────────────────────────────
  {
    slug: 'reports',
    title: 'Reports Guide',
    summary: 'How to generate, customize, and share therapy reports.',
    icon: 'reports',
    sections: [
      {
        heading: 'Overview',
        paragraphs: [
          'The Reports view lets you generate comprehensive therapy reports suitable for sharing with your sleep physician, tracking progress over time, or keeping personal records. Reports are generated entirely in your browser — no data is sent to any server.',
        ],
      },
      {
        heading: 'Report templates',
        paragraphs: [
          'Choose from several report templates: Clinical Summary (concise overview for physicians), Detailed Analysis (comprehensive report with all metrics), Compliance Report (focused on adherence metrics for insurance), and Trend Report (focusing on changes over time).',
          'Each template can be customized: select which metrics to include, the date range, whether to include charts, and the level of statistical detail.',
        ],
      },
      {
        heading: 'PDF export',
        paragraphs: [
          'Generate a formatted PDF report with charts, tables, and clinical context. The PDF is created in your browser using jsPDF — no cloud service is involved. Reports include the date range, patient identifier (if configured), machine info, and all selected metrics with interpretive context.',
        ],
      },
      {
        heading: 'CSV export',
        paragraphs: [
          'Export raw data as CSV files for use in external analysis tools (Excel, R, Python, MATLAB). You can export session summaries (one row per night), detailed signal data (time-series), or statistical results. The CSV format preserves full precision.',
        ],
      },
      {
        heading: 'Data privacy in reports',
        paragraphs: [
          'Reports are generated locally and never leave your browser unless you explicitly save or share them. You can optionally encrypt PDF reports with a password before saving. Consider removing personal identifiers from reports before sharing.',
        ],
      },
    ],
  },

  // ─── SETTINGS GUIDE ───────────────────────────────────────────────
  {
    slug: 'settings',
    title: 'Settings Guide',
    summary: 'Customizing preferences, analysis parameters, and storage management.',
    icon: 'settings',
    sections: [
      {
        heading: 'Overview',
        paragraphs: [
          'The Settings view lets you customize CPAP Analyzer to match your preferences, therapy configuration, and analysis needs. All settings are stored locally in your browser.',
        ],
      },
      {
        heading: 'Display preferences',
        paragraphs: [
          'Choose between light and dark themes. Both themes are designed for clinical data readability with WCAG AA contrast compliance. Select your preferred date format, number format, and time zone. Configure the dashboard layout and default date range.',
        ],
      },
      {
        heading: 'Analysis parameters',
        paragraphs: [
          'Configure the statistical analysis methods: rolling average window (7, 14, or 30 days), confidence interval level (90%, 95%, or 99%), and change point sensitivity. You can also set custom clinical thresholds for status indicators — for example, if your physician considers AHI < 3 as your personal target rather than the standard < 5.',
        ],
      },
      {
        heading: 'Storage management',
        paragraphs: [
          'View how much local storage your imported data occupies. CPAP Analyzer uses IndexedDB for structured data and the Origin Private File System (OPFS) for large signal files. You can selectively delete old data, export all data as a backup file, or clear all data to start fresh.',
        ],
      },
      {
        heading: 'Machine configuration',
        paragraphs: [
          'Set your machine type, therapy mode, and mask type so that CPAP Analyzer can provide more accurate interpretive context. This information is used only locally for analysis and is not transmitted anywhere.',
        ],
      },
    ],
  },

  // ─── CLINICAL REFERENCE ───────────────────────────────────────────
  {
    slug: 'clinical-reference',
    title: 'Clinical Reference',
    summary: 'AASM guidelines, severity classifications, treatment goals, and clinical context.',
    icon: 'clinical',
    sections: [
      {
        heading: 'AASM severity classifications',
        paragraphs: [
          'The American Academy of Sleep Medicine (AASM) classifies obstructive sleep apnea severity based on the Apnea-Hypopnea Index (AHI): Normal (AHI < 5 events/hr), Mild (5 ≤ AHI < 15), Moderate (15 ≤ AHI < 30), Severe (AHI ≥ 30). These thresholds are used globally for diagnosis and treatment decisions.',
          'Severity classification guides treatment approach: Mild OSA may be treated with lifestyle modification, positional therapy, or oral appliances. Moderate to severe OSA typically requires CPAP or bilevel therapy. Surgical options exist for select patients.',
        ],
      },
      {
        heading: 'Treatment goals',
        paragraphs: [
          'The primary treatment goal is to reduce the residual AHI to below 5 events/hr — functionally normalizing breathing during sleep. Additional goals include: maintaining SpO₂ > 90% throughout the night, eliminating snoring, achieving usage of ≥ 4 hours/night (ideally ≥ 6 hours), and reducing daytime symptoms (sleepiness, fatigue, cognitive impairment).',
          'Therapy success is dose-dependent: more hours of use per night and more nights per week yield greater clinical benefit. Benefits include reduced blood pressure, decreased cardiovascular risk, improved cognitive function, reduced accident risk, and improved quality of life.',
        ],
      },
      {
        heading: 'Compliance standards',
        paragraphs: [
          'Medicare and most insurance companies define CPAP compliance as usage of ≥ 4 hours per night for ≥ 70% of nights (21 out of 30 consecutive days). This threshold was established for administrative purposes but is below the level needed for full clinical benefit.',
          'Non-compliance within the initial 90-day trial period may result in loss of insurance coverage for CPAP equipment. If compliance is a concern, early intervention (mask refitting, pressure adjustment, behavior coaching) is recommended.',
        ],
      },
      {
        heading: 'Leak management guidelines',
        paragraphs: [
          'Acceptable unintentional mask leak is generally < 24 L/min. Leak above this threshold can cause: inaccurate event scoring by the machine, inadequate pressure delivery, dry mouth and eyes, aerophagia (air swallowing), and sleep disruption.',
          'Common causes of excessive leak: incorrect mask size, worn mask cushion (replace every 3–6 months), mouth opening during sleep (consider chin strap or full-face mask), and sleeping positions that displace the mask.',
        ],
      },
      {
        heading: 'When to consult your physician',
        paragraphs: [
          'Review your data with your sleep physician if: residual AHI consistently > 10, significant increase in AHI from baseline, emergence of central apneas (Central AI > 5), SpO₂ nadirs < 80%, compliance consistently below 70%, or new symptoms despite therapy.',
          'CPAP Analyzer provides data analysis tools — it is not a diagnostic device and does not provide medical advice. All clinical decisions should involve your healthcare provider.',
        ],
      },
      {
        heading: 'Disclaimer',
        paragraphs: [
          'CPAP Analyzer is intended for informational and educational purposes only. It is not a medical device and is not FDA-cleared for diagnostic or therapeutic use. The analysis provided should not be used as a substitute for professional medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider with questions about your sleep apnea therapy.',
        ],
      },
    ],
  },
] as const;

/** Map of article slug → article for O(1) lookup */
export const articleMap: ReadonlyMap<string, HelpArticle> = new Map(
  helpArticles.map((a) => [a.slug, a]),
);

/** Article slugs in display order */
export const articleSlugs: readonly string[] = helpArticles.map((a) => a.slug);
