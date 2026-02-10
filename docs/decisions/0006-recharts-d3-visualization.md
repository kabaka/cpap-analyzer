# 0006 — Recharts and D3.js for Data Visualization

## Status

Accepted

## Context

CPAP Analyzer must visualize years of high-frequency time-series data (25–50 Hz, potentially hundreds of millions of data points) with clinical precision. Visualization requirements include:

- Time-series charts (nightly metrics over months/years)
- High-frequency signal waveforms (Flow, Pressure @ 25 Hz)
- Statistical plots (histograms, box plots, scatter plots, correlation matrices)
- Heatmaps and cluster visualizations
- Interactive features (zoom, pan, crosshairs, tooltips, annotations)
- Responsive performance with large datasets
- Accessibility (WCAG AA compliance, keyboard navigation, screen reader support)
- Multiple synchronized charts
- Export capabilities (PNG, SVG, CSV)

Performance targets:

- Render < 1k points in < 100ms (standard charts)
- Render 10k points in < 500ms
- Render 1M+ points (downsampled to 2k) in < 200ms
- Zoom/pan interactions < 50ms
- 60 FPS for crosshair updates (< 16ms)

Alternatives evaluated:

- **Recharts only**: React-native, declarative, good for standard charts, but struggles with > 10k points
- **Victory**: React-native, strong animation support, but performance issues with large datasets, 60 KB gzipped
- **nivo**: Beautiful defaults, React-native, but limited customization for clinical precision, 40 KB gzipped
- **Plotly.js**: Feature-rich, excellent 3D support, but massive bundle (800 KB gzipped), overkill for our needs
- **Chart.js**: Popular, lightweight, but imperative API less natural with React, limited time-series features
- **Apache ECharts**: Excellent performance, massive feature set, WebGL rendering, but 150 KB gzipped and imperative API complex for React integration
- **D3.js only**: Maximum control, ultimate flexibility, but requires building everything from primitives, steep learning curve
- **Custom Canvas renderer**: Maximum performance, full control, but must implement all charting logic from scratch

## Decision

Adopt **hybrid approach**:

- **Recharts** for standard charts with < 10k points (dashboard cards, analysis results, distributions)
- **D3.js** for custom high-performance visualizations (high-frequency signals, complex custom charts)
- **Custom Canvas renderer** with D3.js utilities for ultra-high-frequency data (> 100k points)

Architecture:

```text
Visualization Containers (data fetching, state)
  ↓
Chart Components (common props, interactivity)
  ↓
  ├── Recharts (standard charts: line, bar, scatter, histogram)
  ├── D3 + React (custom visualizations: heatmaps, clusters)
  └── Canvas + D3 (high-frequency time-series: signal waveforms)
```

Recharts use cases:

- Dashboard summary cards (nightly metrics)
- Trend analysis charts (1 year = ~365 points)
- Distribution plots (histograms, box plots)
- Scatter plots (pressure vs AHI, < 1000 sessions)
- Bar charts (event counts)

D3.js use cases:

- Correlation matrices with custom coloring
- Event clustering dendrograms
- Kaplan-Meier survival curves
- Custom statistical plots not available in Recharts

Custom Canvas + D3.js use cases:

- Signal viewer (Flow @ 25 Hz, 8 hours = 720k samples)
- Multi-night signal overview (weeks of data)
- High-resolution waveforms with zoom/pan

Level-of-detail (LOD) downsampling:

- LTTB (Largest Triangle Three Buckets) algorithm reduces data to 2k-5k points while preserving visual features
- Min-max downsampling for signal envelope visualization
- Viewport-based filtering (only render visible data)

## Consequences

### Positive

- Recharts provides declarative React-native API ideal for AI agent code generation
- Recharts handles standard charts efficiently with minimal code
- D3.js provides ultimate flexibility for custom clinical visualizations not available in Recharts
- Canvas rendering achieves 60 FPS with millions of data points through LOD downsampling
- Combined bundle size reasonable: Recharts ~50 KB + D3 subset ~30 KB = 80 KB gzipped (within budget)
- Recharts accessibility features (ARIA labels, keyboard nav) work out of the box
- D3's data manipulation utilities (scales, axes, shapes) reduce custom code
- Can progressively migrate from Recharts to D3.js for charts needing more control
- Web Worker downsampling keeps UI thread responsive during heavy computation

### Negative

- Two charting paradigms to maintain: declarative Recharts vs imperative D3.js
- Recharts performance degrades with > 10k points, requiring data preprocessing
- D3.js learning curve steep for complex visualizations
- Custom Canvas renderer requires implementing tooltips, crosshairs, legends from scratch
- Accessibility harder with Canvas (must provide text alternatives, keyboard navigation)
- Recharts animation features may need to be disabled for performance
- Must manage lifecycle of Canvas elements in React carefully (refs, effects)
- Debugging Canvas rendering more difficult than DOM-based charts

### Neutral

- Recharts includes full D3 as dependency, so no additional bundle cost for D3 shapes/scales usage
- D3.js is modular; can import only needed functions to minimize bundle size
- Both libraries widely used, extensive documentation and examples available
- Recharts responsive container handles resize automatically
- D3.js requires manual resize handling but provides more control
