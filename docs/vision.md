# Project Vision & Requirements

## Mission

CPAP Analyzer exists to give patients unprecedented insight into their sleep therapy data. It is a client-side web application that reads raw data directly from ResMed CPAP machines and applies rigorous statistical analysis, interactive visualization, and detailed reporting — all without any data leaving the user's browser.

This is not a simplified dashboard. It is a comprehensive analytical platform designed for patients who want to understand their therapy at the same depth as a sleep scientist. It bridges the gap between the limited summaries provided by manufacturer apps (ResMed myAir) and the complexity of clinical polysomnography software, delivering the analytical rigor of the latter in an interface accessible to the former's audience.

## Positioning

### Existing Tools and Their Limitations

**ResMed myAir / AirView**: Manufacturer-provided dashboards that show basic nightly scores and simple trend lines. They provide no control over time ranges, no statistical analysis, no event-level detail, and no data export. Data is stored on ResMed's cloud servers with limited user control.

**OSCAR (Open Source CPAP Analysis Reporter)**: A desktop application that reads SD card data and provides detailed views of individual nights with signal-level data. OSCAR is the current standard for patient self-analysis, but it is a desktop-only C++ application with a dated interface, limited aggregate analysis, and no statistical tooling beyond basic display.

**OSCAR Export Analyzer**: A web-based companion to OSCAR that imports CSV exports and applies statistical analysis (20+ methods), Fitbit correlation, and clustering algorithms. It demonstrates the demand for rigorous analysis but is limited by its CSV-based input (no raw signal access), its dependency on OSCAR for data preparation, and its prototype-level architecture.

### Where CPAP Analyzer Stands

CPAP Analyzer combines the best qualities of all three:
- **Direct machine data access** like OSCAR (reads EDF from the SD card — no intermediate tools needed)
- **Rigorous statistical analysis** like OSCAR Export Analyzer (every method it implements, and more)
- **Modern web experience** that surpasses all three (responsive, accessible, themeable, extensible)
- **Full-resolution signal rendering** (25–50 Hz waveforms with smooth zoom from years to individual breaths)
- **Extensibility** through a plugin architecture that supports new machines, analysis methods, visualizations, integrations, and export formats

## Target Audience

### Primary: Quantitative Patients

The primary audience is CPAP therapy patients with professional or academic backgrounds in data science, statistics, mathematics, bioinformatics, physics, engineering, or similar quantitative disciplines. These users:

- Understand statistical concepts (p-values, confidence intervals, correlation, regression)
- Expect configurable analysis parameters, not just preset views
- Want to see the raw data and verify computations
- May want to export data for their own analysis in R, Python, MATLAB, etc.
- Appreciate information density and do not need hand-holding in UI navigation
- May present findings to their sleep physicians and want publication-quality outputs

### Secondary: Dedicated Laypersons

The secondary audience is patients without a formal quantitative background who are motivated to deeply understand their therapy. For these users, the application provides:

- Contextual in-app help that explains every metric, analysis method, and visualization
- A comprehensive glossary of clinical and statistical terminology
- Explanations of what results mean clinically (not just mathematically)
- Progressive disclosure — insights are surfaced simply with the option to dig deeper
- Learning resources that teach the concepts needed to interpret the data

### Non-Audience

CPAP Analyzer is not designed for:
- **Sleep physicians** as a clinical tool (though patients may share its output with their doctors)
- **Compliance monitoring** by insurance companies or DME providers
- **Real-time therapy adjustment** — it analyzes historical data, not live streams

## Privacy Architecture

### Core Principle

**All data processing happens in the browser. No data leaves the user's device. Ever.**

This is not merely a preference — it is a foundational architectural constraint that informs every technical decision.

### Enforcement

- No server-side code. The application is a static site served from GitHub Pages.
- No network requests except to explicitly user-configured integration endpoints (Fitbit API, weather API, LLM API) — and each of these is opt-in.
- No analytics, telemetry, error reporting, or tracking of any kind.
- No third-party scripts, CDN-hosted fonts, or external asset loading.
- Content Security Policy (CSP) headers enforce network isolation.
- All fonts, icons, and assets are bundled with the application.

### Rationale

CPAP therapy data is protected health information (PHI). While CPAP Analyzer is a patient tool (not a covered entity under HIPAA), treating the data with the same rigor demonstrates respect for user privacy and builds trust. The client-side-only architecture makes privacy guarantees verifiable — users can inspect network traffic and confirm no data exfiltration.

### PHI Awareness

- Health data must never appear in console logs, error messages, or browser developer tools during normal operation.
- Export filenames should flag PHI content (e.g., `cpap_session_PHI.json`).
- Session export supports encryption (AES-256-GCM with PBKDF2 key derivation via Web Crypto API) for secure transport.
- Data deletion must be complete — when a user deletes their data, it is gone.

## Performance Requirements

### The Challenge

A typical CPAP user generates:
- **Per night**: ~8 hours at 25 Hz across 4-6 channels = ~4–7 million samples
- **Per year**: ~365 nights = 1.5–2.5 billion samples
- **Lifetime**: A CPAP user may be on therapy for decades

The application must handle years of this data with responsive interaction — not just during initial load, but during exploration, zooming, panning, filtering, and analysis.

### Specific Targets

| Operation | Target |
| ---- | ---- |
| Initial app load (no data) | < 2 seconds |
| SD card import (3 months of data) | < 30 seconds |
| SD card import (1 year of data) | < 60 seconds |
| Dashboard render (any date range) | < 500 ms |
| Summary data query (any date range) | < 100 ms |
| Signal data access (any time range) | < 200 ms |
| Chart zoom/pan interaction | < 16 ms (60 fps) |
| Switch between views | < 200 ms |
| Report generation | < 5 seconds |

### Implementation Strategies

- **Level-of-detail rendering**: Show downsampled data when zoomed out, increase resolution as the user zooms in, show full-fidelity data at the highest zoom levels.
- **Viewport-based loading**: Only fetch and process the time range currently visible, plus a buffer for smooth panning.
- **Web Workers**: All heavy computation (EDF parsing, statistical analysis, downsampling) runs off the main thread.
- **Transfer, not copy**: Use `ArrayBuffer.transfer()` and `Transferable` objects to move data between threads without duplication.
- **Canvas/WebGL rendering**: Use Canvas 2D or WebGL for high-density time-series plots where SVG performance would degrade.
- **Progressive rendering**: Display what is available immediately while computing the rest in the background.
- **Chunked storage**: Store signal data in time-aligned chunks for efficient random access.

## Feature Summary

### Core Features

1. **Data Import**: Read EDF data from ResMed SD cards directly in the browser, converting to an optimized binary storage format during import. Support incremental imports (only import new sessions).

2. **Summary Dashboard**: An at-a-glance overview of therapy effectiveness with KPI cards, sparklines, rolling averages, compliance metrics, and trend indicators. Configurable date range with presets (last week, last 30 days, last 90 days, all time).

3. **Session Detail View**: Drill into any individual night or sleep session with per-metric summaries, event timelines, and access to full-resolution signal data.

4. **Signal Explorer**: View raw 25–50 Hz waveform data with interactive zoom from hours-level overview to sub-second detail. Synchronized multi-channel display (flow, pressure, leak, events).

5. **Statistical Analysis**: A comprehensive suite of descriptive, time-series, correlation, hypothesis testing, survival, distribution, and clustering analyses. Configurable parameters for each analysis.

6. **Interactive Visualization**: 20+ chart types with zoom, pan, brush selection, crosshair sync, tooltips, and click-to-drill-down. Charts render at interactive frame rates with any amount of data.

7. **Report Generation**: Export analysis results as PDF reports, CSV data, or encrypted session archives. Configurable report content and formatting.

8. **In-App Help**: Contextual help accessible from every view, explaining metrics, analysis methods, visualizations, and clinical significance. A complete glossary and learning resources.

9. **Settings & Configuration**: Theme selection (light/dark), analysis parameters, display preferences, integration configuration, data management (import, export, delete).

### Extension Features (Plugin-Provided)

10. **Fitbit Integration**: Import heart rate, HRV, SpO2, and sleep stage data from Fitbit to correlate with CPAP therapy metrics.

11. **Environmental Correlation**: Import weather, air quality, pollen, and humidity data to identify environmental factors affecting therapy.

12. **LLM Integration**: Optionally connect to an LLM service to generate natural-language summaries, explanations, and recommendations. Must work without this feature — it is purely additive.

13. **Additional Machine Support**: Plugin architecture supports adding parsers for Philips Respironics, Fisher & Paykel, and other manufacturers' data formats.

## Plugin Architecture

Extensibility is a core architectural goal. The five plugin categories are:

### Machine Plugins
Each machine manufacturer has different data formats, channel definitions, event classifications, and firmware-specific quirks. Machine plugins encapsulate all manufacturer-specific knowledge:
- Data file discovery and format detection
- EDF parsing and channel mapping
- Event classification rules
- Session boundary detection
- Machine metadata extraction

### Analysis Plugins
Each statistical analysis method is a self-contained plugin:
- Input: a dataset (time series, events, metadata)
- Output: structured results (numbers, arrays, tables)
- Configuration: user-adjustable parameters
- Documentation: explanation of the method, assumptions, and interpretation

### Visualization Plugins
Each chart or visualization type:
- Renders from structured analysis results
- Supports standard interactions (zoom, pan, tooltip)
- Respects the theme system
- Provides text alternatives for accessibility

### Integration Plugins
External service connections:
- OAuth flow management
- API communication
- Data transformation and normalization
- Correlation with therapy data

### Export Plugins
Data output formats:
- PDF reports (configurable content and layout)
- CSV/TSV data export
- JSON session export (with optional encryption)
- Future: FHIR/HL7 for clinical interoperability

## LLM Integration Strategy

LLM features are optional and additive. The application must be fully functional without them.

### Potential Capabilities
- **Night summaries**: "Last night your AHI was 3.2, below your 30-day average of 4.1. You had 2 obstructive events in the first hour, which is consistent with your typical pattern."
- **Trend explanations**: "Over the past 3 months, your central apnea index has increased by 40%. This may warrant discussion with your sleep physician."
- **Chart annotations**: "This chart shows your AHI has dropped significantly since your pressure was adjusted on March 15."
- **Clinical context**: "Your Kaplan-Meier curve shows that 85% of your nights reach the 4-hour compliance threshold, which meets CMS requirements."

### Integration Approaches (To Be Evaluated)

1. **Remote MCP Server**: A Model Context Protocol server that allows users to connect their existing LLM tools (Claude, ChatGPT, etc.) to their CPAP data. The MCP server would expose data query tools that the LLM calls on demand. This approach lets users use their own accounts and models.

2. **Direct API Integration**: The app calls an LLM API directly (OpenAI, Anthropic, etc.) with user-provided API keys. Simpler to implement but requires users to manage API keys.

3. **Local LLM**: Run a small model in the browser via WebLLM or similar. Limited capability but fully private and server-free.

Each approach has tradeoffs in privacy, capability, complexity, and cost. An ADR will be written to evaluate them when LLM features enter the design phase.

## Server Re-Evaluation Criteria

The current decision is client-side only. This should be re-evaluated if any of the following become blocking requirements:

- **LLM features requiring server-side API keys** that cannot be safely handled client-side
- **Cross-device synchronization** (access data from phone, tablet, and desktop)
- **Doctor sharing** workflows that require a URL rather than a file export
- **Processing requirements** that exceed browser capabilities (very large dataset analysis, ML training)
- **Real-time collaboration** features

If a server becomes necessary, prefer serverless/edge functions (Cloudflare Workers, Vercel Edge Functions) to minimize infrastructure complexity. The core data processing must always remain available client-side.

## Conflict Resolution Priority

When design or implementation decisions involve tradeoffs, resolve in this priority order:

1. **Privacy** — No data leaves the browser. Non-negotiable.
2. **Correctness** — Statistical and clinical accuracy. No shortcuts that produce wrong results.
3. **Performance** — The app must remain responsive with large datasets.
4. **User Experience** — Beautiful, intuitive, accessible.
5. **Features** — New capabilities are welcome but not at the expense of the above.

## Regulatory Stance

CPAP Analyzer aims for regulatory-grade documentation quality without seeking formal medical device certification.

- All metrics, analysis methods, and clinical thresholds are documented with references to authoritative sources (AASM, CMS).
- Documentation clearly states that this is a patient tool for self-analysis, not a diagnostic instrument.
- The application never provides diagnostic conclusions — it presents data and analysis for the user to interpret with their healthcare provider.
- All statistical methods are documented with their assumptions, limitations, and citation of prior art.
