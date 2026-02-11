# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Calendar Versioning](https://calver.org/) with the format `YYYY.0M.MICRO`.

## [Unreleased]

### Added

- Initial project scaffolding and repository structure
- Project documentation and design specification
- Agent and skill definitions for AI-assisted development workflow
- CI/CD pipeline configuration via GitHub Actions
- Pre-commit hooks for code quality enforcement
- Complete TypeScript domain type system (`src/types/`) covering sessions, events, signals, analysis, plugins, errors, settings, and storage
- Design token system with CSS custom properties for light and dark themes (`src/styles/tokens.css`)
- CSS reset and base typography styles (`src/styles/reset.css`, `src/styles/base.css`)
- Theme provider with system preference detection, localStorage persistence, and real-time OS preference tracking
- 16 design system components built on Radix UI primitives (Button, Card, Input, Badge, Select, Switch, Tabs, Dialog, Tooltip, Accordion, Toast, Skeleton, Table, DropdownMenu, Popover, Slider)
- Application shell with sidebar navigation layout and responsive design
- React Router v6 routing with lazy-loaded views for all application sections (Dashboard, Sessions, Analysis, Reports, Data Management, Settings, Help)
- Zustand stores for application state (useAppStore), persisted settings (useSettingsStore), and data cache (useDataStore)
- Three-tier error boundary system (Root, Route, Component level) with recovery actions
- Bidirectional URL state sync hook for deep-linkable date ranges and session selection
- 113 unit tests across 15 test files
- E2E tests for navigation, theme switching, and responsive layout
