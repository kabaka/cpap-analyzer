# Data Analysis Architecture

This document specifies the complete design for statistical analysis and data science components of the CPAP Analyzer. It defines how analyses are structured, executed, and extended, with emphasis on performance, numerical correctness, and clinical validity.

**Target audience**: Data Science, Frontend, Performance, and Database agents.

**Last updated**: 2026-02-10

---

## 1. Analysis Architecture

### 1.1 Overview

The analysis subsystem processes CPAP therapy data through a multi-stage pipeline:

```
Storage Layer (IndexedDB + OPFS)
         ↓
Data Access Layer (queries, signal streaming)
         ↓
Analysis Pipeline (statistical computation)
         ↓
Result Cache (IndexedDB)
         ↓
Visualization Layer (charts, tables, reports)
```

**Key Design Principles**:

1. **Laziness**: Compute only what's needed, when it's needed.
2. **Caching**: Cache expensive computations; invalidate on data changes.
3. **Streaming**: Process high-frequency signals incrementally to avoid memory exhaustion.
4. **Isolation**: Run heavy computation in Web Workers to preserve UI responsiveness.
5. **Composability**: Small, testable analysis units that combine into complex workflows.
6. **Reproducibility**: Deterministic results for identical inputs.

### 1.2 Analysis Types

| Type | Examples | Data Source | Execution Context | Caching |
|------|----------|-------------|-------------------|---------|
| **Aggregate** | AHI, median pressure | `nightly_aggregates` | Main thread | Pre-computed in IndexedDB |
| **Descriptive** | Mean, median, percentiles | `nightly_aggregates` | Main thread | Result cache |
| **Time-Series** | Rolling averages, STL decomposition, ACF/PACF | `nightly_aggregates` | Main thread or Worker | Result cache |
| **Event-Based** | Cluster detection, duration distributions | `events` + `nightly_aggregates` | Main thread or Worker | Result cache |
| **Signal-Based** | Flow limitation detection, breath-by-breath | OPFS signals | Worker (required) | Rarely cached (too large) |
| **Correlation** | CPAP vs Fitbit metrics | `nightly_aggregates` + `integration_data` | Main thread | Result cache |
| **Custom (Plugin)** | User-defined algorithms | Plugin-specified | Plugin-specified | Plugin-controlled |

### 1.3 Analysis Pipeline Design

#### 1.3.1 Pipeline Stages

```typescript
interface AnalysisInput {
  type: string;                  // Analysis identifier
  dateRange: DateRange;          // Temporal scope
  parameters: Record<string, unknown>; // Algorithm config
  machineIds?: string[];         // Optional machine filter
  sessionIds?: string[];         // Optional session filter
}

interface AnalysisOutput {
  type: string;
  dateRange: DateRange;
  results: unknown;              // Structured results (type varies)
  metadata: AnalysisMetadata;
}

interface AnalysisMetadata {
  computedAt: string;            // ISO 8601 timestamp
  computationTimeMs: number;
  cacheVersion: number;          // For invalidation
  sampleSize: number;            // Number of observations
  warnings: string[];            // Data quality issues
  assumptions: string[];         // Statistical assumptions
}
```

**Pipeline Flow**:

1. **Request**: User triggers analysis from UI.
2. **Cache Lookup**: Check `analysis_results` store for matching cached result.
3. **Cache Hit**: Return cached result immediately.
4. **Cache Miss**:
   - **Data Fetch**: Query IndexedDB and/or OPFS for required data.
   - **Validation**: Check sample size, missing data, physiological ranges.
   - **Computation**: Execute analysis algorithm (main thread or Worker).
   - **Result Storage**: Cache result in `analysis_results`.
   - **Return**: Send result to UI.

#### 1.3.2 Cache Strategy

**Cache Key**: `${analysisType}:${dateRangeHash}:${parametersHash}:${machineIdsHash}`

**Cache Versioning**: Each analysis type has a `cacheVersion` integer. Increment when algorithm changes.

**Cache Invalidation Triggers**:
- New data imported for overlapping date range → delete affected analyses.
- User edits session metadata (e.g., notes, tags) → delete affected analyses.
- Cache version mismatch → recompute.
- Manual cache clear by user → delete all.

**Cache Eviction**: LRU eviction when IndexedDB quota nears limit (configurable, default: 95%).

#### 1.3.3 Incremental Computation

For large datasets (years of nightly data), some analyses benefit from incremental updates:

**Approach**: Maintain intermediate state in cache; update state when new data arrives rather than recompute from scratch.

**Applicable Analyses**:
- Rolling statistics (update only affected windows)
- Running aggregates (mean, variance via Welford's algorithm)
- Event counts and severity scores

**Implementation Pattern**:
```typescript
interface IncrementalState {
  analysisType: string;
  dateRange: DateRange;
  partialResults: unknown;       // Intermediate state
  lastUpdateDate: string;        // Last processed date
  cacheVersion: number;
}
```

When new data arrives:
1. Load `IncrementalState` from cache.
2. Fetch only new data since `lastUpdateDate`.
3. Update `partialResults` incrementally.
4. Store updated state.
5. Return latest results derived from state.

**Example: Rolling 30-Day Mean**:
- Store: deque of last 30 nights, running sum.
- Update: push new night, pop oldest, update sum.
- Result: `sum / 30`.
- Avoids re-scanning all data on each import.

### 1.4 Plugin System Integration

#### 1.4.1 Analysis Plugin Interface

```typescript
interface AnalysisPlugin {
  metadata: {
    id: string;                  // Unique identifier (e.g., "granger-causality")
    name: string;                // Human-readable name
    version: string;             // Semantic version
    author: string;
    description: string;
    category: AnalysisCategory;  // "time-series" | "correlation" | "event-based" | "signal-based" | "custom"
  };
  
  // Declare required data sources
  dataRequirements: {
    stores: ('nightly_aggregates' | 'events' | 'sessions' | 'integration_data')[];
    signals?: string[];          // E.g., ["Flow", "MaskPress"]
    minSampleSize: number;
  };
  
  // Parameter schema for UI input
  parameterSchema: JSONSchema;
  
  // Execution environment
  executionMode: 'main' | 'worker' | 'either';
  
  // Main entry point
  execute(input: AnalysisInput, dataProvider: DataProvider): Promise<AnalysisOutput>;
  
  // Optional: incremental update support
  supportsIncremental?: boolean;
  updateIncremental?(state: IncrementalState, newData: unknown[]): IncrementalState;
  
  // Optional: validation of input parameters
  validateInput?(input: AnalysisInput): { valid: boolean; errors: string[] };
  
  // Optional: result serialization for caching
  serializeResult?(result: unknown): string;
  deserializeResult?(serialized: string): unknown;
}
```

#### 1.4.2 Data Provider Interface

Plugins access data via the `DataProvider` abstraction to decouple them from storage internals:

```typescript
interface DataProvider {
  // Query nightly aggregates
  getNightlyAggregates(
    dateRange: DateRange,
    metrics?: string[],
    machineIds?: string[]
  ): Promise<NightlyAggregate[]>;
  
  // Query events
  getEvents(
    dateRange: DateRange,
    types?: EventType[],
    sessionIds?: string[]
  ): Promise<Event[]>;
  
  // Stream signal data (chunked)
  streamSignal(
    sessionId: string,
    channelName: string,
    startTime?: number,
    endTime?: number
  ): AsyncGenerator<Float32Array, void, unknown>;
  
  // Batch fetch sessions
  getSessions(
    dateRange: DateRange,
    machineIds?: string[]
  ): Promise<Session[]>;
  
  // Integration data (Fitbit, weather, etc.)
  getIntegrationData(
    source: string,
    dateRange: DateRange
  ): Promise<IntegrationData[]>;
}
```

#### 1.4.3 Plugin Registration and Discovery

```typescript
// Plugin manager singleton
class AnalysisPluginManager {
  private plugins = new Map<string, AnalysisPlugin>();
  
  register(plugin: AnalysisPlugin): void;
  unregister(pluginId: string): void;
  getPlugin(pluginId: string): AnalysisPlugin | undefined;
  listPlugins(category?: AnalysisCategory): AnalysisPlugin[];
  
  // Execute analysis via plugin
  async execute(
    pluginId: string,
    input: AnalysisInput,
    dataProvider: DataProvider
  ): Promise<AnalysisOutput>;
}
```

**Built-in Analyses as Plugins**: Core analyses (rolling averages, STL, correlation matrix, etc.) are implemented as internal plugins for consistency.

---

## 2. Core Statistical Methods

### 2.1 Descriptive Statistics

#### 2.1.1 Central Tendency and Dispersion

```typescript
interface DescriptiveStats {
  count: number;
  mean: number;
  median: number;
  mode: number[];                // May be multimodal
  variance: number;
  stdDev: number;
  stdErr: number;
  min: number;
  max: number;
  range: number;
  iqr: number;                   // Interquartile range (Q3 - Q1)
  cv: number;                    // Coefficient of variation (stdDev / mean)
}
```

**Implementation**:
- Use **Welford's algorithm** for numerically stable variance computation in a single pass.
- Median via **nth_element** (O(n) expected) or **quickselect** for large datasets.
- Mode via frequency map (handle ties: return array of modes).

**Percentiles** (separate function):
```typescript
function percentile(data: number[], p: number): number;
// Type 7 interpolation (R default, Excel PERCENTILE.INC)
// Linear interpolation between ranks
```

**Percentile Set**:
```typescript
interface Percentiles {
  p5: number;
  p10: number;
  p25: number;                   // Q1
  p50: number;                   // Median
  p75: number;                   // Q3
  p90: number;
  p95: number;
}
```

#### 2.1.2 Outlier Detection

**Tukey's Hinges Method**:
```typescript
interface OutlierDetection {
  lowerFence: number;            // Q1 - 1.5 × IQR
  upperFence: number;            // Q3 + 1.5 × IQR
  outliers: number[];            // Values outside fences
  outlierIndices: number[];
  outlierCount: number;
}
```

**Far Outliers** (optional):
- Lower far fence: Q1 - 3 × IQR
- Upper far fence: Q3 + 3 × IQR

**Application**: Flag but do not remove outliers by default. User can filter if desired.

#### 2.1.3 Distribution Shape

```typescript
interface DistributionShape {
  skewness: number;              // Asymmetry (0 = symmetric)
  kurtosis: number;              // Tailedness (3 = normal)
  excessKurtosis: number;        // kurtosis - 3
  isNormal: boolean;             // Shapiro-Wilk test (n < 5000) or Lilliefors (n ≥ 5000)
  normalityPValue: number;
}
```

**Skewness** (Fisher-Pearson):
$$
g_1 = \frac{\frac{1}{n}\sum_{i=1}^{n}(x_i - \bar{x})^3}{s^3}
$$

**Kurtosis** (Excess Kurtosis):
$$
g_2 = \frac{\frac{1}{n}\sum_{i=1}^{n}(x_i - \bar{x})^4}{s^4} - 3
$$

#### 2.1.4 Histogram Binning

**Freedman-Diaconis Rule**:
$$
h = 2 \cdot \text{IQR} \cdot n^{-1/3}
$$

**Sturges' Rule** (fallback for small n):
$$
k = \lceil \log_2(n) + 1 \rceil
$$

**Bin Count Bounds**: Minimum 5, maximum 50 to avoid over/under-binning.

---

### 2.2 Time-Series Analysis

#### 2.2.1 Rolling Statistics

**Rolling Mean with Confidence Interval**:
```typescript
interface RollingMean {
  dates: string[];
  values: number[];
  ciLower: number[];
  ciUpper: number[];
  sampleSizes: number[];         // Handle gaps in data
}

function rollingMean(
  dates: string[],
  values: number[],
  window: number,                // Days (e.g., 7, 30)
  confidence: number = 0.95
): RollingMean;
```

**Algorithm**:
- For each date $t$, compute mean over $[t - w + 1, t]$ inclusive.
- Skip dates with no data (gaps).
- CI via normal approximation: $\bar{x} \pm z_{\alpha/2} \cdot \frac{s}{\sqrt{n}}$, where $z_{0.025} \approx 1.96$.

**Rolling Median**:
```typescript
interface RollingMedian {
  dates: string[];
  values: number[];
  ciLower: number[];
  ciUpper: number[];
}

function rollingMedian(
  dates: string[],
  values: number[],
  window: number,
  confidence: number = 0.95
): RollingMedian;
```

**Algorithm**:
- For each date $t$, compute median over $[t - w + 1, t]$.
- CI via **binomial order-statistic method**: For sample size $n$, the $k$-th order statistic has confidence bounds determined by binomial cumulative distribution.
- More robust to outliers than mean.

**Gap Handling**:
- Use **pairwise deletion**: Only include available dates in each window.
- Track `sampleSizes` to annotate periods with sparse data.
- Warn if window contains < 50% expected observations.

#### 2.2.2 Trend Detection

**Linear Trend**:
```typescript
interface LinearTrend {
  slope: number;                 // Change per day
  intercept: number;
  r: number;                     // Pearson correlation coefficient
  rSquared: number;              // Coefficient of determination
  pValue: number;                // Significance of slope
  trendDirection: 'increasing' | 'decreasing' | 'flat';
  trendStrength: 'negligible' | 'weak' | 'moderate' | 'strong';
}

function linearTrend(dates: string[], values: number[]): LinearTrend;
```

**Algorithm**:
- Convert dates to ordinal (days since first date).
- Compute Pearson $r$ and $r^2$.
- Slope: $b = r \cdot \frac{s_y}{s_x}$.
- Intercept: $a = \bar{y} - b\bar{x}$.
- Significance: $t = r \sqrt{\frac{n-2}{1-r^2}}$, $df = n - 2$.

**Interpretation Thresholds**:
- $|r| < 0.1$: negligible
- $0.1 \leq |r| < 0.3$: weak
- $0.3 \leq |r| < 0.5$: moderate
- $|r| \geq 0.5$: strong

**LOESS Smoothing**:
```typescript
interface LoessSmooth {
  x: number[];                   // Evaluation points
  y: number[];                   // Smoothed values
  residuals: number[];           // Original - smoothed
}

function loess(
  x: number[],
  y: number[],
  span: number = 0.5,            // Fraction of data in local window
  degree: number = 2,            // Polynomial degree (1 or 2)
  evaluationPoints?: number[]    // Where to evaluate (default: 60 evenly spaced)
): LoessSmooth;
```

**Algorithm**: Local weighted polynomial regression with **tricube kernel**:
$$
W(u) = (1 - |u|^3)^3 \text{ for } |u| < 1, \text{ else } 0
$$

**Computational Complexity**: $O(n^2)$ for naive implementation. Use optimized library (e.g., **loess.js** or port from R).

#### 2.2.3 Change-Point Detection

**PELT (Pruned Exact Linear Time)**:
```typescript
interface ChangePoint {
  index: number;                 // Array index of change point
  date: string;                  // Date of change
  costBefore: number;            // Cost of segment before
  costAfter: number;             // Cost of segment after
  significance: number;          // Change magnitude (cost reduction)
}

interface ChangePointResult {
  changePoints: ChangePoint[];
  segments: Segment[];
}

interface Segment {
  start: number;
  end: number;
  mean: number;
  variance: number;
  n: number;
}

function detectChangePoints(
  values: number[],
  penalty: number = 10           // Penalty for adding a change point (β)
): ChangePointResult;
```

**Algorithm** (PELT, Killick et al. 2012):
- Cost function: Sum of squared errors (least squares).
- Penalty $\beta$ controls sensitivity: higher $\beta$ → fewer change points.
- Optimal partition via dynamic programming with pruning.
- $O(n)$ complexity for typical data (vs. $O(n^2)$ for segment neighborhood search).

**Penalty Selection**:
- Default $\beta = 10$ based on empirical testing.
- User can adjust: increase for fewer changes (major events only), decrease for more sensitivity.

**Interpretation**: A change point indicates a **structural break** in the time series — e.g., pressure adjustment, mask replacement, medication change, weight loss.

#### 2.2.4 STL Decomposition

**Seasonal-Trend Decomposition using LOESS**:
```typescript
interface STLResult {
  trend: number[];               // Long-term trend
  seasonal: number[];            // 7-day weekly cycle
  remainder: number[];           // Residuals (noise)
  dates: string[];
}

function stlDecomposition(
  dates: string[],
  values: number[],
  period: number = 7,            // Weekly cycle
  seasonal: number = 7,          // Seasonal smoother span (odd)
  trend: number = null,          // Trend smoother span (odd, default: next odd > 1.5 * period / (1 - 1.5/seasonal))
  robust: boolean = true         // Robust to outliers
): STLResult;
```

**Algorithm** (Cleveland et al. 1990):
- Iteratively estimates trend and seasonal components via LOESS smoothing.
- Seasonal component extracted by averaging cycles (e.g., Monday averages, Tuesday averages, etc.).
- Trend extracted from deseasonalized series.
- Residual = observed - trend - seasonal.
- **Robust mode**: Downweight outliers using bisquare weighting.

**Computational Complexity**: $O(n)$ iterations until convergence (typically 2–10 iterations).

**Use Case**: Identify weekly patterns (e.g., better compliance on weekends) and long-term trends (e.g., gradual AHI improvement) while separating noise.

#### 2.2.5 Autocorrelation and Partial Autocorrelation

**ACF (Autocorrelation Function)**:
```typescript
interface ACFResult {
  lags: number[];                // Lag values (1 to maxLag)
  acf: number[];                 // Autocorrelation coefficients
  seBartlett: number[];          // Standard errors (Bartlett's formula)
  significanceBound: number;     // 95% white noise bound: ±1.96 / sqrt(n)
}

function acf(values: number[], maxLag: number = 30): ACFResult;
```

**Algorithm**:
- For lag $k$: 
  $$
  r_k = \frac{\sum_{t=k+1}^{n}(x_t - \bar{x})(x_{t-k} - \bar{x})}{\sum_{t=1}^{n}(x_t - \bar{x})^2}
  $$
- Bartlett SE for lag $k$ (under null of white noise beyond lag $k$):
  $$
  \text{SE}(r_k) = \sqrt{\frac{1 + 2\sum_{j=1}^{k-1} r_j^2}{n}}
  $$
- Significance bound: $z_{0.025} / \sqrt{n} \approx 1.96 / \sqrt{n}$ for white noise.

**Gap Handling**: Use **pairwise deletion** at each lag.

**PACF (Partial Autocorrelation Function)**:
```typescript
interface PACFResult {
  lags: number[];
  pacf: number[];
  se: number[];
  significanceBound: number;
}

function pacf(values: number[], maxLag: number = 30): PACFResult;
```

**Algorithm**: **Durbin-Levinson recursion**:
$$
\phi_{kk} = \frac{r_k - \sum_{j=1}^{k-1} \phi_{k-1,j} r_{k-j}}{1 - \sum_{j=1}^{k-1} \phi_{k-1,j} r_j}
$$
where $\phi_{kk}$ is the partial autocorrelation at lag $k$.

**Interpretation**:
- ACF shows total correlation (direct + indirect) at each lag.
- PACF shows direct correlation at each lag after removing shorter-lag influences.
- Use PACF to determine autoregressive order for ARMA modeling.

---

### 2.3 Correlation and Causality

#### 2.3.1 Pearson Correlation

```typescript
interface CorrelationResult {
  r: number;                     // Correlation coefficient [-1, 1]
  rSquared: number;              // Proportion of variance explained
  n: number;                     // Sample size (after pairwise deletion)
  tStatistic: number;
  pValue: number;
  ci95Lower: number;             // Fisher's z-transformation CI
  ci95Upper: number;
  strength: 'negligible' | 'weak' | 'moderate' | 'strong' | 'very strong';
  direction: 'positive' | 'negative' | 'none';
}

function pearsonCorrelation(x: number[], y: number[]): CorrelationResult;
```

**Algorithm**:
$$
r = \frac{\sum_{i=1}^{n}(x_i - \bar{x})(y_i - \bar{y})}{\sqrt{\sum_{i=1}^{n}(x_i - \bar{x})^2} \sqrt{\sum_{i=1}^{n}(y_i - \bar{y})^2}}
$$

**Significance Test** (t-test):
$$
t = r \sqrt{\frac{n-2}{1-r^2}}, \quad df = n - 2
$$

**Confidence Interval** (Fisher's $z$-transformation):
$$
z = \frac{1}{2} \ln\left(\frac{1+r}{1-r}\right), \quad \text{SE}(z) = \frac{1}{\sqrt{n-3}}
$$
$$
\text{CI}_z = z \pm 1.96 \cdot \text{SE}(z)
$$
Back-transform: $r = \frac{e^{2z} - 1}{e^{2z} + 1}$

**Strength Thresholds**:
- $|r| < 0.1$: negligible
- $0.1 \leq |r| < 0.3$: weak
- $0.3 \leq |r| < 0.5$: moderate
- $0.5 \leq |r| < 0.7$: strong
- $|r| \geq 0.7$: very strong

#### 2.3.2 Spearman Rank Correlation

```typescript
function spearmanCorrelation(x: number[], y: number[]): CorrelationResult;
```

**Algorithm**:
1. Rank-transform $x$ and $y$ (average rank for ties).
2. Compute Pearson correlation on ranks: $\rho = r(\text{rank}(x), \text{rank}(y))$.

**Advantage**: Robust to outliers, detects monotonic (not just linear) relationships.

**Use Case**: Use Spearman when data is non-normal or contains outliers.

#### 2.3.3 Partial Correlation

```typescript
interface PartialCorrelationResult {
  r: number;                     // Partial correlation coefficient
  n: number;
  pValue: number;
  ci95Lower: number;
  ci95Upper: number;
}

function partialCorrelation(
  x: number[],
  y: number[],
  controls: number[][]           // Array of control variables
): PartialCorrelationResult;
```

**Algorithm** (Recursive):
For controlling variable $z$:
$$
r_{xy \cdot z} = \frac{r_{xy} - r_{xz} r_{yz}}{\sqrt{1 - r_{xz}^2} \sqrt{1 - r_{yz}^2}}
$$

For multiple controls, apply recursively:
$$
r_{xy \cdot z_1, z_2, \ldots} = r_{xy \cdot z_1, \ldots, z_{k-1}, z_k}
$$

**Alternative** (Matrix Inversion):
Given correlation matrix $\mathbf{R}$, partial correlation between $i$ and $j$ controlling for all other variables:
$$
r_{ij \cdot \text{rest}} = -\frac{\mathbf{R}^{-1}_{ij}}{\sqrt{\mathbf{R}^{-1}_{ii} \mathbf{R}^{-1}_{jj}}}
$$

**Use Case**: Disentangle confounding. Example: AHI and leak rate may correlate, but is it direct, or mediated by pressure?

#### 2.3.4 Cross-Correlation with Lag Analysis

```typescript
interface CrossCorrelationResult {
  lags: number[];                // -maxLag to +maxLag
  ccf: number[];                 // Cross-correlation at each lag
  significanceBound: number;     // ±1.96 / sqrt(n)
  bestLag: number;               // Lag with maximum |ccf|
  bestCCF: number;
}

function crossCorrelation(
  x: number[],
  y: number[],
  maxLag: number = 14            // Days
): CrossCorrelationResult;
```

**Algorithm**:
For lag $k$:
$$
r_k = \frac{\sum_{t=1}^{n-|k|}(x_{t+\max(0,k)} - \bar{x})(y_{t+\max(0,-k)} - \bar{y})}{(n - |k|) s_x s_y}
$$

- Positive lag $k$: $x$ leads $y$ by $k$ days.
- Negative lag $k$: $y$ leads $x$ by $|k|$ days.

**Interpretation**: Identifies time-delayed relationships. Example: "Does a pressure change today affect AHI tomorrow?"

#### 2.3.5 Granger Causality

```typescript
interface GrangerCausalityResult {
  fStatistic: number;
  pValue: number;
  optimalLag: number;            // AIC-selected lag
  causality: 'X causes Y' | 'Y causes X' | 'bidirectional' | 'none';
  confidenceLevel: 'high' | 'moderate' | 'low';
}

function grangerCausality(
  x: number[],
  y: number[],
  maxLag: number = 7
): GrangerCausalityResult;
```

**Algorithm** (Vector Autoregression):
1. Fit restricted model: $y_t = \sum_{i=1}^{p} \alpha_i y_{t-i} + \epsilon_t$
2. Fit unrestricted model: $y_t = \sum_{i=1}^{p} \alpha_i y_{t-i} + \sum_{i=1}^{p} \beta_i x_{t-i} + \epsilon_t$
3. F-test: Does including past values of $x$ significantly improve prediction of $y$?
4. Select optimal lag $p$ via Akaike Information Criterion (AIC).

**Null Hypothesis**: $x$ does not Granger-cause $y$ ($\beta_1 = \beta_2 = \ldots = \beta_p = 0$).

**F-Statistic**:
$$
F = \frac{(\text{RSS}_{\text{restricted}} - \text{RSS}_{\text{unrestricted}}) / p}{\text{RSS}_{\text{unrestricted}} / (n - 2p - 1)}
$$

**Use Case**: Establish **temporal precedence** (not true causality, but predictive relationship). Example: "Do pressure adjustments predict AHI improvements?"

---

### 2.4 Hypothesis Testing

#### 2.4.1 Mann-Whitney U Test

```typescript
interface MannWhitneyResult {
  u: number;                     // U statistic
  n1: number;                    // Sample size group 1
  n2: number;                    // Sample size group 2
  pValue: number;
  effectSize: number;            // Rank-biserial correlation
  effectSizeCI95Lower: number;
  effectSizeCI95Upper: number;
  effectSizeInterpretation: 'negligible' | 'small' | 'medium' | 'large';
  medianDifference: number;      // Hodges-Lehmann estimator
}

function mannWhitneyU(group1: number[], group2: number[]): MannWhitneyResult;
```

**Algorithm**:
1. Rank all observations from both groups (average rank for ties).
2. Compute $U_1 = R_1 - \frac{n_1(n_1+1)}{2}$, where $R_1$ is sum of ranks in group 1.
3. $U_2 = R_2 - \frac{n_2(n_2+1)}{2}$.
4. $U = \min(U_1, U_2)$.

**Exact Test** (for $n_1, n_2 \leq 28$):
- Dynamic programming to compute exact null distribution.

**Normal Approximation** (for larger samples):
$$
z = \frac{U - \mu_U}{\sigma_U}, \quad \mu_U = \frac{n_1 n_2}{2}, \quad \sigma_U = \sqrt{\frac{n_1 n_2 (n_1 + n_2 + 1)}{12}}
$$
**Tie Correction**:
$$
\sigma_U = \sqrt{\frac{n_1 n_2}{12} \left[ n_1 + n_2 + 1 - \frac{\sum (t_i^3 - t_i)}{(n_1 + n_2)(n_1 + n_2 - 1)} \right]}
$$
where $t_i$ is the size of the $i$-th tied group.

**Effect Size** (Rank-Biserial Correlation):
$$
r = \frac{U}{n_1 n_2} - 0.5, \quad r \in [-0.5, 0.5]
$$
Rescale to $[-1, 1]$: $r_{\text{rb}} = 2r = \frac{2U}{n_1 n_2} - 1$.

**Effect Size Interpretation** (for $r_{\text{rb}}$):
- $|r| < 0.1$: negligible
- $0.1 \leq |r| < 0.3$: small
- $0.3 \leq |r| < 0.5$: medium
- $|r| \geq 0.5$: large

**Median Difference** (Hodges-Lehmann Estimator):
- Median of all pairwise differences $(x_i - y_j)$ for $x$ in group 1, $y$ in group 2.
- More robust than difference of means.

**Use Case**: Compare two date ranges, pressure settings, or mask types. Non-parametric alternative to t-test.

#### 2.4.2 Cohen's d Effect Size

```typescript
interface CohensDResult {
  d: number;                     // Effect size
  ci95Lower: number;
  ci95Upper: number;
  interpretation: 'negligible' | 'small' | 'medium' | 'large';
  pooledStdDev: number;
}

function cohensD(group1: number[], group2: number[]): CohensDResult;
```

**Algorithm**:
$$
d = \frac{\bar{x}_1 - \bar{x}_2}{s_{\text{pooled}}}
$$
where
$$
s_{\text{pooled}} = \sqrt{\frac{(n_1 - 1)s_1^2 + (n_2 - 1)s_2^2}{n_1 + n_2 - 2}}
$$

**Hedges' Correction** (small-sample bias correction):
$$
g = d \cdot \left(1 - \frac{3}{4(n_1 + n_2) - 9}\right)
$$
Use $g$ for $n_1 + n_2 < 50$.

**Confidence Interval** (approximate):
$$
\text{SE}(d) = \sqrt{\frac{n_1 + n_2}{n_1 n_2} + \frac{d^2}{2(n_1 + n_2)}}
$$
$$
\text{CI} = d \pm 1.96 \cdot \text{SE}(d)
$$

**Interpretation** (Cohen 1988):
- $|d| < 0.1$: negligible
- $0.1 \leq |d| < 0.3$: small
- $0.3 \leq |d| < 0.5$: medium
- $|d| \geq 0.5$: large

**Medical Context**: Large effect sizes ($d > 0.5$) suggest clinically meaningful differences. Small effects may still be important with large samples.

---

### 2.5 Survival Analysis

#### 2.5.1 Kaplan-Meier Estimator

```typescript
interface KaplanMeierResult {
  times: number[];               // Event times
  survivors: number[];           // Proportion surviving at each time
  events: number[];              // Number of events at each time
  atRisk: number[];              // Number at risk at each time
  ciLower: number[];             // 95% CI lower bound
  ciUpper: number[];             // 95% CI upper bound
  medianSurvivalTime: number | null; // Time when S(t) = 0.5
}

function kaplanMeier(
  durations: number[],
  events: boolean[]              // true = event occurred, false = censored
): KaplanMeierResult;
```

**Algorithm**:
$$
S(t) = \prod_{t_i \leq t} \left(1 - \frac{d_i}{n_i}\right)
$$
where:
- $t_i$ = distinct event times
- $d_i$ = number of events at time $t_i$
- $n_i$ = number at risk just before $t_i$

**Variance** (Greenwood's Formula):
$$
\text{Var}(S(t)) = S(t)^2 \sum_{t_i \leq t} \frac{d_i}{n_i(n_i - d_i)}
$$

**Confidence Interval** (Log-Log Transformation):
$$
\ln(-\ln(S(t))) \pm 1.96 \cdot \frac{\sqrt{\text{Var}(S(t))}}{S(t) \ln(S(t))}
$$
Back-transform to get $[\text{CI}_{\text{lower}}, \text{CI}_{\text{upper}}]$.

**Use Cases**:
1. **Usage Compliance**: Duration until reaching 4 hours each night. Censored observations = nights where mask was removed early.
2. **Apnea Event Duration**: Time until an apnea event ends. All events observed (no censoring).
3. **Time-to-Improvement**: Days until AHI drops below 5. Censored = stopped therapy before improvement.

**Median Survival Time**: Smallest time $t$ where $S(t) \leq 0.5$. If $S(t) > 0.5$ for all $t$, return `null`.

---

### 2.6 Distribution Analysis

#### 2.6.1 QQ Plot Data

```typescript
interface QQPlotData {
  theoreticalQuantiles: number[]; // Normal quantiles
  sampleQuantiles: number[];      // Observed quantiles
  n: number;
  correlation: number;            // Correlation with theoretical line (1 = perfect normality)
  deviations: number[];           // Vertical distance from diagonal
}

function qqNormal(values: number[]): QQPlotData;
```

**Algorithm**:
1. Sort observed values: $x_{(1)}, x_{(2)}, \ldots, x_{(n)}$.
2. Compute plotting positions: $p_i = \frac{i - 0.5}{n}$ (Hazen formula).
3. Compute theoretical quantiles: $q_i = \Phi^{-1}(p_i)$, where $\Phi^{-1}$ is the inverse normal CDF.
4. Plot $(q_i, x_{(i)})$. If normal, points fall on line $y = \mu + \sigma x$.

**Inverse Normal CDF** (Beasley-Springer-Moro approximation):
- Fast approximation with error < $10^{-7}$ over $[0.001, 0.999]$.
- Use rational function approximation.

**Interpretation**:
- Points on diagonal: Normal distribution.
- S-curve: Heavy tails (kurtosis).
- Arch: Light tails.
- Left/right deviation: Skewness.

#### 2.6.2 Normality Tests

**Shapiro-Wilk Test** (for $n < 5000$):
```typescript
interface NormalityTestResult {
  statistic: number;             // W (Shapiro-Wilk) or D (Kolmogorov-Smirnov)
  pValue: number;
  isNormal: boolean;             // At α = 0.05
}

function shapiroWilk(values: number[]): NormalityTestResult;
```

**Algorithm** (Shapiro-Wilk):
$$
W = \frac{\left(\sum_{i=1}^{n} a_i x_{(i)}\right)^2}{\sum_{i=1}^{n} (x_i - \bar{x})^2}
$$
where $a_i$ are constants derived from expected order statistics of normal distribution.

**Kolmogorov-Smirnov Test** (for $n \geq 5000$):
- Simpler, less powerful than Shapiro-Wilk, but scales better.
$$
D = \max_i \left| F_n(x_{(i)}) - F_0(x_{(i)}) \right|
$$
where $F_n$ is empirical CDF and $F_0$ is theoretical normal CDF.

**Lilliefors Correction**: KS test requires estimated parameters; Lilliefors provides corrected critical values.

**Use Case**: Select parametric vs. non-parametric methods. If data is non-normal, prefer Spearman over Pearson, median over mean, Mann-Whitney over t-test.

---

### 2.7 Clustering Algorithms

#### 2.7.1 FLG-Bridged Clustering (ResMed Default)

```typescript
interface ClusterResult {
  clusters: Cluster[];
  unclustered: Event[];          // Events not in any cluster
}

interface Cluster {
  id: string;                    // UUID
  events: Event[];
  startTime: number;             // Epoch ms of first event
  endTime: number;               // Epoch ms of last event + last event duration
  duration: number;              // seconds
  density: number;               // events per minute
  weightedDensity: number;       // seconds of apnea per minute ("Choke Factor")
  severityScore: number;         // Composite heuristic
  avgFlowLimitation: number | null; // Mean FLG during cluster
  avgPressure: number | null;
  avgEPAP: number | null;
}

function clusterEventsFLGBridged(
  events: Event[],
  flgSignal: Float32Array,       // Flow limitation time-series
  timestamps: Float32Array,
  edgeEnter: number = 0.5,       // FLG threshold to open bridge
  edgeExit: number = 0.35        // FLG threshold to close bridge (hysteresis)
): ClusterResult;
```

**Algorithm**:
1. Sort events by timestamp.
2. Initialize first event as cluster seed.
3. For each subsequent event:
   - Check temporal gap to previous event.
   - If gap ≤ threshold: add to cluster.
   - If gap > threshold: check FLG signal during gap.
     - If FLG sustained ≥ `edgeEnter` during gap, treat as **bridged** → add to cluster.
     - **Hysteresis**: Once FLG drops below `edgeExit`, stop bridging.
   - If gap unbridged and > threshold: start new cluster.
4. Compute cluster metrics.

**Hysteresis (Schmitt Trigger)**:
- Enter bridge mode when FLG ≥ 0.5.
- Exit bridge mode when FLG < 0.35.
- Prevents oscillation at threshold boundary.

**Edge Extension**:
- Extend cluster boundaries beyond first/last event to include leading/trailing FLG elevation.
- Extend until FLG < `edgeExit`.

**Metrics**:
- **Density**: $\frac{\text{event count}}{\text{cluster duration (minutes)}}$
- **Weighted Density** ("Choke Factor"): $\frac{\sum \text{event durations}}{\text{cluster duration (minutes)}}$
- **Severity Score**: $\text{duration} \times \text{density} \times \text{edge extension factor}$ (heuristic)

#### 2.7.2 K-Means++ Clustering

```typescript
function clusterEventsKMeans(
  events: Event[],
  k: number,                     // Number of clusters
  features: string[] = ['timestamp', 'duration'] // Features to cluster on
): ClusterResult;
```

**Algorithm** (Arthur & Vassilvitskii 2007):
1. Initialize first centroid randomly.
2. For each subsequent centroid:
   - Choose next centroid with probability proportional to squared distance from nearest existing centroid.
3. Assign events to nearest centroid.
4. Update centroids: mean of assigned events.
5. Repeat steps 3–4 until convergence (centroids stable).

**Distance Metric**:
- Timestamp distance: Absolute difference in seconds.
- Duration distance: Absolute difference in seconds.
- Normalize features to [0, 1] before clustering to avoid scale dominance.

**Use Case**: When expected cluster count is known (e.g., user reports 3 distinct apnea periods).

#### 2.7.3 Single-Link Agglomerative Clustering

```typescript
function clusterEventsAgglomerative(
  events: Event[],
  maxGap: number = 300           // Max gap (seconds) between events in same cluster
): ClusterResult;
```

**Algorithm**:
1. Sort events by timestamp.
2. Initialize each event as its own cluster.
3. Merge clusters if temporal gap < `maxGap`.
4. Result: Hierarchical dendrogram; cut at `maxGap` to get flat clusters.

**Advantage**: Parameter-free (except `maxGap`); automatically determines cluster count.

**Disadvantage**: Sensitive to chain effect (single linkage can form long chains).

---

### 2.8 False-Negative Detection

**Purpose**: Identify sustained high flow limitation (FLG) without corresponding apnea/hypopnea events — likely unreported respiratory disturbances.

```typescript
interface FalseNegativeDetection {
  detections: FalseNegativeEvent[];
  preset: 'strict' | 'balanced' | 'lenient';
}

interface FalseNegativeEvent {
  startTime: number;             // Epoch ms
  endTime: number;
  duration: number;              // seconds
  peakFLG: number;               // Max FLG during event
  meanFLG: number;               // Mean FLG during event
  likelihood: number;            // 0–1 (heuristic confidence)
  nearbyEvents: Event[];         // Events within ±60s
}

function detectFalseNegatives(
  flgSignal: Float32Array,
  timestamps: Float32Array,
  events: Event[],                // Existing events to exclude
  preset: 'strict' | 'balanced' | 'lenient' = 'balanced'
): FalseNegativeDetection;
```

**Algorithm**:
1. Identify contiguous regions where FLG ≥ threshold (threshold varies by preset).
2. Exclude regions overlapping with existing events (±5s buffer).
3. Filter by minimum duration (varies by preset).
4. Allow small gaps (< gap tolerance) within a detection.
5. Compute `likelihood` heuristic:
   - Higher if peak FLG is high.
   - Higher if duration is long.
   - Lower if nearby events exist (may be continuation).

**Presets**:

| Preset | FLG Threshold | Min Duration | Gap Tolerance | Use Case |
| ---- | ---- | ---- | ---- | ---- |
| **Strict** | ≥ 0.3 | 15 s | 5 s | Conservative; fewer false positives |
| **Balanced** | ≥ 0.2 | 10 s | 10 s | Default; balance sensitivity/specificity |
| **Lenient** | ≥ 0.15 | 8 s | 15 s | Aggressive; more detections |

**Output**: List of candidate false-negative events with timestamps, severity, and likelihood score. User can review and interpret.

**Validation**: Compare against polysomnography-scored events (if available). Tune thresholds based on precision/recall.

---

## 3. Clinical Metrics

### 3.1 AHI (Apnea-Hypopnea Index)

**Definition**: Number of apneas and hypopneas per hour of sleep.

**Formula**:
$$
\text{AHI} = \frac{\text{Apnea Count} + \text{Hypopnea Count}}{\text{Usage Hours}}
$$

**Components**:
- **Obstructive AHI**: Obstructive apneas + obstructive hypopneas
- **Central AHI**: Central apneas + central hypopneas (if scored separately)
- **Mixed AHI**: Mixed apneas
- **Total AHI**: Sum of all components

**Severity Bands** (per AASM):
- **Normal**: AHI < 5
- **Mild**: 5 ≤ AHI < 15
- **Moderate**: 15 ≤ AHI < 30
- **Severe**: AHI ≥ 30

**Implementation Notes**:
- Use **usage hours** (mask-on time), not session duration (including mask-off periods).
- RERA (Respiratory Effort-Related Arousals) may be included in some clinical contexts → **RDI** (Respiratory Disturbance Index).
- ResMed machines report obstructive/central/hypopnea separately; sum appropriately.

**Data Source**: `nightly_aggregates.ahi` (pre-computed), or compute from `events` table:
```typescript
function computeAHI(events: Event[], usageMinutes: number): number {
  const apneaHypopneaEvents = events.filter(e =>
    ['ObstructiveApnea', 'CentralApnea', 'MixedApnea', 'Hypopnea'].includes(e.type)
  );
  return (apneaHypopneaEvents.length / usageMinutes) * 60;
}
```

### 3.2 Event Classification

**AASM Standards** (American Academy of Sleep Medicine):

| Event Type | Criteria | Scored in AHI |
| ---- | ---- | ---- |
| **Apnea** | ≥ 90% reduction in airflow for ≥ 10 seconds | Yes |
| **Obstructive Apnea** | Apnea with continued respiratory effort | Yes |
| **Central Apnea** | Apnea with absent respiratory effort | Yes |
| **Mixed Apnea** | Starts central, becomes obstructive | Yes |
| **Hypopnea** | ≥ 30% reduction in airflow for ≥ 10 seconds with ≥ 3% SpO₂ desaturation or arousal | Yes |
| **RERA** | Respiratory effort-related arousal | Optional (RDI) |
| **Flow Limitation** | Flattened inspiratory flow contour | No (but clinically relevant) |

**ResMed Event Detection**:
- ResMed machines auto-detect and classify events.
- Algorithms proprietary but validated against polysomnography.
- Central vs. obstructive distinction based on respiratory effort sensors (pressure fluctuations, flow patterns).

**User Override**: Allow users to manually reclassify events if they disagree with machine scoring (advanced feature).

### 3.3 Leak Rate Analysis

**Definition**: Unintentional mask leak (L/min). Separate from intentional vent leak (machine-specific constant).

**Metrics**:
- **Median Leak**: 50th percentile (robust to outliers).
- **P95 Leak**: 95th percentile (near-peak leak).
- **Max Leak**: Maximum instantaneous leak.
- **Large Leak Duration**: Time with leak > 24 L/min (ResMed threshold for "large leak").

**Clinical Relevance**:
- **Mild Leak** (< 10 L/min median): Normal seal variation.
- **Moderate Leak** (10–24 L/min median): May affect therapy, but machine compensates.
- **Large Leak** (> 24 L/min median): Machine cannot compensate; therapy ineffective. Requires mask adjustment.

**Implementation**:
```typescript
function analyzeLeaks(leakSignal: Float32Array, sampleRate: number): LeakAnalysis {
  const sorted = [...leakSignal].sort((a, b) => a - b);
  const median = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const max = sorted[sorted.length - 1];
  
  const largLeakSamples = leakSignal.filter(v => v > 24).length;
  const largeLeakDuration = (largeLeakSamples / sampleRate) / 60; // minutes
  
  return { median, p95, max, largeLeakDuration };
}
```

**Mask Fit Guidance**:
- If median > 24 L/min: "Large leak detected. Check mask fit."
- If P95 > 30 L/min: "Frequent leaks. Consider mask resizing or adjustment."
- If max > 60 L/min: "Severe leak spike. May indicate mask displacement."

### 3.4 Pressure Analysis

**Metrics**:
- **Mean Pressure**: Average over entire session.
- **Median Pressure**: 50th percentile.
- **P95 Pressure**: 95th percentile (near-max delivered pressure).
- **Max Pressure**: Maximum delivered pressure.

**BiPAP-Specific**:
- **EPAP** (Expiratory Positive Airway Pressure): Pressure during exhalation.
- **IPAP** (Inspiratory Positive Airway Pressure): Pressure during inhalation.
- **Pressure Support**: IPAP - EPAP. Higher support → more ventilatory assistance.

**Data Source**: `nightly_aggregates.pressureMean`, `pressureMedian`, `pressureP95`, `pressureMax`, `epapMedian`, `ipapMedian`.

**Clinical Interpretation**:
- **Fixed CPAP**: Pressure constant (e.g., 10 cmH₂O).
- **Auto-Adjusting (APAP)**: Pressure varies 4–20 cmH₂O based on detected obstruction.
- **Optimal Titration**: Pressure sufficient to control AHI (< 5) without excessive leak or discomfort.

**Titration Analysis**:
- Compare AHI at different median pressures.
- Use **Mann-Whitney U** or **linear regression** to identify pressure-AHI relationship.
- Goal: Minimum pressure that achieves AHI < 5.

### 3.5 SpO₂ Analysis (if oximetry available)

**Metrics**:
- **Mean SpO₂**: Average oxygen saturation.
- **Median SpO₂**: 50th percentile.
- **Min SpO₂**: Lowest observed saturation.
- **Time < 90%**: Percentage of session with SpO₂ < 90% (hypoxemia threshold).
- **ODI** (Oxygen Desaturation Index): Number of ≥ 3% desaturations per hour.

**Clinical Thresholds**:
- **Normal**: SpO₂ ≥ 95% consistently.
- **Mild Hypoxemia**: SpO₂ 90–94% intermittently.
- **Moderate Hypoxemia**: SpO₂ 85–89% or > 5% time < 90%.
- **Severe Hypoxemia**: SpO₂ < 85% or > 10% time < 90%.

**Implementation**:
```typescript
function analyzeSpO2(spo2Signal: Float32Array, sampleRate: number): SpO2Analysis {
  const mean = average(spo2Signal);
  const median = percentile([...spo2Signal].sort(), 50);
  const min = Math.min(...spo2Signal);
  
  const samplesBelow90 = spo2Signal.filter(v => v < 90).length;
  const percentBelow90 = (samplesBelow90 / spo2Signal.length) * 100;
  
  const desaturations = detectDesaturations(spo2Signal, 3); // 3% drop
  const odi = (desaturations / (spo2Signal.length / sampleRate / 3600));
  
  return { mean, median, min, percentBelow90, odi };
}
```

**Desaturation Detection**:
- Identify local maxima (peaks) in SpO₂ signal.
- Find subsequent local minima (troughs).
- If peak - trough ≥ 3%, count as desaturation.
- Use sliding window smoothing to reduce noise.

### 3.6 Sleep Quality Metrics (from Fitbit integration)

**Sleep Stages**:
- **Deep Sleep**: Slow-wave sleep (most restorative).
- **Light Sleep**: N1 + N2 stages.
- **REM Sleep**: Rapid eye movement (cognitive restoration).
- **Wake**: Time awake during sleep period.

**Sleep Efficiency**:
$$
\text{Sleep Efficiency (\%)} = \frac{\text{Total Sleep Time}}{\text{Time in Bed}} \times 100
$$
- **Normal**: ≥ 85%
- **Impaired**: < 85%

**Correlation with CPAP**:
- High AHI → fragmented sleep → low efficiency.
- Effective CPAP therapy → improved sleep efficiency and stage distribution.

**Data Source**: `integration_data` store, `source = 'fitbit'`.

---

## 4. Performance Considerations

### 4.1 Handling High-Frequency Data (25–50 Hz)

**Challenge**: 8 hours × 25 Hz × 3 channels = 2.16 million samples. Cannot load all into memory for every analysis.

**Strategies**:

#### 4.1.1 Streaming

**Use Case**: Signal visualization, flow limitation detection, breath-by-breath analysis.

**Approach**:
- Read OPFS chunks sequentially via `AsyncGenerator`.
- Process each chunk (e.g., 5 minutes = 7,500 samples per channel).
- Aggregate results incrementally (running statistics, event markers).
- Discard chunk data after processing.

**Example**:
```typescript
async function* streamChunks(sessionId: string, channelName: string): AsyncGenerator<Float32Array> {
  const manifest = await loadManifest(sessionId);
  for (const chunk of manifest.chunks) {
    const chunkData = await loadChunk(sessionId, chunk.fileName, channelName);
    yield chunkData;
  }
}

async function computeMeanFlow(sessionId: string): Promise<number> {
  let sum = 0;
  let count = 0;
  for await (const chunk of streamChunks(sessionId, 'Flow')) {
    sum += chunk.reduce((a, b) => a + b, 0);
    count += chunk.length;
  }
  return sum / count;
}
```

#### 4.1.2 Downsampling

**Use Case**: Time-series visualization at zoom levels where full resolution is imperceptible.

**Approach**:
- Pre-compute downsampled versions: 1 sample/minute, 1 sample/hour.
- Store in OPFS cache: `/cpap-analyzer/cache/downsampled/{sessionId}-1h.bin`.
- Serve downsampled data for overview charts; full data for detail views.

**Downsampling Algorithm**:
- **Min-Max**: For each bin, store min and max values → preserve peaks/troughs.
- **LTTB** (Largest-Triangle-Three-Buckets, Sveinn Steinarsson 2013): Perceptual downsampling that preserves visual shape.

**Cache Invalidation**: Downsampled cache is immutable per session. Invalidate on session re-import only.

#### 4.1.3 Lazy Loading

**Use Case**: User navigates to a specific night's detail view.

**Approach**:
- Load only requested session's data.
- Use IndexedDB indexes to fetch metadata quickly.
- Stream OPFS signals only when user requests signal viewer.

### 4.2 Streaming vs. Batch Processing

| Analysis Type | Mode | Rationale |
| ---- | ---- | ---- |
| AHI, pressure stats | Batch | Pre-computed in `nightly_aggregates` |
| Rolling averages | Batch | Small dataset (nightly aggregates) |
| Correlation matrix | Batch | Small dataset |
| Event clustering | Batch | Events table is small |
| Flow limitation detection | Stream | High-frequency signal data |
| Signal visualization | Stream | Cannot load years of 25 Hz data |
| Breath-by-breath analysis | Stream | Per-breath computation |

### 4.3 Memory Management

**Heap Allocation**:
- JavaScript heap typically 1–4 GB in browser.
- Float32Array: 4 bytes per sample.
- 1 night full-res: ~6 MB → fits in memory.
- 1 year full-res: ~2.2 GB → exceeds heap.

**Strategies**:
1. **Chunk Processing**: Process one session at a time.
2. **TypedArrays**: Use `Float32Array` instead of plain arrays (4× smaller, faster).
3. **Manual GC Hints**: Set large arrays to `null` after processing; trust GC.
4. **Offload to Worker**: Heavy computation in Worker thread → separate heap.

**Monitoring**:
- Use `performance.memory.usedJSHeapSize` to track usage.
- Warn user if approaching quota.

### 4.4 Web Worker Usage

**When to Use Workers**:
- Computation > 50 ms blocks UI → move to Worker.
- Signal processing, FFT, clustering, correlation on large datasets.

**Worker Communication Overhead**:
- Transferring large TypedArrays is fast (**transferable objects** → zero-copy).
- Prefer transferring ArrayBuffers over postMessage.

**Example**:
```typescript
// Main thread
const worker = new Worker('analysis-worker.js');
const signal = new Float32Array(720000); // 8 hrs × 25 Hz
worker.postMessage({ type: 'computeFFT', signal: signal.buffer }, [signal.buffer]);
// signal is now neutered (transferred)

// Worker thread
self.onmessage = (e) => {
  if (e.data.type === 'computeFFT') {
    const signal = new Float32Array(e.data.signal);
    const fft = computeFFT(signal);
    self.postMessage({ type: 'fftResult', fft: fft.buffer }, [fft.buffer]);
  }
};
```

**Worker Pool**:
- For multi-session batch analyses, use a pool of 4–8 workers (≈ CPU cores).
- Queue tasks; distribute to available workers.

### 4.5 Caching and Memoization

**IndexedDB Result Cache**:
- Cache all expensive analyses in `analysis_results` store.
- Key by `${analysisType}:${dateRangeHash}:${parametersHash}`.
- TTL = indefinite; invalidate on data changes.

**In-Memory Memoization**:
- Memoize frequently-called pure functions (e.g., percentile computation on same dataset).
- Use JavaScript `Map` with LRU eviction (max 100 entries).

**Example**:
```typescript
const memoCache = new Map<string, unknown>();
const memoKeys: string[] = [];

function memoize<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
  return (...args: unknown[]): T => {
    const key = JSON.stringify(args);
    if (memoCache.has(key)) return memoCache.get(key) as T;
    
    const result = fn(...args);
    memoCache.set(key, result);
    memoKeys.push(key);
    
    if (memoKeys.length > 100) {
      const evictKey = memoKeys.shift();
      memoCache.delete(evictKey!);
    }
    
    return result;
  };
}
```

---

## 5. Algorithm Implementation Guidance

### 5.1 Preferred Libraries

| Domain | Library | Rationale |
| ---- | ---- | ---- |
| **Statistics** | Custom implementation | Avoid heavy deps; most methods are straightforward |
| **Linear Algebra** | `ml-matrix` | Lightweight, well-tested, TypeScript-friendly |
| **FFT** | `fft.js` or `dsp.js` | Fast, pure JS, no WASM overhead |
| **LOESS** | Custom port from R | No JS library; port `loess.c` algorithm |
| **Time-Series** | Custom implementation | STL, PELT, ACF/PACF are niche; implement per spec |
| **Regression** | `regression` or custom | Simple package, but validate correctness |
| **Clustering** | Custom implementation | K-Means, agglomerative clustering are simple |
| **Plotting** | Handled by Visualization layer | Analysis outputs data only; UI renders |

**Library Vetting**:
- Check npm weekly downloads, GitHub stars, last commit date.
- Audit code for correctness (statistical algorithms often have bugs).
- Prefer TypeScript or well-typed libraries.
- Minimize bundle size impact.

### 5.2 Numerical Precision

**Floating-Point Considerations**:
- Use `Float32` for signals (sufficient for CPAP data; resolution ~ 0.01 cmH₂O).
- Use `Float64` (JS `number`) for intermediate statistical computations to avoid accumulation error.
- Avoid naive variance: $\sum x_i^2 - (\sum x_i)^2 / n$ is numerically unstable.
- Use **Welford's algorithm** for variance:
  ```typescript
  function welfordVariance(values: number[]): number {
    let mean = 0, M2 = 0;
    for (let i = 0; i < values.length; i++) {
      const delta = values[i] - mean;
      mean += delta / (i + 1);
      M2 += delta * (values[i] - mean);
    }
    return M2 / (values.length - 1);
  }
  ```

**Physiological Range Validation**:
- Reject out-of-range values before computation:
  - Flow: [-200, 200] L/min
  - Pressure: [0, 30] cmH₂O
  - Leak: [0, 200] L/min
  - SpO₂: [0, 100] %
- Flag violations as data quality warnings.

**IEEE 754 Special Values**:
- Handle `NaN`, `Infinity`, `-Infinity` explicitly.
- Use `Number.isFinite(x)` before arithmetic.
- Replace invalid values with `null` or flag as missing.

### 5.3 Validation Approaches

**Unit Tests**:
- Test each statistical function against known results:
  - Use R or Python SciPy to generate reference outputs.
  - Test edge cases: n=0, n=1, all equal values, outliers.
  - Test numeric stability: large values, small differences.

**Property-Based Tests**:
- Use `fast-check` library for property testing.
- Example: `mean(data) ≥ min(data) && mean(data) ≤ max(data)`.

**Integration Tests**:
- Full pipeline tests with realistic CPAP data.
- Compare output to OSCAR Export Analyzer (reference implementation).

**Clinical Validation**:
- Engage with sleep medicine professionals to review metrics.
- Compare AHI, event counts against polysomnography gold standard (if available).

### 5.4 Reference Standards

**Statistical Methods**:
- Follow AASM standards for clinical metrics (AHI, event classification).
- Use established algorithms: Welford, Freedman-Diaconis, STL (Cleveland), PELT (Killick), K-Means++ (Arthur & Vassilvitskii).
- Cross-reference implementations with R, Python SciPy, MATLAB.

**Medical Standards**:
- **AASM Manual for the Scoring of Sleep and Associated Events** (latest version).
- **CMS (Centers for Medicare & Medicaid Services)** compliance criteria: ≥ 4 hours per night for ≥ 70% of nights in 30-day period.
- **FDA guidance** on CPAP data reporting (minimal, but relevant for export formats).

**Documentation**:
- Cite all algorithms: paper, author, year.
- Include rationale for parameter choices (e.g., PELT penalty = 10).
- Warn users when methods have assumptions (normality, independence, etc.).

---

## 6. Extensibility

### 6.1 Custom Analyses via Plugins

**Goal**: Enable advanced users and researchers to implement custom statistical methods without modifying core code.

**Interface**: See [Section 1.4.1](#141-analysis-plugin-interface) for full `AnalysisPlugin` interface.

**Example Use Cases**:
- **Wavelet Analysis**: Time-frequency decomposition of flow signal.
- **Machine Learning**: Predict optimal pressure from patient features.
- **Custom Scoring**: Alternative AHI computation (e.g., different hypopnea criteria).
- **Research Metrics**: Novel indices (e.g., cardiopulmonary coupling).

### 6.2 Data Access Patterns for Plugin Authors

**Best Practices**:
1. **Request Only Required Data**: Specify `dataRequirements` to minimize data fetch overhead.
2. **Use Streaming for Signals**: Don't load entire sessions into memory.
3. **Cache Results**: Implement `serializeResult` and `deserializeResult` for cache compatibility.
4. **Handle Missing Data**: Check for `null` values, gaps in time series.
5. **Validate Inputs**: Implement `validateInput` to provide helpful error messages.
6. **Document Assumptions**: Include `metadata.assumptions` in output for transparency.

**Example Plugin Skeleton**:
```typescript
export const customAnalysisPlugin: AnalysisPlugin = {
  metadata: {
    id: 'my-custom-analysis',
    name: 'My Custom Analysis',
    version: '1.0.0',
    author: 'Research Team',
    description: 'Custom statistical method for CPAP data',
    category: 'time-series',
  },
  
  dataRequirements: {
    stores: ['nightly_aggregates'],
    minSampleSize: 14,
  },
  
  parameterSchema: {
    type: 'object',
    properties: {
      windowSize: { type: 'number', default: 7 },
    },
  },
  
  executionMode: 'main',
  
  async execute(input, dataProvider): Promise<AnalysisOutput> {
    const aggregates = await dataProvider.getNightlyAggregates(
      input.dateRange,
      ['ahi', 'usageHours'],
      input.machineIds
    );
    
    // Custom computation here
    const results = myCustomAlgorithm(aggregates, input.parameters.windowSize);
    
    return {
      type: input.type,
      dateRange: input.dateRange,
      results,
      metadata: {
        computedAt: new Date().toISOString(),
        computationTimeMs: performance.now() - startTime,
        cacheVersion: 1,
        sampleSize: aggregates.length,
        warnings: [],
        assumptions: ['Data is normally distributed', 'No autocorrelation'],
      },
    };
  },
};
```

### 6.3 Result Format Specifications

**Standardized Output Types**:

```typescript
// Time-series result
interface TimeSeriesResult {
  dates: string[];
  values: number[];
  ciLower?: number[];
  ciUpper?: number[];
  labels?: string[];
}

// Correlation result
interface CorrelationMatrixResult {
  variables: string[];
  matrix: number[][];           // Symmetric matrix
  pValues: number[][];
}

// Distribution result
interface DistributionResult {
  bins: { min: number; max: number; count: number }[];
  stats: DescriptiveStats;
}

// Event-based result
interface EventAnalysisResult {
  events: Event[];
  summary: Record<string, unknown>;
}

// Custom result (plugin-defined)
type CustomResult = Record<string, unknown>;
```

**Serialization**:
- Use JSON for non-binary data.
- Use MessagePack or custom binary for large results (optional).
- Include version field for forward compatibility.

**Visualization Hints** (optional):
- Plugin can suggest visualization type: `line`, `scatter`, `heatmap`, `histogram`.
- UI can use hints to auto-select appropriate chart.

---

## 7. Appendix

### 7.1 Glossary

| Term | Definition |
| ---- | ---- |
| **AHI** | Apnea-Hypopnea Index: respiratory events per hour |
| **ACF** | Autocorrelation Function: self-correlation at different lags |
| **AASM** | American Academy of Sleep Medicine |
| **CPAP** | Continuous Positive Airway Pressure |
| **BiPAP** | Bilevel Positive Airway Pressure (EPAP/IPAP) |
| **EPAP** | Expiratory Positive Airway Pressure |
| **IPAP** | Inspiratory Positive Airway Pressure |
| **FLG** | Flow Limitation Grade: 0–1 severity of flow limitation |
| **EDF** | European Data Format: time-series biomedical file format |
| **IndexedDB** | Browser storage for structured data |
| **OPFS** | Origin Private File System: browser file storage |
| **LOESS** | Locally Estimated Scatterplot Smoothing |
| **PACF** | Partial Autocorrelation Function |
| **PELT** | Pruned Exact Linear Time (change-point detection) |
| **RDI** | Respiratory Disturbance Index: AHI + RERA |
| **RERA** | Respiratory Effort-Related Arousal |
| **STL** | Seasonal-Trend decomposition using LOESS |
| **SpO₂** | Blood oxygen saturation (%) |
| **ODI** | Oxygen Desaturation Index: desaturations per hour |

### 7.2 References

**Statistical Algorithms**:
- Cleveland, R. B., et al. (1990). "STL: A Seasonal-Trend Decomposition Procedure Based on Loess." *Journal of Official Statistics*.
- Killick, R., et al. (2012). "Optimal Detection of Changepoints with a Linear Computational Cost." *Journal of the American Statistical Association*.
- Arthur, D., & Vassilvitskii, S. (2007). "k-means++: The Advantages of Careful Seeding." *SODA*.
- Welford, B. P. (1962). "Note on a Method for Calculating Corrected Sums of Squares and Products." *Technometrics*.

**Clinical Standards**:
- American Academy of Sleep Medicine. (2023). *The AASM Manual for the Scoring of Sleep and Associated Events: Rules, Terminology and Technical Specifications.*
- Berry, R. B., et al. (2012). "Rules for Scoring Respiratory Events in Sleep." *Journal of Clinical Sleep Medicine*.

**Numerical Methods**:
- Beasley, J. D., & Springer, S. G. (1977). "Algorithm AS 111: The Percentage Points of the Normal Distribution." *Applied Statistics*.
- Press, W. H., et al. (2007). *Numerical Recipes: The Art of Scientific Computing* (3rd ed.). Cambridge University Press.

---

**Document Status**: Complete. Ready for implementation.
