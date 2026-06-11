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
  | 'clinical'
  | 'integrations';

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
    summary:
      'How to import CPAP data from your SD card and wearable data from Google Health (Fitbit).',
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
          'Multiple sessions on the same calendar day are fully supported — if you removed the mask and reapplied it (e.g. a nap, or getting up during the night), each session is stored separately rather than overwriting one another. Empty or header-only EDF files that contain no events (for example a CSL Cheyne-Stokes annotation file from a night with none) are skipped silently rather than reported as errors; the import summary reports how many such files were skipped so the count is transparent.',
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
      {
        heading: 'Google Health (Fitbit) import',
        paragraphs: [
          'CPAP Analyzer can import wearable health data exported from Google Takeout under the "Google Health" category (formerly Fitbit). This enables cross-source analysis — correlating your CPAP therapy metrics with sleep, activity, and physiological data from your wearable device.',
          'To export your data from Google: (1) Visit takeout.google.com. (2) Click "Deselect all," then select only "Google Health" (this contains your Fitbit data). (3) Choose your export format and click "Create export." (4) When the export is ready, download and extract the ZIP archive. (5) In CPAP Analyzer, open the Import Wizard, select "Google Health" as the source, and point the file picker at the extracted folder (the one containing subdirectories like "Sleep," "Heart Rate," etc.).',
          'The Import Wizard validates the folder structure before parsing. If it does not recognize the directory layout, verify that you selected the correct top-level folder from the extracted archive.',
        ],
      },
      {
        heading: 'Supported Google Health data types',
        paragraphs: [
          "The following data types are imported when present in the export: Sleep Sessions (start/end times, duration, efficiency), Sleep Scores (composite sleep quality metric, 0--100), Sleep Stages (wake, light, deep, REM durations and transitions), SpO\\u2082 — daily summary and per-minute intraday readings (peripheral oxygen saturation measured by the wearable's red/infrared sensor), HRV — daily summary and detailed intraday readings (heart rate variability, measured as RMSSD in milliseconds), Respiratory Rate (breaths per minute during sleep), Resting Heart Rate (daily resting BPM), Readiness Score (recovery/readiness composite, 0--100), Stress Score (stress management composite), Skin Temperature (nightly deviation from personal baseline in degrees), Daily Activity (steps, active minutes, calories), and Snoring (detected snoring episodes and duration).",
          'Not every Fitbit device records every data type. Older trackers may lack SpO\\u2082, HRV, or skin temperature sensors. The importer processes whatever data is present and silently skips missing categories.',
        ],
      },
      {
        heading: 'Incremental import and duplicate detection',
        paragraphs: [
          'Re-importing the same Google Health export — or a newer export that overlaps with previously imported dates — is safe. The importer detects duplicates by matching on data type, date, and timestamp. Records that already exist in the local database are skipped; only genuinely new records are added. This means you can periodically re-export from Google Takeout and re-import without manually tracking which dates you have already loaded.',
        ],
      },
      {
        heading: 'Data privacy for Google Health imports',
        paragraphs: [
          'Google Health data is processed entirely in your browser, using the same client-side architecture as CPAP SD card imports. No data is uploaded to any server during or after the import. The parsed records are stored locally in IndexedDB alongside your CPAP data. The original export files on your computer are read but never modified.',
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
          'Missing data is treated as missing, not as zero. Pressure, leak, and respiratory statistics are computed only over samples that were actually recorded; gaps where the sensor produced no value are excluded rather than folded in as real zeros, which would otherwise bias means and percentiles downward. SpO₂-derived statistics are similarly computed over valid-oximetry time only (see oximetry coverage %).',
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
          "The Shapiro–Francia test checks whether your data follows a normal distribution, $f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}$. Shapiro–Francia is the correlation-based variant of the Shapiro–Wilk family — it is the statistic CPAP Analyzer actually computes (a squared correlation between the ordered data and the expected normal order statistics), and it is well suited to that correlation form. This matters because some statistical methods assume normality — CPAP Analyzer automatically selects appropriate methods based on your data's actual distribution.",
        ],
      },
      {
        heading: 'Correlation analysis',
        paragraphs: [
          'The correlation matrix shows relationships between metrics. For example: Is higher leak associated with higher AHI? Does AHI vary with usage hours? Correlations are displayed as a heatmap with Pearson ($r$) and Spearman ($\\rho$) coefficients.',
          'Important: correlation does not imply causation. A correlation between two metrics means they tend to move together, but not necessarily that one causes the other. Use correlations as starting points for investigation, not as conclusions.',
          'For directional questions, a Granger causality test asks whether the past of one series helps predict another beyond the series\' own past. Treat its results as exploratory: when you scan many metric pairs, the reported $p$-values are selection-affected (not corrected for multiple comparisons), and CPAP Analyzer now flags this. The test also assumes (weak) stationarity, so non-stationary inputs — for example a series with a strong trend or change point — are flagged because they can produce spurious "causality." Granger causality measures predictive precedence, not physiological cause, and is never on its own a basis for a clinical decision.',
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

  // ─── INTERPRETING GRANGER CAUSALITY ───────────────────────────────
  {
    slug: 'interpreting-granger-causality',
    title: 'Interpreting Granger Causality',
    summary:
      'How to read the Granger Causality tab: predictive precedence vs. causation, directionality, the exploratory flag, non-stationarity, confidence, and the AIC-by-lag chart.',
    icon: 'statistics',
    sections: [
      {
        heading: 'What Granger causality is (and is not)',
        paragraphs: [
          'Granger causality answers a forecasting question, not a mechanistic one. It fits two nested vector-autoregression (VAR) models for the target metric Y: a restricted model using only Y’s own lagged history, $y_t = \\sum \\alpha_i y_{t-i} + \\varepsilon$, and an unrestricted model that also adds the lagged history of a second metric X, $y_t = \\sum \\alpha_i y_{t-i} + \\sum \\beta_i x_{t-i} + \\varepsilon$. An F-test then asks whether the X terms jointly improve the prediction (i.e. whether all $\\beta_i = 0$ can be rejected). If they do, X is said to "Granger-cause" Y — meaning the past of X has predictive precedence over Y.',
          'This is predictive precedence, not proof of physical causation. A lurking third variable — a behavior, an illness, a seasonal factor, or an equipment change that drives both series — can produce exactly the same pattern. Granger causality narrows down candidate relationships to investigate; it never establishes a mechanism on its own, and it is never by itself a basis for a clinical decision.',
        ],
      },
      {
        heading: 'Directionality: X→Y and Y→X are separate tests',
        paragraphs: [
          'The three statistics in the Directional detail panel — the F-statistic, the p-value, and the reported lag — describe the X→Y direction only: does the past of X help predict Y? The reverse question, does the past of Y help predict X, is a distinct test with its own F-statistic and p-value.',
          'The verdict and confidence shown at the top of the tab consider both directions; the directional statistics shown below them do not. The two directions can disagree — it is common for X→Y to be significant while Y→X is not, which is itself informative about which metric tends to lead.',
        ],
      },
      {
        heading: 'The "Exploratory p-value (lag auto-selected)" flag',
        paragraphs: [
          'In Exploratory mode the lag is chosen automatically by minimizing the Akaike Information Criterion (AIC) over the candidate lags — and then the F-test is run at that same lag on the same nights. When the data both chooses and tests the model, the resulting p-value is selection-affected: it is anti-conservative and understates the true false-positive rate, so causality is declared too readily. This is a post-selection inference problem (Leeb & Pötscher 2005), and CPAP Analyzer flags it rather than presenting such a p-value as a clean inferential quantity.',
          'Read a flagged result as hypothesis-generating, not confirmed. To obtain a clean inferential p-value, switch to Confirmatory mode and fix the lag in advance — ideally a lag chosen from prior knowledge or estimated on a separate stretch of nights, not read off the AIC chart for the very data you are testing.',
        ],
      },
      {
        heading: 'The non-stationarity caution',
        paragraphs: [
          'The VAR F-test assumes its inputs are at least trend-stationary — their mean does not drift systematically over time. CPAP nightly series often violate this (acclimatization, weight change, seasonal leak). When CPAP Analyzer detects a significant deterministic linear trend in either input series, it raises a non-stationarity caution naming the affected metric.',
          'This matters because a trend shared by two otherwise unrelated series can manufacture spurious Granger causality — the same mechanism behind spurious regression (Granger & Newbold 1974), where independent trending series appear strongly related. The usual remedy is first-differencing: analyze night-to-night changes ($\\Delta x_t = x_t - x_{t-1}$) instead of levels, which removes a linear trend and often restores stationarity before re-running the test.',
        ],
      },
      {
        heading: 'Confidence levels',
        paragraphs: [
          'The confidence chip summarizes the strength of evidence based on the more significant of the two directions: high when $p < 0.01$, moderate when $p < 0.05$, and low otherwise. Confidence is shown with a label and a dot indicator, not by color alone.',
          'Confidence reflects statistical strength only. A "high" confidence result that carries the exploratory flag is still selection-affected, and even a clean high-confidence result is predictive precedence, not proof of causation. Always weigh confidence together with the exploratory and non-stationarity flags.',
        ],
      },
      {
        heading: 'The AIC-by-lag chart',
        paragraphs: [
          'AIC (Akaike Information Criterion) scores each candidate lag’s model by balancing fit against complexity: $\\text{AIC} = n\\ln(\\text{RSS}/n) + 2k$, where lower is better. Only differences in AIC between lags are meaningful — it is a comparison tool, not an absolute measure of fit.',
          'Each point on the chart is the AIC for the unrestricted X→Y model at that lag. In Exploratory mode the lag with the lowest AIC is the one tested, marked by the reference line — which is precisely why that result’s p-value is selection-affected. Lags that cannot be fit because too few paired nights remain appear as gaps (infeasible lags), not as zero.',
        ],
      },
      {
        heading: 'Assumptions and limitations',
        paragraphs: [
          'The test assumes: (1) (trend-)stationary inputs — a significant linear trend triggers the non-stationarity caution; (2) roughly equal time spacing — CPAP Analyzer uses one value per night; and (3) a linear lagged relationship — purely non-linear dependence may be missed.',
          'Data requirements: the test needs at least $2 \\cdot \\text{maxLag} + 2$ paired nights (nights where both metrics have a finite value); below that threshold the result reports as insufficient data and you can reduce the max lag. A constant metric (no variation across nights) carries no information to test and cannot be used.',
          'Because the per-pair p-values are not corrected for multiple comparisons, scanning many metric pairs further inflates false positives — another reason to treat Exploratory findings as leads to confirm. CPAP Analyzer reports Granger results for exploration and does not diagnose.',
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'Granger, C. W. J. (1969). Investigating causal relations by econometric models and cross-spectral methods. Econometrica, 37(3), 424–438.',
          'Granger, C. W. J., & Newbold, P. (1974). Spurious regressions in econometrics. Journal of Econometrics, 2(2), 111–120.',
          'Leeb, H., & Pötscher, B. M. (2005). Model selection and inference: facts and fiction. Econometric Theory, 21(1), 21–59.',
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
          'The summary cards labelled "Mean EPAP" and "Mean IPAP" report the mean across nights of each night\'s median pressure (a mean of nightly medians) — not a grand median. They were previously labelled "Median EPAP/IPAP"; the relabel makes the statistic match what is computed. For a robust single-night central value, read the per-session pressure profile, which reports the within-night median and percentiles directly.',
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

  // ─── CROSS-SOURCE ANALYSIS ────────────────────────────────────────
  {
    slug: 'cross-source-analysis',
    title: 'Cross-Source Analysis',
    summary:
      'Correlating CPAP therapy data with wearable health metrics to discover relationships and track holistic sleep health.',
    icon: 'integrations',
    sections: [
      {
        heading: 'What cross-source analysis does',
        paragraphs: [
          'Cross-Source Analysis correlates metrics from your CPAP machine with metrics from your wearable device (e.g., Fitbit via Google Health). By aligning nightly CPAP data (AHI, leak, pressure, usage) with wearable data (HRV, SpO₂, sleep stages, activity, resting heart rate, readiness), you can explore questions like: Does higher daytime activity predict lower AHI? Does poor HRV correlate with more respiratory events? How does sleep efficiency from the wearable compare to CPAP usage duration?',
          'These analyses are exploratory. They surface candidate relationships for you to investigate — they do not establish causation and are not clinical diagnoses. Treat every finding as a hypothesis, not a conclusion.',
        ],
      },
      {
        heading: 'Correlation Explorer tab',
        paragraphs: [
          'The Correlation Explorer lets you select any two metrics — one from each data source, or both from the same source — and visualize their relationship with a scatter plot and regression line. For each pair the Explorer reports:',
          'Correlation coefficient ($r$ or $\\rho$): A value between $-1$ and $+1$ measuring the strength and direction of the linear (Pearson $r$) or monotonic (Spearman $\\rho$) relationship. Values near $\\pm 1$ indicate a strong relationship; values near $0$ indicate little or no relationship.',
          'P-value: The probability of observing a correlation this extreme if the two metrics were actually unrelated ($H_0\\colon r = 0$). A small $p$-value (conventionally $< 0.05$) suggests the observed correlation is unlikely to be due to chance alone — but see the caveats below.',
          '95% confidence interval: The range within which the true population correlation likely falls, given your sample size. Narrow intervals indicate a more precise estimate; wide intervals mean less certainty.',
          'Strength classification: A plain-language label (negligible, weak, moderate, strong, very strong) based on the absolute value of the coefficient. This follows standard thresholds: $|r| < 0.1$ negligible, $0.1$–$0.3$ weak, $0.3$–$0.5$ moderate, $0.5$–$0.7$ strong, $> 0.7$ very strong.',
        ],
      },
      {
        heading: 'Correlation Matrix tab',
        paragraphs: [
          'The Correlation Matrix displays pairwise correlations for all available metrics as a color-coded heatmap. Cells are colored on a diverging scale: deep blue for strong negative correlations, white for near-zero, and deep red for strong positive correlations. Statistically significant cells ($p < 0.05$) are marked to distinguish them from non-significant results.',
          'How to read the matrix: scan the row and column headers to find the metric pair of interest. The cell value is the Pearson $r$ (or Spearman $\\rho$, depending on your settings). Focus first on cells that are both strongly colored and marked significant — these are the most likely to reflect real relationships rather than noise.',
          'With many metric pairs in the matrix, some will appear significant by chance alone (the multiple comparisons problem). If you test 50 independent pairs at $\\alpha = 0.05$, you expect roughly 2–3 false positives. Use the matrix as a discovery tool: note the interesting pairs, then investigate them individually in the Correlation Explorer with domain knowledge in mind.',
        ],
      },
      {
        heading: 'Metric Comparison tab',
        paragraphs: [
          'The Metric Comparison tab provides two advanced analysis modes for pairs of metrics: Bland-Altman agreement analysis and lagged cross-correlation.',
          'Bland-Altman analysis: When two sources measure the same underlying quantity (e.g., SpO₂ from the wearable vs. SpO₂ estimated from CPAP flow signals, or sleep duration from the wearable vs. CPAP usage hours), a Bland-Altman plot assesses how well they agree. It plots the difference between the two measurements ($y$-axis) against their average ($x$-axis). If the measurements agree perfectly, all points lie on the zero line. The plot shows the mean bias (systematic offset), 95% limits of agreement (mean $\\pm$ 1.96 SD of the differences), and whether the bias is proportional (larger at higher values). A small mean bias and narrow limits of agreement indicate good agreement between the two sources.',
          'Lagged cross-correlation: This analysis shifts one time series forward or backward relative to the other by 0 to $N$ days and computes the correlation at each lag. It answers: "Does a change in metric X today predict a change in metric Y tomorrow (or two days later, etc.)?" For example, you might find that high step counts on day $t$ correlate with lower AHI on day $t+1$, suggesting a one-day delayed relationship. The lag with the highest absolute correlation is highlighted, along with its statistical significance. Be cautious: testing multiple lags inflates false-positive risk, so treat the optimal lag as exploratory.',
        ],
      },
      {
        heading: 'Statistical methods',
        paragraphs: [
          'Pearson correlation ($r$) measures the linear relationship between two continuous variables. It assumes both variables are approximately normally distributed and that the relationship is linear. It is sensitive to outliers — a single extreme night can inflate or deflate $r$.',
          'Spearman rank correlation ($\\rho$) measures the monotonic relationship between two variables (whether one tends to increase as the other increases, not necessarily linearly). It operates on ranks rather than raw values, making it robust to outliers and applicable to non-normal data. CPAP Analyzer defaults to Spearman when either variable fails a normality check.',
          'Partial correlation measures the association between two variables after removing the influence of one or more confounding variables. For example, the partial correlation between AHI and HRV controlling for usage hours tells you whether the AHI–HRV relationship persists after accounting for the fact that both may be influenced by how long you wore the CPAP mask.',
          'P-values: In this context, a $p$-value answers: "If these two metrics had zero true correlation in the population, how likely is it that I would observe a sample correlation at least this large?" A small $p$ (typically $< 0.05$) is conventionally called "statistically significant," meaning the result is unlikely under the null hypothesis. However, statistical significance does not guarantee clinical importance — a weak correlation can be significant with enough data points, and a strong correlation can fail to reach significance with too few. Always consider effect size (the coefficient itself) alongside $p$.',
        ],
      },
      {
        heading: 'Correlation does not imply causation',
        paragraphs: [
          'This is the single most important caveat for cross-source analysis. A statistically significant correlation between two metrics means they tend to move together — it does not mean one causes the other. There are several reasons a spurious correlation can appear:',
          'Confounders: A third variable drives both metrics. For example, seasonal changes can simultaneously affect sleep quality, AHI, and activity levels, creating apparent correlations between metrics that are actually independent once season is controlled for.',
          'Reverse causation: The direction of influence may be opposite to what you assume. A correlation between poor sleep (low HRV) and high AHI could mean untreated apnea worsens HRV, or that poor autonomic function worsens apnea, or both.',
          'Coincidence and multiple testing: When you examine many metric pairs, some will correlate by chance. With 20 pairs at $\\alpha = 0.05$, you expect one false positive on average.',
          'These analyses are designed to help you generate hypotheses — for example, "I should discuss my exercise-AHI pattern with my sleep physician" — not to reach clinical conclusions independently.',
        ],
      },
      {
        heading: 'Key caveats and limitations',
        paragraphs: [
          'Self-reported vs. device-measured data: Some Fitbit metrics (e.g., sleep logs) can be manually edited by the user, which may introduce inaccuracies. Device-measured metrics (e.g., heart rate, SpO₂) are generally more reliable but still subject to sensor limitations (motion artifact, poor fit, skin tone effects on optical sensors).',
          'Confounders: Many variables that affect sleep and health are not captured by either device — medication changes, alcohol consumption, stress, illness, travel, altitude, and ambient temperature can all influence both CPAP and wearable metrics simultaneously.',
          'Small sample sizes: If you have only a few weeks of overlapping data, correlation estimates are imprecise (wide confidence intervals) and significance tests have low statistical power — you may miss real relationships or find spurious ones. As a rough guideline, at least 30 overlapping nights are needed for reasonably stable correlation estimates, and 60+ are preferable for lagged analyses.',
          'Measurement differences: The wearable and CPAP machine may define "sleep" differently (wearable uses actigraphy and heart rate; CPAP uses mask-on time). Timestamps may differ by minutes. These discrepancies are generally small but can introduce noise into the correlations.',
          'Ecological inference: Nightly aggregates obscure within-night dynamics. A night with 4 hours of excellent therapy followed by 4 hours of poor therapy looks the same in the summary as a uniformly mediocre night.',
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
