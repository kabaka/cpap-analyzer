# CPAP Analyzer

A client-side web application for in-depth analysis of CPAP therapy data from ResMed machines.

CPAP Analyzer empowers patients to take control of their therapy data with rigorous statistical analysis, interactive visualizations, and detailed reporting — all running entirely in the browser. No data leaves your device.

## Status

**Pre-development** — Project scaffolding and design phase. No functional code yet.

## Features (Planned)

- **Data Import**: Read EDF data directly from your ResMed SD card, converted on-the-fly to an optimized binary format for fast access.
- **Comprehensive Analysis**: 20+ statistical methods including trend analysis, change-point detection, correlation analysis, survival analysis, clustering, and more.
- **Interactive Visualization**: High-performance charts that handle years of full-resolution (25–50 Hz) time-series data with smooth zoom, pan, and brush selection.
- **Summary Dashboard**: At-a-glance view of key metrics with sparklines, rolling averages, and trend indicators.
- **Session Detail View**: Drill into any night or sleep session with full-fidelity signal data.
- **Report Generation**: Export PDF reports, CSV data, and encrypted session backups.
- **Plugin Architecture**: Extensible system for machine support, analysis methods, visualizations, integrations, and export formats.
- **Optional Integrations**: Fitbit (physiological correlation), weather/air quality (environmental correlation), LLM (intelligent summaries and explanations).
- **In-App Help**: Detailed, contextual documentation for every feature, metric, and analysis method.
- **Themes**: Light and dark themes with WCAG AA accessibility compliance.

## Target Audience

CPAP Analyzer is designed for patients with backgrounds in data science, mathematics, bioinformatics, or similar quantitative fields who want deep, rigorous analysis of their therapy data. The application includes enough documentation for dedicated laypersons to learn what they need to interpret the data effectively.

This is a patient tool, not a diagnostic instrument. It aims for regulatory-grade documentation quality but does not seek formal medical device certification.

## Privacy

All data processing happens in your browser. There is no server, no cloud storage, no analytics, and no telemetry. Your health data stays on your device.

## Technology

- **TypeScript** (strict mode) with **Vite** build tooling
- **Client-side only** — hosted on GitHub Pages
- **IndexedDB + OPFS** for client-side storage of years of high-frequency data
- **Web Workers** for off-main-thread data processing
- **Canvas/WebGL** for high-performance time-series rendering
- **Vitest** for unit/integration testing, **Playwright** for end-to-end testing

## Development

This project is developed entirely by a team of AI coding agents. See [AGENTS.md](AGENTS.md) for details about the development team and workflow.

### Prerequisites

- Node.js 22+
- npm

### Setup

```bash
git clone https://github.com/kabaka/cpap-analyzer.git
cd cpap-analyzer
npm install
```

### Commands

```bash
npm run dev          # Start development server
npm run build        # Production build
npm run preview      # Preview production build
npm run test         # Run unit tests (Vitest)
npm run test:e2e     # Run E2E tests (Playwright)
npm run lint         # Run ESLint
npm run format       # Run Prettier
npm run format:check # Check Prettier formatting
```

### Pre-Commit Hooks

Pre-commit hooks run automatically via Husky. They check formatting, linting, type safety, and tests. If pre-commit passes, CI will be green.

## Versioning

This project uses [Calendar Versioning](https://calver.org/) with the format `YYYY.0M.MICRO`.

## Contributing

See [AGENTS.md](AGENTS.md) for the AI agent development workflow. Human contributions are welcome via pull requests and must pass all quality gates.

## License

[MIT](LICENSE)
