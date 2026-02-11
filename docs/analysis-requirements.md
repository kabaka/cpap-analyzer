# Analysis & Visualization Requirements

This document specifies every metric, statistical analysis method, visualization, and clinical reference that the CPAP Analyzer must implement. It serves as the authoritative requirements list for the Data Science, Data Visualization, and ResMed Specialist agents.

The baseline is full parity with the [OSCAR Export Analyzer](https://github.com/kabaka/oscar-export-analyzer), with significant extensions for direct-from-machine analysis, real-time signal viewing, and additional correlation domains.

## 1. Input Metrics

### 1.1 CPAP Session Summary Metrics (Per Night)

| Metric                      | Unit         | Source           | Description                                  |
| --------------------------- | ------------ | ---------------- | -------------------------------------------- |
| Date                        | `YYYY-MM-DD` | Session metadata | Night of therapy                             |
| Total Usage Time            | hours        | Session metadata | Duration of CPAP usage                       |
| AHI (total)                 | events/hour  | Computed         | Apnea-Hypopnea Index                         |
| Obstructive AHI             | events/hour  | Event channel    | Obstructive apnea component                  |
| Central AHI                 | events/hour  | Event channel    | Central apnea component                      |
| Hypopnea AHI                | events/hour  | Event channel    | Hypopnea component                           |
| Leak Rate (median)          | L/min        | Signal channel   | Median unintentional mask leak               |
| Leak Rate (95th percentile) | L/min        | Signal channel   | Near-peak leak                               |
| Mean Pressure               | cmH₂O        | Signal channel   | Average delivered pressure                   |
| Max Pressure                | cmH₂O        | Signal channel   | Maximum delivered pressure                   |
| Median EPAP                 | cmH₂O        | Signal channel   | Expiratory Positive Airway Pressure          |
| Median IPAP                 | cmH₂O        | Signal channel   | Inspiratory Positive Airway Pressure (BiPAP) |
| Pressure Support            | cmH₂O        | Computed         | IPAP − EPAP (BiPAP only)                     |
| Tidal Volume (mean)         | mL           | Signal channel   | Average breath volume                        |
| Minute Ventilation (mean)   | L/min        | Signal channel   | Average ventilation                          |
| Respiratory Rate (mean)     | breaths/min  | Signal channel   | Average respiratory rate                     |
| Notes                       | text         | User input       | User annotations for the session             |

### 1.2 Event-Level Data (Per Event)

| Field               | Type         | Description                                                                                               |
| ------------------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| Type                | enum         | `Obstructive`, `Central`, `Mixed`, `Hypopnea`, `RERA`, `FlowLimitation`, `LargeLeak`, `PeriodicBreathing` |
| Timestamp           | ISO datetime | Event start time                                                                                          |
| Duration            | seconds      | Event duration (≥ 10s for apnea per AASM)                                                                 |
| Severity            | float 0–1    | Flow limitation severity level (for FLG events)                                                           |
| Associated Pressure | cmH₂O        | Pressure at time of event                                                                                 |
| Associated EPAP     | cmH₂O        | EPAP at time of event                                                                                     |

### 1.3 High-Resolution Signal Data (25–50 Hz)

| Channel            | Sample Rate          | Unit        | Description                     |
| ------------------ | -------------------- | ----------- | ------------------------------- |
| Flow Rate          | 25 Hz                | L/min       | Airflow through the mask        |
| Mask Pressure      | 25 Hz                | cmH₂O       | Pressure at the mask            |
| Leak Rate          | 2 Hz                 | L/min       | Unintentional mask leak         |
| Tidal Volume       | ~0.1 Hz (per breath) | mL          | Inspired volume per breath      |
| Minute Ventilation | ~0.1 Hz              | L/min       | Ventilation rate                |
| Respiratory Rate   | ~0.1 Hz              | breaths/min | Breathing frequency             |
| SpO2               | 1 Hz                 | %           | Oximetry (if oximeter attached) |

### 1.4 Optional Integration Data

#### Fitbit

| Metric           | Resolution         | Source                                            |
| ---------------- | ------------------ | ------------------------------------------------- |
| Heart Rate       | 1-minute intervals | Intraday HR API                                   |
| Resting HR       | nightly            | Daily summary                                     |
| HRV (RMSSD)      | nightly            | Estimated from minute-level HR or native API      |
| SpO2             | 5-minute intervals | Intraday SpO2 API                                 |
| Sleep Stages     | per-stage          | Sleep Stages API (deep, light, REM, wake minutes) |
| Sleep Efficiency | nightly            | Computed from stages                              |

#### Environmental (Future)

| Metric                  | Resolution | Source          |
| ----------------------- | ---------- | --------------- |
| Temperature             | hourly     | Weather API     |
| Humidity                | hourly     | Weather API     |
| Barometric Pressure     | hourly     | Weather API     |
| AQI (Air Quality Index) | hourly     | Air quality API |
| Pollen Count            | daily      | Pollen API      |

## 2. Derived Metrics

| Metric                      | Formula / Method                                   | Description                                            |
| --------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| Rolling Mean (7d, 30d)      | $\bar{x}_k(t) = \frac{1}{k}\sum_{i=t-k+1}^{t} x_i$ | Smoothed trend for any metric                          |
| Rolling Median (7d, 30d)    | Order-statistic with binomial CI                   | Robust trend less sensitive to outliers                |
| 95% CI (mean)               | $\bar{x} \pm 1.96 \cdot \frac{s}{\sqrt{k}}$        | Confidence band for rolling mean                       |
| 95% CI (median)             | Binomial order-statistic method                    | Confidence band for rolling median                     |
| Compliance Rate             | % nights ≥ 4 hours                                 | CMS insurance compliance metric                        |
| Strict Compliance Rate      | % nights ≥ 6 hours                                 | Stricter therapeutic target                            |
| Adherence Streak            | Consecutive compliant nights                       | Current and longest streaks                            |
| AHI Severity Band           | Categorical from AHI value                         | Normal / Mild / Moderate / Severe                      |
| Central Apnea Fraction      | Central events ÷ total events                      | Flags central-dominant apnea (> 60%)                   |
| Cluster Density             | Events per minute within cluster                   | Measures tightness of event grouping                   |
| Weighted Density            | Seconds of apnea per minute                        | "Hypoxic burden" approximation                         |
| Cluster Severity Score      | Duration × density × edge extension                | Composite cluster risk metric                          |
| False Negative Score        | FLG threshold scanning                             | Detects likely unreported respiratory events           |
| Therapy Effectiveness Score | Composite (0–100)                                  | AHI control + physiology + sleep quality + oxygenation |
| Linear Trend                | Pearson correlation of index vs. values            | Direction and strength of metric change over time      |

## 3. Statistical Analysis Methods

### 3.1 Descriptive Statistics

- **Mean, Median, Standard Deviation, Variance**: Applied to all numeric metrics.
- **Percentiles**: 25th (Q1), 50th (median), 75th (Q3), 90th, 95th via Type 7 linear interpolation.
- **IQR and Outlier Detection**: Tukey's hinges with 1.5×IQR fences. Outliers flagged but not removed by default.
- **Freedman-Diaconis Histogram Binning**: Optimal bin width $h = 2 \cdot IQR \cdot n^{-1/3}$ for distribution visualization.

### 3.2 Time-Series Analysis

- **Rolling Mean and Median with 95% CI**: Windows of 7 and 30 observations. CI for mean via normal approximation; CI for median via binomial order-statistic method. Both handle gaps in data (missing nights).

- **STL Decomposition**: Seasonal-Trend decomposition using LOESS (or moving-average approximation). Extracts trend, seasonal (7-day weekly cycle), and residual components. Reveals patterns hidden in the raw data.

- **Autocorrelation Function (ACF)**: Measures correlation of a time series with its own lagged values, up to lag 30. Uses pairwise deletion for gaps. Identifies cyclical patterns.

- **Partial Autocorrelation Function (PACF)**: Measures direct correlation at each lag after removing the effect of shorter lags. Computed via Durbin-Levinson recursion. Critical for understanding the memory structure of the time series.

- **Change-Point Detection (PELT)**: Pruned Exact Linear Time algorithm with least-squares cost function. Identifies structural breaks in the time series — points where the statistical properties change significantly (e.g., pressure adjustment, mask change, weight change). Penalty parameter configurable (default: 10).

- **Breakpoint Detection**: Simpler breakpoint detection via 7-day vs. 30-day rolling average crossover. Marks points where short-term trend diverges from long-term trend.

- **LOESS Smoothing**: Local weighted polynomial regression with tricube kernel. Default span 0.5, evaluated at 60 evenly-spaced points across the time range. Provides a smooth trend line without assuming linearity.

- **Running Quantile Bands**: 50th and 90th percentile tracks over a sliding window. Visualizes the distribution envelope over time.

### 3.3 Correlation and Regression

- **Pearson Correlation (r)**: Measures linear relationship between two variables. Reports coefficient and p-value. Suitable for normally-distributed continuous variables.

- **Spearman Rank Correlation (ρ)**: Measures monotonic relationship. Computed via rank transformation plus Pearson correlation of ranks. T-test significance. More robust to outliers and non-normality than Pearson.

- **Partial Correlation**: Measures the relationship between two variables while controlling for the effect of one or more confounders. Computed via matrix inversion of the correlation matrix or OLS residuals. Essential for disentangling correlated variables (e.g., AHI and leak rate may both correlate with pressure, but are they correlated with each other independent of pressure?).

- **Cross-Correlation with Lag Analysis**: Pearson correlation computed at each lag from -maxLag to +maxLag. Identifies time-delayed relationships (e.g., does a change in pressure today affect AHI tomorrow?). 95% white-noise significance threshold at $1.96/\sqrt{n}$.

- **Granger Causality Test**: VAR (Vector Autoregression) framework with F-test comparing restricted vs. unrestricted models. AIC-based optimal lag selection. Tests whether one time series helps predict another beyond the other's own past values. Useful for establishing temporal precedence in therapy adjustments.

### 3.4 Hypothesis Testing

- **Mann-Whitney U Test**: Non-parametric comparison of two independent samples. Exact computation via dynamic programming for n ≤ 28; normal approximation with tie correction for larger samples. Reports U statistic, p-value, and rank-biserial effect size with Wilson confidence interval. Used for comparing metrics between date ranges, pressure settings, mask types, etc.

- **Cohen's d Effect Sizes**: Quantifies the practical significance of differences. Thresholds: negligible (< 0.1), small (0.1–0.3), medium (0.3–0.5), large (> 0.5). Applied to all comparison analyses alongside p-values.

### 3.5 Survival Analysis

- **Kaplan-Meier Survival Curves**: Estimates the probability of an event (e.g., usage reaching 4 hours, apnea event lasting beyond t seconds) over time. Greenwood formula for variance with log-log confidence intervals. Handles censored observations (e.g., nights where the user removed the mask before 4 hours). Used for both usage compliance analysis and apnea event duration analysis.

### 3.6 Distribution Analysis

- **QQ Plots**: Quantile-quantile plots comparing observed distribution to theoretical normal distribution. Normal quantiles via Beasley-Springer/Moro inverse CDF approximation. Deviations from the diagonal indicate non-normality, helping select appropriate statistical methods.

- **Histograms**: Freedman-Diaconis binning with optional threshold markers (e.g., compliance threshold at 4 hours, AHI severity bands).

- **Box Plots and Violin Plots**: Combined visualization showing quartiles, outliers (box plot), and distribution shape (violin).

### 3.7 Clustering Algorithms

Three complementary approaches for identifying clusters of respiratory events:

| Algorithm                     | Parameters                         | Strengths                                                                                                                             | Use Case                                                                             |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **FLG-Bridged**               | `EDGE_ENTER=0.5`, `EDGE_EXIT=0.35` | Uses flow limitation context to bridge temporal gaps between events. Hysteresis (Schmitt Trigger) prevents oscillation at thresholds. | Default algorithm. Best for ResMed data where flow limitation signals are available. |
| **K-Means++**                 | k (number of clusters)             | Arthur & Vassilvitskii 2007 initialization for robust centroid placement.                                                             | When the expected number of clusters is known or can be estimated.                   |
| **Single-Link Agglomerative** | Gap threshold                      | Hierarchical clustering that auto-determines cluster count based on temporal proximity.                                               | When cluster count is unknown and simple temporal grouping suffices.                 |

All clustering feeds into:

- `summarizeClusterEvents()` → density, weighted density ("Choke Factor" / hypoxic burden proxy)
- `computeClusterSeverity()` → composite severity heuristic
- Per-cluster detail: start time, end time, duration, event count, event types, FLG levels, pressure range, EPAP range

### 3.8 False-Negative Detection

Scans for sustained periods of high flow limitation (FLG) without corresponding apnea/hypopnea labels. These likely represent respiratory events the machine did not score.

Three detection presets:

| Preset       | FLG Threshold | Min Duration | Gap Tolerance | Description                                                |
| ------------ | ------------- | ------------ | ------------- | ---------------------------------------------------------- |
| **Strict**   | ≥ 0.3         | 15 seconds   | 5 seconds     | Conservative; fewer false positives                        |
| **Balanced** | ≥ 0.2         | 10 seconds   | 10 seconds    | Default; balance of sensitivity and specificity            |
| **Lenient**  | ≥ 0.15        | 8 seconds    | 15 seconds    | Aggressive; more detections but higher false positive rate |

Reports: timestamps, peak FLG, duration, likelihood score.

### 3.9 Fitbit Correlation Engine (Integration Plugin)

When Fitbit data is available, the following clinical correlation pairs are analyzed:

| CPAP Metric | Fitbit Metric    | Expected Direction | Clinical Rationale                                     |
| ----------- | ---------------- | ------------------ | ------------------------------------------------------ |
| AHI         | HRV (RMSSD)      | Negative           | Higher AHI → lower HRV (autonomic stress)              |
| AHI         | SpO2             | Negative           | Higher AHI → lower oxygenation                         |
| AHI         | Sleep Efficiency | Negative           | Higher AHI → more disrupted sleep                      |
| AHI         | Resting HR       | Positive           | Higher AHI → higher resting HR (cardiovascular stress) |
| Usage       | HRV              | Positive           | Better compliance → improved autonomic function        |
| Usage       | Sleep Efficiency | Positive           | Better compliance → better sleep quality               |
| Usage       | Resting HR       | Negative           | Better compliance → lower resting HR                   |
| EPAP        | SpO2             | Positive           | Appropriate pressure → better oxygenation              |
| Leak        | HRV              | Negative           | High leak → therapy disruption → lower HRV             |
| Leak        | Sleep Efficiency | Negative           | High leak → disrupted sleep                            |
| Leak        | Resting HR       | Positive           | High leak → stress → higher HR                         |

Each pair is analyzed with:

- Pearson and Spearman correlation
- Effect size classification
- Cross-correlation lag analysis (does AHI change predict HRV change the next day?)
- Granger causality testing
- Automated clinical interpretation and recommendations

## 4. Visualization Catalog

### 4.1 Dashboard Components

| Visualization             | Type         | Description                                                     |
| ------------------------- | ------------ | --------------------------------------------------------------- |
| KPI Cards with Sparklines | Card + line  | Last-30-night mini trends for AHI, usage, EPAP, compliance      |
| Compliance Summary        | Metric cards | Current compliance rate, streak, Medicare-qualifying percentage |

### 4.2 Usage Analysis

| Visualization             | Type                              | Interactions                                        |
| ------------------------- | --------------------------------- | --------------------------------------------------- |
| Nightly Usage Time Series | Line + scatter                    | Zoom, pan, brush selection, rolling average toggle  |
| Usage Change Points       | Annotated line                    | Click change point for details                      |
| Usage STL Decomposition   | 3-panel (trend/seasonal/residual) | Synchronized zoom across panels                     |
| Usage Histogram           | Histogram                         | Hover for bin counts, compliance threshold marker   |
| Usage Box Plot & Violin   | Combined                          | Outlier identification on hover                     |
| Calendar Heatmap          | Color grid                        | Click day for detail, legend for color scale        |
| ACF/PACF                  | Dual bar                          | Lag hover for exact values, 95% significance bounds |
| Kaplan-Meier (Usage)      | Step function                     | CI band toggle, censoring markers                   |

### 4.3 AHI Analysis

| Visualization         | Type         | Interactions                                      |
| --------------------- | ------------ | ------------------------------------------------- |
| AHI Time Series       | Stacked line | Component toggle (O/C/H), rolling average overlay |
| AHI STL Decomposition | 3-panel      | Synchronized zoom                                 |
| AHI Histogram         | Histogram    | Severity band markers                             |
| AHI Violin + QQ Plot  | Combined     | Normality assessment annotation                   |
| AHI Severity Table    | Table        | Sortable, night count per band                    |
| AHI ACF/PACF          | Dual bar     | Lag hover, significance bounds                    |

### 4.4 Pressure & EPAP Analysis

| Visualization                    | Type                              | Interactions                                                 |
| -------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| EPAP Trend (First 30 vs Last 30) | Dual scatter                      | Period labels, mean lines                                    |
| EPAP × AHI Scatter + LOESS       | Scatter + smooth + quantile bands | Hover for data points, band toggle                           |
| Correlation Matrix               | Heatmap                           | Click cell for scatter plot, toggle Pearson/Spearman         |
| Titration Helper                 | Table + bar                       | Mann-Whitney U p-values, effect sizes, EPAP range comparison |

### 4.5 Range Comparisons

| Visualization   | Type       | Interactions                                          |
| --------------- | ---------- | ----------------------------------------------------- |
| Waterfall Chart | Delta bars | Metric labels, color-coded improvement/regression     |
| Delta Tables    | Table      | P-values, effect sizes, CIs, sortable by significance |

### 4.6 Apnea Event Analysis

| Visualization          | Type               | Interactions                         |
| ---------------------- | ------------------ | ------------------------------------ |
| Duration Histograms    | Histogram per type | Type filter, overlay vs. separate    |
| Event Kaplan-Meier     | Step function      | Per-type survival, threshold markers |
| Per-Night Event Counts | Stacked bar        | Type toggle, hover for counts        |

### 4.7 Apnea Clusters

| Visualization    | Type                  | Interactions                                   |
| ---------------- | --------------------- | ---------------------------------------------- |
| Cluster Table    | Sortable table        | Severity score, density, events, FLG, pressure |
| Cluster Timeline | Expandable row detail | Minute-by-minute event markers, FLG trace      |

### 4.8 False Negatives

| Visualization               | Type    | Interactions                                |
| --------------------------- | ------- | ------------------------------------------- |
| Max FLG vs Duration Scatter | Scatter | Hover for event details, preset selector    |
| Detection Table             | Table   | Sortable by likelihood, duration, FLG level |

### 4.9 Raw Data Explorer

| Visualization           | Type  | Interactions                                        |
| ----------------------- | ----- | --------------------------------------------------- |
| Virtualized Spreadsheet | Table | Sort, filter, search, column reorder, CSV re-export |

### 4.10 Signal Viewer (New — Not in OSCAR Export Analyzer)

| Visualization                | Type               | Interactions                                  |
| ---------------------------- | ------------------ | --------------------------------------------- |
| Multi-Channel Signal Display | Canvas time-series | Synchronized zoom/pan across channels         |
| Event Overlay                | Annotation layer   | Event markers on signals, click for details   |
| Breath-by-Breath View        | Signal detail      | Individual breath identification, measurement |

### 4.11 Fitbit Correlation Dashboard (Integration Plugin)

| Visualization      | Type                 | Interactions                                    |
| ------------------ | -------------------- | ----------------------------------------------- |
| Correlation Matrix | Heatmap              | 11 pairs, click for scatter                     |
| AHI vs Resting HR  | Scatter + regression | Significance annotation                         |
| EPAP vs SpO2       | Scatter + regression | Pressure-oxygenation relationship               |
| Leak vs HR         | Scatter + regression | Therapy disruption impact                       |
| Night Detail View  | Multi-panel          | Minute-level HR sparkline, dual-axis sync chart |

## 5. Extensions Beyond OSCAR Export Analyzer

These features extend significantly beyond the baseline capabilities:

### 5.1 Full-Resolution Signal Viewing

The most significant new capability. Direct access to 25–50 Hz waveforms enables analysis impossible with CSV summary data: breath morphology, inspiratory flow limitation patterns, pressure response dynamics, and real-time event context.

### 5.2 Spectral Analysis

Frequency-domain analysis of flow and pressure signals to identify periodic breathing patterns, respiratory rate variability, and sleep-stage-correlated breathing changes.

### 5.3 Machine Learning Pattern Recognition

Unsupervised clustering of night "profiles" (similar nights grouped together), anomaly detection (unusual nights), and pattern-based event prediction. Must be transparent — no black-box outputs.

### 5.4 Multi-Year Seasonal Decomposition

STL with longer seasonal periods (monthly, quarterly, annually) to identify long-term cyclical patterns (seasonal allergies, winter heating effects, etc.).

### 5.5 SpO2 from CPAP Oximeter

OSCAR Export Analyzer only gets SpO2 from Fitbit. Direct import from ResMed-compatible pulse oximeters attached to the CPAP machine provides higher-quality, concurrent oxygenation data.

### 5.6 Multi-Machine Support

Support data from multiple machines (e.g., user upgrades from AirSense 10 to 11, or uses different machines at home vs. travel). Unified timeline with machine transitions marked.

### 5.7 Environmental Correlation

Correlate therapy metrics with local weather (temperature, humidity, barometric pressure), air quality (AQI, PM2.5), and allergen data (pollen counts). Some patients report significant seasonal or weather-dependent variation.

### 5.8 Medication Tracking

Allow users to log medication changes (e.g., starting/stopping medications that affect sleep or breathing) and correlate with therapy metrics. Change-point analysis can detect whether a medication change affected therapy.

### 5.9 Sleep Position Correlation

Some ResMed machines and accessories record sleep position. If available, correlate positional data with AHI and event distribution.

## 6. Clinical Reference Constants

All configurable thresholds with their clinical source:

| Constant                    | Value             | Source                  | Notes                             |
| --------------------------- | ----------------- | ----------------------- | --------------------------------- |
| Apnea minimum duration      | 10 seconds        | AASM                    | Standard diagnostic criterion     |
| Prolonged apnea threshold   | 30 seconds        | Clinical convention     | Events ≥ 30s flagged as prolonged |
| Usage compliance threshold  | 4 hours           | CMS (Medicare)          | Insurance compliance standard     |
| Strict usage threshold      | 6 hours           | Clinical recommendation | Therapeutic benefit target        |
| AHI Normal                  | < 5 events/hour   | AASM                    | No significant sleep apnea        |
| AHI Mild                    | 5–15 events/hour  | AASM                    | Mild sleep apnea                  |
| AHI Moderate                | 15–30 events/hour | AASM                    | Moderate sleep apnea              |
| AHI Severe                  | > 30 events/hour  | AASM                    | Severe sleep apnea                |
| Central-dominant fraction   | > 60%             | Clinical convention     | Flags central sleep apnea         |
| EPAP valid range            | 4–25 cmH₂O        | Machine specifications  | Reject values outside this range  |
| Minimum cluster events      | 3                 | Configurable            | Minimum events to form a cluster  |
| IQR outlier multiplier      | 1.5               | Tukey                   | Standard outlier fence            |
| Change-point penalty        | 10                | Configurable            | PELT algorithm penalty parameter  |
| STL season length           | 7                 | Weekly cycle            | Default seasonal period           |
| Max ACF/PACF lag            | 30                | Configurable            | Maximum lag for autocorrelation   |
| LOESS span                  | 0.5               | Configurable            | Smoothing bandwidth               |
| LOESS evaluation points     | 60                | Configurable            | Number of fitted points           |
| FLG cluster entry threshold | 0.5               | Configurable            | Hysteresis upper trigger          |
| FLG cluster exit threshold  | 0.35              | Configurable            | Hysteresis lower trigger          |
| Normal CI z-score           | 1.96              | Standard                | 95% confidence interval           |

## 7. Interactivity Requirements

All visualizations must support a baseline set of interactions:

### Standard Chart Interactions

- **Zoom**: Mouse wheel, pinch-to-zoom, selection box
- **Pan**: Click-and-drag, keyboard arrows
- **Tooltip**: Hover to see exact values at the data point
- **Brush Selection**: Click-and-drag to select a date/time range for filtering
- **Crosshair Sync**: Vertical crosshair synchronized across all charts in the same view
- **Legend Toggle**: Click legend items to show/hide individual series
- **Reset Zoom**: Double-click or button to reset to full view

### Advanced Interactions

- **Drill-Down**: Click a summary element (e.g., a day on the calendar heatmap) to navigate to the detail view for that day
- **Linked Brushing**: Selecting a range in one chart highlights the corresponding data in all related charts
- **Annotation**: User-added notes at specific time points
- **Comparison Mode**: Side-by-side or overlay comparison of two date ranges
- **Export**: Each chart can be exported individually as PNG/SVG or included in reports
