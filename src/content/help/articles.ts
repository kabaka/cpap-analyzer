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
          'The compliance card shows the percentage of nights in the selected date range that met the ≥ 4-hour usage target, and a calendar heatmap marks which nights met the target (green) and which did not (red). For reference, the Medicare/insurance adherence standard is ≥ 4 hours/night on ≥ 70% of nights (21 of 30) over a consecutive 30-day period within the first 90 days of therapy (CMS LCD L33718). The card reports the simple proportion of compliant nights over whatever range you have selected — it is not the windowed 30-day test, so compare it against that standard rather than reading it as the standard itself.',
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
          'Trend analysis determines whether your metrics are improving, worsening, or stable over time. CPAP Analyzer fits an ordinary-least-squares linear regression ($y = \\beta_0 + \\beta_1 x$) for the overall direction, tests the slope with a Student-$t$ test, and overlays a LOESS curve (Cleveland 1979) to reveal non-linear structure a straight line would miss.',
          'Results include the slope $\\hat{\\beta}_1$ (rate of change per day or week), the coefficient of determination $R^2$ (how much of the variation the linear fit explains), and the $p$-value for the slope (the statistical significance of the trend). A statistically significant downward AHI trend is good news — it suggests therapy is progressively improving. Because nightly metrics such as AHI are often right-skewed, weigh the LOESS curve alongside the straight-line slope rather than relying on the line alone.',
        ],
      },
      {
        heading: 'Distribution analysis',
        paragraphs: [
          'Histograms and box plots show the shape of your data distribution. Is AHI consistently low, or does it vary widely? Are there distinct "good night" and "bad night" clusters? The distribution view helps answer these questions visually.',
          "The Shapiro–Francia test checks whether your data follows a normal distribution, $f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}$. Shapiro–Francia is the correlation-based variant of the Shapiro–Wilk family — it is the statistic CPAP Analyzer actually computes (a squared correlation between the ordered data and the expected normal order statistics), and it is well suited to that correlation form. This matters because some statistical methods assume normality: CPAP Analyzer reports the Shapiro–Francia result alongside the histogram and Q–Q plot and offers rank-based (non-parametric) alternatives — for example Spearman's $\\rho$ for correlation — so you can choose a method appropriate to your data's actual distribution.",
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
          'Change point detection identifies dates when your data underwent a significant shift — perhaps a pressure adjustment, mask change, or clinical event. CPAP Analyzer uses the PELT algorithm (Killick et al. 2012) to find breaks in the mean level of a series; it does not currently test for changes in variance or slope on their own.',
          "Each detected change point reports the date, the metric affected, and the magnitude of the mean shift (the size of the level change, in the metric's own units — not a calibrated probability). You can annotate change points with notes about what happened on that date.",
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'Tukey, J. W. (1977). Exploratory Data Analysis. Reading, MA: Addison-Wesley. — Interquartile-range fences for outlier detection and box plots.',
          'Shapiro, S. S., & Francia, R. S. (1972). An approximate analysis of variance test for normality. Journal of the American Statistical Association, 67(337), 215–216. DOI: 10.1080/01621459.1972.10481232. — The normality statistic CPAP Analyzer computes.',
          'Royston, P. (1993). A toolkit for testing for non-normality in complete and censored samples. The Statistician (Journal of the Royal Statistical Society, Series D), 42(1), 37–43. DOI: 10.2307/2348109. — Shapiro–Francia p-value transform.',
          'Cleveland, W. S. (1979). Robust locally weighted regression and smoothing scatterplots. Journal of the American Statistical Association, 74(368), 829–836. DOI: 10.1080/01621459.1979.10481038. — LOESS smoothing.',
          'Killick, R., Fearnhead, P., & Eckley, I. A. (2012). Optimal detection of changepoints with a linear computational cost. Journal of the American Statistical Association, 107(500), 1590–1598. DOI: 10.1080/01621459.2012.737745. — PELT change-in-mean detection.',
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
          'Akaike, H. (1974). A new look at the statistical model identification. IEEE Transactions on Automatic Control, 19(6), 716–723. DOI: 10.1109/TAC.1974.1100705. — The Akaike Information Criterion used for lag selection.',
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
          "The Event Explorer's clustering lens groups events that occur close together in time, with selectable sensitivity: strict (≥ 3 events separated by gaps under 1 minute), balanced (≥ 2 events within 2 minutes), and lenient (≥ 2 events within 5 minutes). Clusters concentrated in specific time windows may suggest positional or sleep-stage effects.",
        ],
      },
      {
        heading: 'Temporal patterns and time-to-event',
        paragraphs: [
          'Where events fall in the night matters as much as how many there are. Events concentrated in the first couple of hours can reflect ramp or acclimatization; events concentrated toward morning often track REM-dominant disease (REM periods lengthen in the second half of the night); events spread evenly suggest a pressure or positional cause present all night.',
          "The Event Explorer's inter-event-interval lens shows the distribution of time gaps between consecutive events: a peak at short intervals indicates clustering, while a long-tailed distribution indicates isolated events. Combined with the time-of-night filter, it answers questions such as “do my apneas cluster in the first two hours?”",
          'A related classical tool is the Kaplan–Meier estimator (Kaplan & Meier 1958), $\\hat{S}(t) = \\prod_{t_i \\leq t} \\frac{n_i - d_i}{n_i}$, where $n_i$ is the number still event-free (“at risk”) just before time $t_i$ and $d_i$ is the number of events at $t_i$ — it expresses the probability of remaining event-free as the night progresses. CPAP Analyzer retains the Kaplan–Meier primitive (with Greenwood-variance confidence intervals) for analyses that need it; the dedicated survival-curve view was retired when Event Analysis was reorganized into the Event Explorer, whose interval and clustering lenses answer the same temporal questions.',
        ],
      },
      {
        heading: 'Limitations',
        paragraphs: [
          'CPAP machines score events from airflow and pressure alone, using proprietary algorithms, and cannot detect EEG arousals. Device-reported AHI may therefore differ from manually scored polysomnography (PSG) — sometimes substantially, and in either direction — depending on the device, its scoring algorithm, and which hypopnea rule is applied. Polysomnography remains the diagnostic standard (Kapur et al. 2017); treat device-reported events as a monitoring and screening signal, not a diagnostic substitute.',
          'One specific consequence of flow-only scoring: an apnea the device cannot confidently classify as obstructive or central is reported as an unclassified apnea. It still counts toward AHI, but it is not folded into the obstructive, central, or mixed totals — most often this happens when high mask leak degrades the forced-oscillation measurement the device uses to tell central from obstructive.',
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172. — Definitions of obstructive, central, and mixed apnea, hypopnea, and RERA.',
          'Kapur, V. K., Auckley, D. H., Chowdhuri, S., et al. (2017). Clinical Practice Guideline for Diagnostic Testing for Adult Obstructive Sleep Apnea: An AASM Clinical Practice Guideline. Journal of Clinical Sleep Medicine, 13(3), 479–504. DOI: 10.5664/jcsm.6506. — Polysomnography is the diagnostic standard; device-derived event counts are a screening signal, not a diagnostic substitute.',
          'Kaplan, E. L., & Meier, P. (1958). Nonparametric estimation from incomplete observations. Journal of the American Statistical Association, 53(282), 457–481. DOI: 10.1080/01621459.1958.10501452. — The Kaplan–Meier estimator.',
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
          "For bilevel users, the analysis separately tracks IPAP and EPAP trends, pressure support (IPAP − EPAP), and the relationship between pressure support and event control. ASV-specific metrics include the machine's learned target ventilation and actual versus target minute ventilation. These metrics are descriptive: ASV is contraindicated in symptomatic heart failure with reduced ejection fraction (LVEF ≤ 45%) following the SERVE-HF trial (Cowie et al. 2015), and any change of therapy mode is a clinician decision, not one to make from these charts.",
          'The summary cards labelled "Mean EPAP" and "Mean IPAP" report the mean across nights of each night\'s median pressure (a mean of nightly medians) — not a grand median. They were previously labelled "Median EPAP/IPAP"; the relabel makes the statistic match what is computed. For a robust single-night central value, read the per-session pressure profile, which reports the within-night median and percentiles directly.',
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'Epstein, L. J., Kristo, D., Strollo, P. J., et al. (2009). Clinical guideline for the evaluation, management and long-term care of obstructive sleep apnea in adults. Journal of Clinical Sleep Medicine, 5(3), 263–276. — In-lab and auto-titration, including use of the 90th/95th-percentile auto-adjusting pressure to derive a fixed CPAP prescription.',
          'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172. — Event definitions underlying the pressure–AHI response analysis.',
          'Cowie, M. R., Woehrle, H., Wegscheider, K., et al. (2015). Adaptive servo-ventilation for central sleep apnea in systolic heart failure (SERVE-HF). New England Journal of Medicine, 373(12), 1095–1105. DOI: 10.1056/NEJMoa1506459. — Safety caveat for ASV in heart failure with reduced ejection fraction (relevant to the BiPAP/ASV section).',
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
          'Therapy success is dose-dependent: more hours of use per night and more nights per week yield greater clinical benefit. In the Weaver et al. (2007) dose-response study, subjective sleepiness normalized near 4 hours of nightly use, objective alertness near 6 hours, and daily functioning near 7.5 hours — there is no single threshold above which benefit abruptly stops. Reported benefits of consistent therapy include reduced blood pressure, improved daytime alertness and cognition, reduced accident risk, and improved quality of life.',
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
          'A common acceptability threshold for unintentional mask leak is < 24 L/min — but note this is a ResMed device/manufacturer convention (the "large leak" red line), not an AASM clinical standard, and it is mask-dependent (ResMed cites roughly 36 L/min for some full-face/oronasal masks). Leak above the flagged threshold can cause inaccurate event scoring by the machine, inadequate pressure delivery, dry mouth and eyes, aerophagia (air swallowing), and sleep disruption.',
          'Common causes of excessive leak: incorrect mask size, a worn mask cushion (manufacturers typically recommend replacing cushions on a regular schedule — often every 1–6 months depending on the cushion type), mouth opening during sleep (consider a chin strap or full-face mask), and sleeping positions that displace the mask.',
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
      {
        heading: 'References',
        paragraphs: [
          'Epstein, L. J., Kristo, D., Strollo, P. J., et al. (2009). Clinical guideline for the evaluation, management and long-term care of obstructive sleep apnea in adults. Journal of Clinical Sleep Medicine, 5(3), 263–276. — AASM severity classification (Normal/Mild/Moderate/Severe) and treatment goals.',
          'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172. — Apnea, hypopnea (recommended ≥3% desaturation or arousal; acceptable ≥4%), and RERA scoring definitions.',
          'Weaver, T. E., Maislin, G., Dinges, D. F., et al. (2007). Relationship between hours of CPAP use and achieving normal levels of sleepiness and daily functioning. Sleep, 30(6), 711–719. DOI: 10.1093/sleep/30.6.711. — Dose-response: sleepiness normalizes near 4 h, objective alertness near 6 h, daily functioning near 7.5 h.',
          'Centers for Medicare & Medicaid Services. Local Coverage Determination L33718: Positive Airway Pressure (PAP) Devices for the Treatment of Obstructive Sleep Apnea. — Adherence defined as ≥4 h/night on ≥70% of nights over a consecutive 30-day period within the first 90 days.',
          'Cowie, M. R., Woehrle, H., Wegscheider, K., et al. (2015). Adaptive servo-ventilation for central sleep apnea in systolic heart failure (SERVE-HF). New England Journal of Medicine, 373(12), 1095–1105. DOI: 10.1056/NEJMoa1506459. — Increased cardiovascular mortality with ASV in heart failure with reduced ejection fraction (LVEF ≤ 45%).',
          'ResMed. Unintentional leak is flagged as a large leak at 24 L/min (device/manufacturer convention; some oronasal masks use ~36 L/min). This is a device threshold, not an AASM clinical standard.',
        ],
      },
    ],
  },

  // ─── BREATHING PATTERNS ───────────────────────────────────────────
  {
    slug: 'breathing-patterns',
    title: 'Breathing Patterns: Periodic Breathing, Cheyne-Stokes & TECSA',
    summary:
      'How CPAP Analyzer detects periodic breathing, Cheyne-Stokes respiration, and treatment-emergent central sleep apnea — methods, defaults, confidence, and the clinical caveats that frame every result.',
    icon: 'clinical',
    sections: [
      {
        heading: 'What these patterns are',
        paragraphs: [
          'Periodic breathing (PB), Cheyne-Stokes respiration (CSR), and treatment-emergent central sleep apnea (TECSA, also called complex sleep apnea or CompSA) are three faces of the same underlying problem: an unstable respiratory control loop. Healthy breathing is regulated by chemoreceptors that sense arterial CO₂ and adjust ventilation to keep it near a setpoint. When the control loop has high gain — meaning a small change in CO₂ provokes a large ventilatory response — the system overshoots, drives CO₂ below the apneic threshold (the CO₂ level below which the brainstem stops issuing inspiratory drive), and a central apnea results. Ventilation then resumes, CO₂ rebuilds and overshoots, and the cycle repeats. The three patterns differ in how that instability manifests, not in their root mechanism.',
          'Periodic breathing (PB) is the umbrella term: a repeating cycle of waxing and waning tidal volume that may or may not include frank central apneas. It can appear at altitude, in heart failure, on opioids, in some neurological conditions, and idiopathically.',
          'Cheyne-Stokes respiration (CSR) is a specific morphology of PB defined by a crescendo-decrescendo envelope around each central apnea (breaths grow louder/deeper, then quieter/shallower into the apnea), with cycle lengths of 40–120 s (typically 45–90 s). Per AASM scoring, a CSR run requires ≥3 consecutive central apneas separated by crescendo-decrescendo breathing; at the session level the standard further requires either ≥5 central events per hour or ≥2 hours of cyclic pattern. CSR is most often seen with congestive heart failure but also occurs after stroke and in some renal disease.',
          'TECSA (treatment-emergent central sleep apnea) is a longitudinal pattern, not a per-night one: predominantly obstructive breathing at diagnosis converts to predominantly central breathing once CPAP is started, then often resolves on its own as the patient adapts. The widely cited Liu et al. 2017 cohort of ~133,000 patients identifies four such trajectories — obstructive (stable), transient (central early, resolves), persistent (central throughout), and emergent (obstructive at first, central later). TECSA is operationally defined when the central-apnea index (CAI) crosses a threshold (commonly 5/h) on therapy.',
          'How these differ from obstructive events matters for what the data look like. In an obstructive apnea the airway is closed but respiratory effort continues — flow stops while chest and abdominal motion persist. In a central apnea both flow and effort stop — the brain is not asking for a breath. ResMed machines distinguish the two by briefly modulating mask pressure during an apnea (forced oscillation technique, FOT) and listening for an airway response; an open airway implies central, a closed airway implies obstructive. PB and CSR are populations of central events with cyclic morphology, not a separate event type.',
        ],
      },
      {
        heading: 'Why this matters — and why it is not a diagnosis',
        paragraphs: [
          'CSR has a recognized association with reduced cardiac function. Studies of CSR cycle length consistently find that longer cycles track lower cardiac output and worse heart-failure severity: the cycle length is roughly twice the lung-to-chemoreceptor circulation time, which lengthens as cardiac output falls (Midelet et al. 2023; Javed et al. 2018). The presence of CSR on a CPAP report is therefore a candidate signal that warrants conversation with a clinician — particularly if it is new, sustained, or progressive. It is not a heart-failure diagnosis. Many causes are possible, and a cardiac evaluation is the appropriate next step if a clinician thinks the signal warrants one.',
          'TECSA, despite its alarming name, is most often self-limiting. Across the literature, somewhere on the order of 60–80% of patients with treatment-emergent central events show spontaneous resolution within roughly the first three months of continued CPAP as the respiratory control loop re-adapts (Nigam et al. 2016 systematic review; Kwok et al. 2022). The Liu et al. 2017 trajectory model exists precisely to distinguish patients who will resolve from those who will not — which is why we surface the trajectory rather than a single yes/no label.',
          'The single most important clinical caveat: do not self-prescribe adaptive servo-ventilation (ASV) on the basis of CSR or central-apnea findings here. The SERVE-HF randomized trial (Cowie et al. 2015) showed increased all-cause and cardiovascular mortality with ASV in patients who had symptomatic chronic heart failure with reduced ejection fraction (LVEF ≤ 45% with predominantly central sleep apnea); on the strength of that trial, ASV is contraindicated in this group. Adjusting therapy mode — particularly moving to ASV — is a clinician decision informed by echocardiography and the full clinical picture, not by a software flag. CPAP Analyzer surfaces candidate patterns for discussion; it does not diagnose, does not recommend therapy changes, and does not classify ejection fraction.',
        ],
      },
      {
        heading: 'What ResMed flags — and what it does not',
        paragraphs: [
          'ResMed machines apply forced oscillation technique (FOT) during apneas to classify them as ClearAirway (central) or obstructive, and they include an on-device CSR detector that flags a CSR run when it observes ≥15 consecutive minutes of cyclic crescendo-decrescendo breathing with cycle length in the 40–120 s band. These flags are conservative and binary: they fire only above the device-internal thresholds and surface no morphology — no cycle length, no modulation depth, no graded confidence.',
          'What the device does not surface, and what CPAP Analyzer adds: sub-threshold periodic breathing (cyclic envelopes that do not reach the device CSR criterion), short CSR runs (shorter than the 15-minute device floor), the morphology of each candidate episode (cycle length, modulation depth, crescendo-decrescendo shape score), and the cross-night TECSA trajectory. These are computed in-browser from the same raw data the device already records; nothing leaves your machine.',
        ],
      },
      {
        heading: 'How CPAP Analyzer detects PB and CSR',
        paragraphs: [
          'PB and CSR detection runs per-session on the airflow / minute-ventilation envelope, not on raw 25 Hz flow. Breaths are segmented from the flow signal, then summarized into a per-breath envelope (tidal volume or minute ventilation). The envelope is the substrate every literature-validated single-channel method works on (Weinreich et al. 2009; Javed et al. 2018; Guyot et al. 2020; Midelet et al. 2023). No esophageal or respiratory-effort belt is required, and CPAP data does not provide one.',
          'Periodicity is established by autocorrelation of the envelope. A dominant lag in the 40–120 s band, with a sufficiently sharp peak, is the necessary signature of cyclic ventilation. The modulation index — a Guyot-style measure on $[0, 1]$ of how strongly the envelope oscillates relative to its mean — is the primary confidence basis: a near-flat envelope scores near $0$, a deeply modulated cyclic envelope scores near $1$.',
          'Morphology — the crescendo-decrescendo shape that distinguishes CSR from generic oscillation — is scored separately with a harmonic-ratio measure: the fraction of in-band spectral energy concentrated at the fundamental cycle frequency, $\\text{HR} = E_{\\text{fundamental}} / E_{\\text{in-band total}}$. A pure crescendo-decrescendo waveform is nearly sinusoidal at its fundamental and scores high; a noisy or non-sinusoidal cyclic envelope scores lower. This separates CSR-shaped runs from other periodic patterns.',
          'CSR is then scored against the AASM morphology criteria: a candidate run requires ≥3 consecutive central events with crescendo-decrescendo envelopes between them and a cycle length ≥40 s (typically 45–90 s). The session-level criterion — ≥5 central events per hour over ≥2 hours of cyclic pattern, the threshold ResMed uses internally — is computed and reported as a separate boolean field, `sessionCriterionMet`, so that short or borderline runs are not silently promoted to a session-level CSR label. Device `ClearAirway` flags are used to anchor the cycle nadirs of each candidate run, which both improves boundary accuracy and reduces false positives on flow artifacts.',
          'Sub-threshold periodic breathing (PB without sufficient central events to meet CSR) and short CSR runs that fall below the device 15-minute floor are surfaced explicitly as "candidate / below device threshold," not silently dropped and not promoted to formal flags. The distinction is preserved in the rendering: device-asserted CSR shows one way, computed candidates show another. (See "How to read these in the app" below.)',
          'Every detection carries a confidence on $[0, 1]$ with discrete bands. The confidence integrates the modulation index, the harmonic ratio, the cycle-length plausibility, and the alignment with `ClearAirway` events. SpO₂ desaturation coupling, when wearable oximetry data is available, can corroborate but is never required (see Intraday Health Signals & Overlays for what coupling looks like, and how strong it tends to be around CSR cycles).',
        ],
      },
      {
        heading: 'How CPAP Analyzer classifies TECSA',
        paragraphs: [
          'TECSA classification is longitudinal — it operates over many nights, not within a single session. The implementation follows the four-class trajectory model of Liu et al. 2017 (Chest, DOI 10.1016/j.chest.2017.06.010), the largest published study of treatment-emergent central apnea trajectories (≈133,000 patients). A nightly central-apnea index (CAI) is compared across an early treatment window and a late treatment window; the combination of below- vs. above-threshold CAI in each window assigns the user to one of four classes:',
          '• Obstructive (stable): CAI below threshold in both windows — predominantly obstructive breathing throughout, the expected response to CPAP.',
          '• Transient (TECSA, self-limiting): CAI above threshold in the early window, below in the late window — the most common TECSA pattern, consistent with the ~60–80% spontaneous-resolution literature.',
          '• Persistent (central): CAI above threshold in both windows — central physiology present from the start and continuing.',
          '• Emergent: CAI below threshold in the early window, above in the late window — central events appearing late in therapy.',
          'The default CAI threshold is 5/h (the conventional cutoff used by Liu et al. and reflected in the AASM CSA definition), and the default early/late windows are configurable. Nights with high leak are excluded from the classifier because FOT-based central/obstructive classification is degraded under large leak — a corrupted ClearAirway count would otherwise contaminate the trajectory. Each class assignment carries a confidence reflecting the number of usable nights in each window and the separation between the early and late CAI distributions; sparse or short histories yield an explicit "insufficient data" outcome rather than a guess.',
          'All TECSA output is a candidate trajectory label, never a diagnosis, never a prescription. In particular, a Transient or Emergent label does not on its own justify a switch to ASV — see the SERVE-HF caveat above.',
        ],
      },
      {
        heading: 'All thresholds are configurable',
        paragraphs: [
          'Every numeric threshold mentioned above is exposed as a configurable parameter, defaulted to the cited literature value: the cycle-length band (40–120 s, with the 45–90 s "typical" band as a sub-parameter), the minimum consecutive central events for CSR (3), the modulation-index threshold for candidate vs. confirmed, the harmonic-ratio threshold for crescendo-decrescendo morphology, the session-level CSR rate (5/h) and duration (2 h) gates, the TECSA CAI threshold (5/h), the early/late window definitions, and the leak threshold above which a night is excluded from TECSA. Because detection runs on-demand via the analysis layer — not at import time — changing a threshold takes effect immediately, with no re-import required. (This is a deliberate architectural choice; see ADR 0017.)',
        ],
      },
      {
        heading: 'How to read these in the app',
        paragraphs: [
          'In the per-session signal viewer, computed PB and CSR episodes are drawn as overlay bands distinct from device-asserted events: a hatched fill pattern marks computed detections, a confidence chip annotates each band, and dashed boundaries denote candidate / below-threshold episodes. Device-asserted CSR runs use the existing solid event styling. The provenance is never ambiguous — a band that originated from the device cannot be confused with one this app computed, and vice versa. (For an overlay walk-through and what the wearable-overlay context adds — including HR elevation around central events and the characteristic desaturation lag — see Intraday Health Signals & Overlays.)',
          'A dedicated Breathing view collects the longitudinal TECSA trajectory plot (CAI per night with early/late windows shaded), the episode catalog (every detected PB/CSR run with its cycle length, modulation depth, harmonic ratio, confidence, and a deep link that opens its source session in the Signal Viewer with the whole episode framed end to end), and the threshold controls (so a parameter change can be inspected immediately). A Dashboard "Breathing Stability" insight card surfaces the headline state — quiet, isolated candidate episodes, persistent PB, or a TECSA trajectory worth discussing — without ever asserting a diagnosis. A future Trends lane will show cycle-length over time, which is the signal most directly tied to circulation time in the cardiac-output literature.',
          'When using the Event Explorer to slice respiratory events by type, computed PB/CSR candidates carry their own filterable type tag and a hatched marker that distinguishes them from device-flagged PeriodicBreathing — so a query for "all PeriodicBreathing events" can be scoped to device-asserted, to computed candidates, or to both.',
        ],
      },
      {
        heading: 'Pitfalls and limitations',
        paragraphs: [
          'Leak artifact is the most common source of false positives. Large unintentional mask leak corrupts both the flow envelope (because the machine compensates) and the FOT-based central/obstructive classification (because the perturbation signal disperses through the leak path). CPAP Analyzer down-weights high-leak nights in TECSA and lowers the confidence of any PB/CSR episode that overlaps a high-leak segment, but a long leak event can still produce envelope oscillations that look cyclic. Treat any cyclic episode that coincides with a leak excursion with skepticism.',
          'Movement and arousal can mimic short oscillations in the envelope. Cycles shorter than 40 s are deliberately rejected by the cycle-length filter, but borderline events near the lower bound are inherently noisier.',
          'No respiratory-effort belt. PSG distinguishes central from obstructive events with thoracoabdominal effort signals (RIP belts or esophageal manometry); we have only flow plus FOT. This is sufficient for clinically useful PB/CSR detection (the literature cited above all operates from flow alone), but it is a strictly weaker channel than PSG. A clinical sleep study is the standard if the picture here is unclear.',
          'TECSA depends on history. A robust trajectory needs enough usable nights in both the early and late windows; sparse or recent imports will report low-confidence or "insufficient data" rather than guess.',
          'These are candidate flags. CPAP Analyzer is not a medical device, not FDA-cleared, and does not diagnose sleep-disordered breathing or cardiac disease. All output here is informational. Bring concerning findings — particularly new or sustained CSR, or a non-resolving TECSA trajectory — to your sleep physician and cardiologist.',
        ],
      },
      {
        heading: 'References',
        paragraphs: [
          'Berry, R. B. et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. — Scoring rules for periodic breathing and Cheyne-Stokes respiration.',
          'Weinreich, G., Armitstead, J., Töpfer, V., Wang, Y.-M., Wang, Y., & Teschler, H. (2009). Validation of ApneaLink as screening device for Cheyne-Stokes respiration. Sleep, 32(4), 553–557. — Single-channel nasal-airflow CSR detection: airflow alone is sufficient.',
          'Javed, F., Fox, N., & Armitstead, J. (2018). ResCSRF: algorithm to automatically extract Cheyne-Stokes respiration features from respiratory signals. IEEE Transactions on Biomedical Engineering, 65(3), 669–677. DOI: 10.1109/TBME.2017.2712102. — Automated CSR feature extraction from flow.',
          'Midelet, A. et al. (2023). Features of Cheyne-Stokes respiration automatically extracted from CPAP airflow signal raw data: identification of discriminating features to detect heart failure. Biomedical Signal Processing and Control. — Airflow-based CSR feature extraction; longer cycle length tracks reduced cardiac output.',
          'Guyot, P., Djermoune, E.-H., Chenuel, B., & Bastogne, T. (2020). A signal demodulation-based method for the early detection of Cheyne-Stokes respiration. PLoS ONE, 15(3), e0221191. DOI: 10.1371/journal.pone.0221191. — Continuous flow-modulation index as a confidence measure for periodic breathing.',
          'Liu, D., Armitstead, J., Benjafield, A., Shao, S., Malhotra, A., Cistulli, P. A., Pepin, J.-L., & Woehrle, H. (2017). Trajectories of emergent central sleep apnea during continuous positive airway pressure therapy. Chest, 152(4), 751–760. DOI: 10.1016/j.chest.2017.06.010. — Four-class TECSA trajectory model from ~133,000 patients.',
          'Nigam, G., Pathak, C., & Riaz, M. (2016). A systematic review on prevalence and risk factors associated with treatment-emergent central sleep apnea. Annals of Thoracic Medicine, 11(3), 202–210. DOI: 10.4103/1817-1737.185761. — Systematic review of TECSA prevalence and risk factors.',
          'Kwok, K.-L. et al. (2022). Spontaneous resolution of treatment-emergent central sleep apnea. Respirology Case Reports. DOI: 10.1002/rcr2.916. — Self-limiting nature of TECSA on continued CPAP.',
          'Cowie, M. R., Woehrle, H., Wegscheider, K., Angermann, C., d’Ortho, M.-P., Erdmann, E. et al. (2015). Adaptive servo-ventilation for central sleep apnea in systolic heart failure. New England Journal of Medicine, 373(12), 1095–1105. — SERVE-HF trial: increased mortality with ASV in HFrEF.',
          'Somers, V. K., White, D. P., Amin, R. et al. (2008). Sleep apnea and cardiovascular disease: an American Heart Association/American College of Cardiology Foundation Scientific Statement. Circulation, 118(10), 1080–1111. DOI: 10.1161/CIRCULATIONAHA.107.189375. — On the cardiovascular consequences of sleep-disordered breathing.',
        ],
      },
    ],
  },

  // ─── INTRADAY HEALTH SIGNALS & OVERLAYS ───────────────────────────
  {
    slug: 'intraday-overlays',
    title: 'Intraday Health Signals & Overlays',
    summary:
      'How wearable heart-rate, SpO₂, HRV, snoring, and sleep-stage data are aligned with CPAP signals in the per-session signal viewer, and how to read sparse vs. dense lanes.',
    icon: 'integrations',
    sections: [
      {
        heading: 'What the overlays add',
        paragraphs: [
          'The per-session signal viewer can now display wearable health signals on a shared time axis with the CPAP channels (flow, pressure, leak). When a Google Health / Fitbit import is present and intraday data exists for the night, additional lanes appear below the CPAP lanes — heart rate (the hero lane, ~5 s cadence), wearable SpO₂, HRV (5-min cadence, step-rendered), snoring intensity, and a sleep-stage hypnogram (Wake / REM / Light / Deep as a categorical ribbon). All lanes share one time cursor, so a respiratory event in the CPAP flow can be read against simultaneous cardiac, oxygen, and sleep-stage context within the same view.',
          'Wearable lanes load asynchronously after the CPAP signal paints, so they never delay the first paint of flow and pressure. If the imported Google Health export does not include intraday data for that night, or if no Google Health import has been done, the lanes degrade gracefully — they either hide or show a hint linking to the Import Wizard. Daily-summary-only data (e.g., a single resting heart rate per day) is not used for intraday overlay, because it has no within-night structure.',
        ],
      },
      {
        heading: 'How alignment works',
        paragraphs: [
          'CPAP and wearable data are aligned by wall-clock timestamp. The viewer assumes "wall-clock-as-UTC" — that is, every timestamp is treated as if labelled in the same calendar time, and the viewer\'s displayed time zone equals the time zone of the night the data was recorded in. This is the right convention as long as you have not crossed time zones between the CPAP night and the Fitbit night being viewed: the lanes line up to the nearest sample.',
          'If you crossed a time zone (e.g., imported a night recorded abroad), or if the wearable\'s clock and the CPAP machine\'s clock disagreed when the night was recorded, the overlay will be shifted by the disagreement. There is no automatic re-alignment; the assumption is documented here so that an apparent lead/lag between cardiac and respiratory events can be sanity-checked against "was I in a different time zone that night?" before being read as physiology.',
          'Per-sample timestamps within a night are preserved exactly. No resampling is performed on the wearable side; CPAP 25 Hz data is downsampled for display (LTTB) but the underlying time index is unchanged.',
        ],
      },
      {
        heading: 'Sparse vs. dense lanes — how to read them',
        paragraphs: [
          'CPAP flow and pressure are dense: 25 samples per second, continuous across the session. Wearable signals are not: heart rate is roughly one sample every 5 s, HRV is one value every 5 min, and sleep stages are coarse intervals (a few minutes each). The viewer renders these honestly so you can tell at a glance how much signal is actually present.',
          'Dense lanes (heart rate, flow, pressure, leak): rendered as a continuous line.',
          "Sparse lanes (HRV in particular, but also any sparse cadence): rendered as a step function — the line holds the last sample's value until the next sample arrives — with a sample dot at each measurement so it is visually obvious where the actual data points are. Reading the height of the line between dots tells you the held value at that instant; the dots tell you where new evidence arrived.",
          "Dashed connectors imply uncertainty. When two adjacent samples are far apart in time (gap larger than the lane's expected cadence), the segment between them is drawn dashed to signal that the interpolation across the gap is not actual data. A solid line between samples means the gap is within the expected cadence; dashed means a dropout occurred and the held value is not trustworthy across that interval. Sleep stages render as filled categorical blocks; a missing stretch shows as no block, not as Wake.",
        ],
      },
      {
        heading: 'What intraday data can reveal',
        paragraphs: [
          'Around obstructive and central apneas, heart rate often shows a characteristic two-step response: a brief bradycardia during the apnea (vagal response to the breath-hold), followed by a tachycardic rebound on arousal. The magnitude varies with autonomic tone, age, beta-blocker use, and event severity. The overlay makes this readable directly: zoom to a candidate apnea on the flow lane and look at the heart-rate lane underneath.',
          'SpO₂ desaturations from the wearable lag the respiratory event because of circulation time — typically 15–30 s between the start of the apnea and the SpO₂ nadir (see the Desaturation glossary entry). The lag depends on baseline SpO₂, lung volume, and cardiac output, and is informative in its own right: a long lag is consistent with reduced cardiac output. Wearable SpO₂ is generally less precise than dedicated pulse oximetry (motion artifact, perfusion, skin pigmentation effects on optical sensors); treat the wearable SpO₂ lane as corroborative, not as a primary metric. Where they are available, CPAP-paired oximetry signals remain the higher-fidelity source.',
          'HRV (heart-rate variability, typically reported by Fitbit as RMSSD in milliseconds) tends to be depressed during REM with frequent respiratory events. Cycle-to-cycle modulation of HRV around CSR cycles has been described in the heart-failure literature and is sometimes visible at the 5-min cadence Fitbit provides — though the cadence is too coarse to resolve individual cycles. Read HRV as a context lane for autonomic state across the night, not as a beat-to-beat measure.',
          'The sleep-stage hypnogram lets you locate REM-dominant clusters of events: respiratory events typically intensify in REM (loss of accessory-muscle tone, more airway collapsibility). If your event clusters concentrate over the REM bars, that is consistent with REM-dominant disease and is a different therapy conversation than evenly distributed events.',
          'For computed CSR episodes (see Breathing Patterns: Periodic Breathing, Cheyne-Stokes & TECSA), the overlays make the cycle visible across modalities: the flow envelope crescendos and decrescendos, heart rate often modulates in counter-phase, and SpO₂ traces the cyclic desaturations a few seconds late.',
        ],
      },
      {
        heading: 'Requirements and how to import',
        paragraphs: [
          'The overlays require a Google Health / Fitbit import that includes intraday data for the night in question. Daily-only summaries (one heart rate per day, one HRV per day) are not enough — within-night lanes need within-night samples. Not every Fitbit device records every type: older trackers may lack SpO₂, HRV, or skin temperature sensors entirely, and even capable devices may not record on every night.',
          'To get intraday data into the app, follow the Google Takeout export workflow in the Importing Data article (Google Takeout → Google Health → extract → Import Wizard → Google Health source). The Importing Data article lists all supported data types and which are intraday vs. daily.',
        ],
      },
      {
        heading: 'Reading a lane label',
        paragraphs: [
          "Each lane carries a single label that tells you, at a glance, what the lane is and where its data came from. The lane name is drawn in the lane's own line color (so the label and the trace are unmistakably the same signal), the units are shown in muted grey beside it, and a short source tag marks the provenance: CPAP for signals recorded by the CPAP machine (flow, pressure, leak), WEAR for wearable-derived signals (heart rate, wearable SpO₂, HRV, snoring), and SLEEP for the sleep-stage hypnogram. The source tag matters because a wearable lane and a CPAP lane carry different fidelity and alignment assumptions (see How alignment works, above).",
        ],
      },
      {
        heading: 'Lane controls — collapse, reorder, hide',
        paragraphs: [
          'Each lane has three direct controls. To collapse a lane to a compact height (or expand it again), click its name; collapsing keeps the lane in the stack but reclaims vertical space so you can keep more lanes visible at once. To reorder a lane, drag its handle (the grip to the left of the label) up or down; lanes are also reorderable from the keyboard alone. To remove a lane from the view, use the hide (✕) button that appears next to the drag handle when you hover the lane or move keyboard focus to it — hidden lanes can be brought back from the Lanes drawer.',
          'The legend bar at the top of the viewer stays pinned in place as you scroll and shows the DEVICE EVENTS and DETECTIONS legends (the colored swatches that explain the event and candidate-pattern overlays). It does not contain a per-signal visibility toggle; signal visibility is managed entirely through the per-lane hide button and the Lanes drawer.',
        ],
      },
      {
        heading: 'The Lanes drawer, presets, and keyboard cursor',
        paragraphs: [
          'The set of visible lanes, their order, and their collapsed/expanded state are controlled from a Lanes drawer, accessible from the viewer toolbar or by pressing L. Lanes can be reordered (drag, or keyboard) and individually shown or hidden. The state persists per session, so reopening the same night restores your last layout.',
          'Presets group the lanes for common reading tasks: Respiratory focus (flow + pressure + leak + snoring), Cardio focus (flow + heart rate + HRV), Sleep architecture (flow + hypnogram + heart rate + SpO₂), and Everything (all available lanes). Picking a preset is non-destructive — you can fine-tune from there.',
          'A keyboard data cursor (arrow keys) walks through the session sample-by-sample and announces a synchronized multi-lane readout at the cursor — value, units, and time — for every visible lane. This gives screen-reader and keyboard-only users equivalent access to what the visual cursor shows on hover. Lanes are also reorderable from the keyboard alone.',
        ],
      },
      {
        heading: 'Privacy',
        paragraphs: [
          'All wearable data is read from the local Google Health export and stored in the same local IndexedDB / OPFS used for CPAP data. No data is uploaded for parsing or display. The signal viewer composes everything in-browser. Removing the integration (Settings → Integrations) removes the stored wearable data; deleting all data removes both sources.',
        ],
      },
    ],
  },

  // ─── EVENT EXPLORER ───────────────────────────────────────────────
  {
    slug: 'event-explorer',
    title: 'Event Explorer',
    summary:
      'How to query, slice, visualize, and export respiratory events with the Event Explorer — filters, null-field semantics, lenses, URL-serialized and saved queries, and CSV/JSON export.',
    icon: 'events',
    sections: [
      {
        heading: 'What the Event Explorer is',
        paragraphs: [
          'The Event Explorer (Explore → Event Explorer, route `/explore/events`) is an ad-hoc query tool for respiratory events across your imported nights. Rather than a fixed dashboard, it pairs a query builder with a swappable set of visualization lenses, all driven by the same matched set. The intent is to let you ask specific questions — "all hypopneas longer than 30 s above pressure 12 in the first two hours of the night, last 90 days" — and see them as a distribution, a scatter, a per-type comparison, or a cluster map without rebuilding the filter each time.',
        ],
      },
      {
        heading: 'Filters and how they combine',
        paragraphs: [
          'Filters in the left-rail query builder are combined with logical AND: every active filter must be satisfied for an event to be included in the matched set. The available filters are event type (one or more types from a chip selector — including obstructive apnea, central apnea, hypopnea, mixed apnea, RERA, snoring, flow limitation, and the sustained "detection" patterns like PeriodicBreathing, which carries a distinct hatched marker to distinguish device-asserted from computed candidates), duration (range), pressure at the event (range), leak at the event (range), SpO₂ at the event (range), time-of-night window (local clock-time range that may wrap past midnight, e.g. 22:00–06:00), and date range within the loaded set.',
          'Filters that are inactive — meaning the user has not constrained that field — let every event through on that field. The matched-count "trust strip" above the lenses ("N of M events match K filters") updates live as you adjust filters and is announced to screen readers via aria-live; the proportion bar gives an at-a-glance sense of how restrictive the query is.',
          'Range filters bound by a numeric slider always come with paired min/max numeric inputs, so a precise value can be typed (e.g. duration ≥ 10.0 s) without dragging. A range filter disables itself with an explanatory chip when the underlying field has no data in the currently matched set — for example, SpO₂ filters disable when no oximetry-bearing events match the other filters.',
        ],
      },
      {
        heading: 'Null-field semantics (important)',
        paragraphs: [
          'CPAP events do not all carry every field. An apnea recorded without paired oximetry has no SpO₂ value attached to it; a flow-limitation event may not have an associated discrete pressure reading; older imports may lack some fields entirely. The Event Explorer applies an explicit convention so these missing fields behave predictably.',
          'A bounded range on a field excludes events that are missing that field. If you set "SpO₂ between 88 and 92," only events with a recorded SpO₂ in that band are included; events with no SpO₂ value are excluded — they cannot be evaluated against the constraint, and including them would be silently fabricating data.',
          'An unbounded range on a field passes nulls through. If you leave SpO₂ unset (no min, no max), every event passes the SpO₂ filter regardless of whether SpO₂ was recorded — so the matched set is not silently narrowed by a constraint you never imposed.',
          'In practice this means: if you want "events on nights where SpO₂ is recorded, restricted to the 88–92 range," set the bounded range. If you want "all events, irrespective of oximetry," leave the field unbounded. The matched-count strip will reflect the effect of each choice immediately.',
        ],
      },
      {
        heading: 'Lenses (the visualization views)',
        paragraphs: [
          'All lenses operate on the same matched set; switching lenses does not change the query. A summary-stats strip above the lens area shows the matched event count, the per-type breakdown, and basic descriptive stats; the lens itself answers a more specific question.',
          'Duration histogram. A configurable-bin-width histogram of event durations, with an optional split-by-type stacking so the contributions of different event types stack into each bar. Bin width is set in the lens toolbar. An overflow bin is provided at the right edge so long-tail outliers (a 5-minute leak-induced event) do not force the rest of the histogram to compress into the first few bars — those events land in the overflow bin instead of being clipped.',
          'Scatter. Duration on the x-axis against a configurable y-axis: pressure, leak, SpO₂, or time-of-night. Points are colored by event type. For matched sets larger than 5,000 points, uniform-stride decimation is applied (every k-th point) so the scatter remains interactive and readable; the stride is chosen to keep approximately 5,000 points on screen, and the lens annotates that decimation is in effect so a partial view is never confused with the full set.',
          'Per-type box / violin. Small-multiples of duration distributions, one per event type, rendered as a box plot with violin overlay so both the quartiles and the full distribution shape are visible. This is the right lens for "how does the central-apnea duration distribution compare to the obstructive-apnea distribution in this set?"',
          'Inter-event intervals. The distribution of time gaps between consecutive events in the matched set. A long-tailed distribution indicates isolated events; a peaked distribution at short intervals indicates clustering. Useful in combination with a time-of-night filter for asking "do my apneas cluster in the first two hours?"',
          'Clusters. A density / cluster view based on the FLG-bridged clustering primitive (selectable as strict, balanced, or lenient) that groups events occurring close together in time into clusters. Strict mode requires tighter temporal proximity; lenient mode joins farther-apart events into the same cluster. The view shows cluster sizes, durations, and locations within the night.',
        ],
      },
      {
        heading: 'URL-serialized and saved queries',
        paragraphs: [
          'The entire filter state — every active filter, the chosen lens, lens-specific settings (bin width, scatter axis, cluster mode) — is serialized into the URL. This means a query is bookmarkable, back/forward-able, and shareable: opening a URL restores the exact view the URL encodes. (No data is shared by a URL; only the query parameters.) The browser history works the way you would expect.',
          'Saved queries persist to local storage. Give a query a name and it is added to your saved-query list; selecting it restores the filters and lens in one click. Four examples ship by default to demonstrate the pattern. Saved queries live entirely in the browser — there is no account, nothing is synced.',
        ],
      },
      {
        heading: 'The event table and Signal-Viewer deep-links',
        paragraphs: [
          'Below the lens, a virtualized event table lists the events in the matched set (windowed for large sets, with a "showing N of M" note so the truncation is transparent), sortable by every column. Clicking any row deep-links into the Signal Viewer for that event\'s session and frames the entire event: the viewer opens with the event spanning roughly 90% of the visible width and comfortable margins on either side, so a multi-minute event is shown end to end rather than running off the edge. Very short or point-in-time events are given a sensible minimum window (about 30 seconds) so there is always context around them. Targets outside the session\'s recording are ignored, and the framing is applied once — subsequent panning and zooming preserve your interaction.',
          'This whole-event framing is the right default for sustained patterns such as periodic breathing and Cheyne-Stokes respiration, which can run for several minutes: framing the whole span keeps the crescendo–decrescendo morphology visible at once instead of pushing the back half off the right edge. For computed PeriodicBreathing / CSR candidates (see Breathing Patterns: Periodic Breathing, Cheyne-Stokes & TECSA), the deep link lands on the cyclic episode in question, framed in full, with the wearable overlays available alongside (see Intraday Health Signals & Overlays). For backward compatibility, an older link that encodes only a single timestamp (`?t=<epochMs>`) still opens a centered ±1-minute window on that timestamp.',
        ],
      },
      {
        heading: 'Export',
        paragraphs: [
          'The matched set can be exported to CSV (one row per event, with all available fields) or JSON (the same event objects the app uses, useful for downstream analysis in R, Python, or pandas). Export happens entirely in-browser using the matched set already in memory — no data is uploaded to any server.',
          'Very large exports show a warning before generating the file because writing tens or hundreds of thousands of rows can take noticeable time and produce a large download. The warning includes the row count so you can decide whether to narrow the query first.',
        ],
      },
      {
        heading: 'Privacy and limits',
        paragraphs: [
          'The Event Explorer operates entirely on data already loaded into the app from your local storage. No queries, filters, or exports leave your browser. Saved queries are stored locally. URLs encode the query parameters but not the data itself; sharing a URL does not share your events.',
          'The Explorer queries device-scored and app-computed events; it does not re-detect anything from raw signal. For methods and confidence on computed breathing detections, see Breathing Patterns: Periodic Breathing, Cheyne-Stokes & TECSA.',
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
          "Strength classification: A plain-language label (negligible, weak, moderate, strong, very strong) based on the absolute value of the coefficient, using CPAP Analyzer's convenience bands: $|r| < 0.1$ negligible, $0.1$–$0.3$ weak, $0.3$–$0.5$ moderate, $0.5$–$0.7$ strong, $> 0.7$ very strong. These bands are a rule of thumb, not a standard — the cutoffs are inherently arbitrary (Schober et al. 2018), and other conventions differ (Cohen's 1988 benchmarks for $r$ are $0.1$/$0.3$/$0.5$ for small/medium/large). Read the coefficient and its confidence interval, not just the label.",
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
          'Spearman rank correlation ($\\rho$) measures the monotonic relationship between two variables (whether one tends to increase as the other increases, not necessarily linearly). It operates on ranks rather than raw values, making it robust to outliers and applicable to non-normal data. The Correlation Explorer lets you toggle between Pearson and Spearman, so when a normality check is borderline or either variable is visibly skewed you can switch to Spearman directly.',
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
      {
        heading: 'References',
        paragraphs: [
          'Pearson, K. (1895). Note on regression and inheritance in the case of two parents. Proceedings of the Royal Society of London, 58, 240–242. DOI: 10.1098/rspl.1895.0041. — Pearson product-moment correlation.',
          'Spearman, C. (1904). The proof and measurement of association between two things. American Journal of Psychology, 15(1), 72–101. DOI: 10.2307/1412159. — Spearman rank correlation.',
          'Fisher, R. A. (1915). Frequency distribution of the values of the correlation coefficient in samples from an indefinitely large population. Biometrika, 10(4), 507–521. DOI: 10.2307/2331838. — The z-transformation used for correlation confidence intervals.',
          'Bland, J. M., & Altman, D. G. (1986). Statistical methods for assessing agreement between two methods of clinical measurement. The Lancet, 327(8476), 307–310. DOI: 10.1016/S0140-6736(86)90837-8. — Limits of agreement (mean ± 1.96 SD of the differences).',
          'Bland, J. M., & Altman, D. G. (1999). Measuring agreement in method comparison studies. Statistical Methods in Medical Research, 8(2), 135–160. DOI: 10.1177/096228029900800204. — Proportional-bias assessment.',
          'Schober, P., Boer, C., & Schwarte, L. A. (2018). Correlation coefficients: appropriate use and interpretation. Anesthesia & Analgesia, 126(5), 1763–1768. DOI: 10.1213/ANE.0000000000002864. — Notes that correlation-strength cutoffs are inherently arbitrary.',
          'Cohen, J. (1988). Statistical Power Analysis for the Behavioral Sciences (2nd ed.). Hillsdale, NJ: Lawrence Erlbaum. — Effect-size benchmarks (r: 0.1/0.3/0.5 for small/medium/large).',
          'Benjamini, Y., & Hochberg, Y. (1995). Controlling the false discovery rate: a practical and powerful approach to multiple testing. Journal of the Royal Statistical Society, Series B, 57(1), 289–300. — Context for the multiple-comparisons caveat.',
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
