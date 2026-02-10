# 0003 — Radix UI Primitives for Accessible Components

## Status

Accepted

## Context

CPAP Analyzer requires accessible, customizable UI components (modals, dropdowns, tooltips, etc.) that meet WCAG AA standards. The application serves medical patients who may have accessibility needs, and component accessibility is non-negotiable.

Constraints:

- WCAG AA compliance required for all interactive components
- Full design control needed to implement custom design system
- Small bundle size critical (initial bundle < 250 KB gzipped)
- Strong TypeScript support essential for AI agent development
- Must handle keyboard navigation, focus management, ARIA attributes correctly
- Testing should use standard patterns without framework-specific utilities

Options evaluated:

- **Pre-built component libraries (Material UI, Ant Design)**: ~200 KB gzipped, enforce their own design language, difficult to fully customize, large bundle overhead
- **shadcn/ui**: Pre-built components using Radix + Tailwind, but Tailwind adds unnecessary complexity and CSS overhead
- **Headless UI**: Similar to Radix but Radix has superior TypeScript support and more comprehensive primitive set
- **Pure custom components**: Maximum control but requires implementing all accessibility from scratch with high bug risk for ARIA, keyboard nav, focus management

## Decision

Build custom components on **Radix UI primitives** (@radix-ui/react-* packages).

Radix primitives used:

- `@radix-ui/react-dialog` for modals (import wizard, settings, confirmations)
- `@radix-ui/react-dropdown-menu` for dropdowns (date range presets, chart options)
- `@radix-ui/react-tooltip` for tooltips (metric definitions, help icons)
- `@radix-ui/react-select` for select inputs (analysis method selection)
- `@radix-ui/react-tabs` for navigation and tabbed content
- `@radix-ui/react-accordion` for collapsible sections (settings, help)
- `@radix-ui/react-popover` for advanced controls
- `@radix-ui/react-switch` for toggle switches (theme, settings)
- `@radix-ui/react-slider` for range inputs (date range, zoom controls)

Architecture:

```text
Application Components
  ↓
Design System Components (styled to match design system)
  ↓
Radix UI Primitives (unstyled, accessible)
  ↓
React + DOM
```

## Consequences

### Positive

- WCAG AA accessibility built-in: ARIA attributes, keyboard navigation, focus management handled correctly out of the box
- Full design control: unstyled primitives allow exact implementation of custom design system without fighting CSS overrides
- Small bundle size: tree-shakeable (only import what you use), each primitive 2-5 KB gzipped, total ~20 KB for all primitives
- Excellent TypeScript definitions with strong type inference for AI agents
- Testing-friendly: standard component testing patterns work, no magic or framework-specific utilities
- Reduces accessibility bugs from AI-generated code by delegating complex behavior to proven library
- Each primitive is battle-tested by thousands of production applications
- Future-proof: Radix follows web standards and ARIA authoring practices

### Negative

- Requires building styled wrapper components for each primitive (initial development overhead)
- Composition API requires understanding Radix patterns (e.g., Dialog.Root, Dialog.Trigger, Dialog.Content)
- Documentation for styling is less prescriptive than pre-built component libraries
- Must maintain consistency across custom components without library's built-in design system

### Neutral

- Primitives are intentionally low-level, providing flexibility at cost of initial setup
- Styling approach is framework-agnostic (we use CSS Modules)
- Updates to primitives require testing custom wrapper components
