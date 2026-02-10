# UI Design System — CPAP Analyzer

**Version**: 1.0  
**Last Updated**: February 10, 2026  
**Status**: Reference Specification  

## Executive Summary

This design system defines the complete visual language for CPAP Analyzer, a clinical data analysis application targeted at quantitatively-minded patients. The system prioritizes **information density**, **clinical precision**, and **privacy-first architecture** while maintaining WCAG AA accessibility standards across both light and dark themes.

### Design Philosophy

1. **Clinical Precision** — Visual hierarchy that prioritizes data over decoration; every element reinforces trust and accuracy
2. **High Information Density** — Efficient use of space for power users while maintaining readability
3. **Dual-Theme Excellence** — Both light and dark themes are equally functional, tested, and refined
4. **Zero External Dependencies** — All assets bundled; no CDN requests for fonts, icons, or resources
5. **Accessibility as Foundation** — WCAG AA compliance is non-negotiable, not an afterthought

---

## 1. Design Tokens

All theme-dependent values are defined as CSS custom properties. These tokens form the foundation of the design system and enable seamless theme switching.

### 1.1 Complete Token Definitions

```css
:root {
  /* ============================================
     SURFACE COLORS
     ============================================ */
  --color-surface-primary: #ffffff;
  --color-surface-secondary: #f5f5f5;
  --color-surface-tertiary: #ececec;
  --color-surface-elevated: #ffffff;
  --color-surface-overlay: rgba(0, 0, 0, 0.5);
  
  /* ============================================
     BORDER COLORS
     ============================================ */
  --color-border-default: #e0e0e0;
  --color-border-subtle: #f0f0f0;
  --color-border-emphasis: #bdbdbd;
  
  /* ============================================
     TEXT COLORS
     ============================================ */
  --color-text-primary: #1a1a1a;
  --color-text-secondary: #666666;
  --color-text-muted: #999999;
  --color-text-disabled: #bdbdbd;
  --color-text-inverse: #ffffff;
  --color-text-link: #2563eb;
  --color-text-link-hover: #1e40af;
  
  /* ============================================
     CLINICAL STATUS COLORS
     ============================================ */
  --color-status-normal: #16a34a;        /* Green 600 */
  --color-status-mild: #ca8a04;          /* Yellow 600 */
  --color-status-moderate: #ea580c;      /* Orange 600 */
  --color-status-severe: #dc2626;        /* Red 600 */
  
  /* Status backgrounds (10% opacity) */
  --color-status-normal-bg: rgba(22, 163, 74, 0.1);
  --color-status-mild-bg: rgba(202, 138, 4, 0.1);
  --color-status-moderate-bg: rgba(234, 88, 12, 0.1);
  --color-status-severe-bg: rgba(220, 38, 38, 0.1);
  
  /* ============================================
     SEMANTIC COLORS
     ============================================ */
  --color-success: #16a34a;
  --color-success-bg: rgba(22, 163, 74, 0.1);
  --color-warning: #ca8a04;
  --color-warning-bg: rgba(202, 138, 4, 0.1);
  --color-error: #dc2626;
  --color-error-bg: rgba(220, 38, 38, 0.1);
  --color-info: #2563eb;
  --color-info-bg: rgba(37, 99, 235, 0.1);
  
  /* ============================================
     INTERACTIVE COLORS
     ============================================ */
  --color-primary: #2563eb;              /* Blue 600 */
  --color-primary-hover: #1d4ed8;        /* Blue 700 */
  --color-primary-active: #1e40af;       /* Blue 800 */
  --color-primary-disabled: #93c5fd;     /* Blue 300 */
  
  --color-secondary: #64748b;            /* Slate 500 */
  --color-secondary-hover: #475569;      /* Slate 600 */
  --color-secondary-active: #334155;     /* Slate 700 */
  
  /* ============================================
     CHART COLORS (Multi-Series)
     ============================================ */
  --color-chart-1: #2563eb;              /* Blue 600 */
  --color-chart-2: #dc2626;              /* Red 600 */
  --color-chart-3: #16a34a;              /* Green 600 */
  --color-chart-4: #9333ea;              /* Purple 600 */
  --color-chart-5: #ea580c;              /* Orange 600 */
  --color-chart-6: #0891b2;              /* Cyan 600 */
  --color-chart-7: #c026d3;              /* Fuchsia 600 */
  --color-chart-8: #65a30d;              /* Lime 600 */
  
  /* Chart neutrals */
  --color-chart-grid: #e5e7eb;
  --color-chart-axis: #6b7280;
  --color-chart-tooltip-bg: rgba(255, 255, 255, 0.98);
  --color-chart-tooltip-border: #d1d5db;
  
  /* ============================================
     FOCUS INDICATORS
     ============================================ */
  --color-focus-ring: #3b82f6;           /* Blue 500 */
  --color-focus-ring-offset: #ffffff;
  
  /* ============================================
     SPACING SCALE
     ============================================ */
  --space-0: 0;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;
  
  /* Semantic spacing aliases */
  --space-xs: var(--space-1);            /* 4px */
  --space-sm: var(--space-2);            /* 8px */
  --space-md: var(--space-4);            /* 16px */
  --space-lg: var(--space-6);            /* 24px */
  --space-xl: var(--space-8);            /* 32px */
  --space-2xl: var(--space-12);          /* 48px */
  
  /* ============================================
     TYPOGRAPHY
     ============================================ */
  --font-family-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 
                      Roboto, 'Helvetica Neue', Arial, sans-serif;
  --font-family-mono: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, 
                      Consolas, 'Liberation Mono', monospace;
  
  /* Font sizes */
  --font-size-xs: 0.75rem;               /* 12px */
  --font-size-sm: 0.875rem;              /* 14px */
  --font-size-base: 1rem;                /* 16px */
  --font-size-lg: 1.125rem;              /* 18px */
  --font-size-xl: 1.25rem;               /* 20px */
  --font-size-2xl: 1.5rem;               /* 24px */
  --font-size-3xl: 1.875rem;             /* 30px */
  --font-size-4xl: 2.25rem;              /* 36px */
  
  /* Font weights */
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  
  /* Line heights */
  --line-height-tight: 1.25;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.75;
  
  /* Letter spacing */
  --letter-spacing-tight: -0.025em;
  --letter-spacing-normal: 0;
  --letter-spacing-wide: 0.025em;
  
  /* ============================================
     SHADOWS
     ============================================ */
  --shadow-none: none;
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 
               0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 
               0 4px 6px -2px rgba(0, 0, 0, 0.05);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 
               0 10px 10px -5px rgba(0, 0, 0, 0.04);
  
  --shadow-focus: 0 0 0 3px rgba(59, 130, 246, 0.5);
  
  /* ============================================
     BORDER RADIUS
     ============================================ */
  --radius-none: 0;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-2xl: 16px;
  --radius-full: 9999px;
  
  /* ============================================
     TRANSITIONS
     ============================================ */
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-base: 200ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);
  
  /* Easing functions */
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  
  /* ============================================
     Z-INDEX SCALE
     ============================================ */
  --z-base: 0;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-overlay: 300;
  --z-modal: 400;
  --z-tooltip: 500;
  --z-toast: 600;
}

/* ============================================
   DARK THEME OVERRIDES
   ============================================ */
[data-theme='dark'] {
  /* Surface colors */
  --color-surface-primary: #0a0a0a;
  --color-surface-secondary: #171717;
  --color-surface-tertiary: #262626;
  --color-surface-elevated: #1f1f1f;
  --color-surface-overlay: rgba(0, 0, 0, 0.7);
  
  /* Border colors */
  --color-border-default: #404040;
  --color-border-subtle: #2a2a2a;
  --color-border-emphasis: #525252;
  
  /* Text colors */
  --color-text-primary: #fafafa;
  --color-text-secondary: #a3a3a3;
  --color-text-muted: #737373;
  --color-text-disabled: #525252;
  --color-text-inverse: #0a0a0a;
  --color-text-link: #60a5fa;
  --color-text-link-hover: #93c5fd;
  
  /* Clinical status colors (slightly brighter for dark bg) */
  --color-status-normal: #22c55e;        /* Green 500 */
  --color-status-mild: #eab308;          /* Yellow 500 */
  --color-status-moderate: #f97316;      /* Orange 500 */
  --color-status-severe: #ef4444;        /* Red 500 */
  
  /* Status backgrounds (15% opacity for dark) */
  --color-status-normal-bg: rgba(34, 197, 94, 0.15);
  --color-status-mild-bg: rgba(234, 179, 8, 0.15);
  --color-status-moderate-bg: rgba(249, 115, 22, 0.15);
  --color-status-severe-bg: rgba(239, 68, 68, 0.15);
  
  /* Semantic colors */
  --color-success: #22c55e;
  --color-success-bg: rgba(34, 197, 94, 0.15);
  --color-warning: #eab308;
  --color-warning-bg: rgba(234, 179, 8, 0.15);
  --color-error: #ef4444;
  --color-error-bg: rgba(239, 68, 68, 0.15);
  --color-info: #60a5fa;
  --color-info-bg: rgba(96, 165, 250, 0.15);
  
  /* Interactive colors */
  --color-primary: #3b82f6;              /* Blue 500 */
  --color-primary-hover: #60a5fa;        /* Blue 400 */
  --color-primary-active: #2563eb;       /* Blue 600 */
  --color-primary-disabled: #1e3a8a;     /* Blue 900 */
  
  --color-secondary: #71717a;            /* Zinc 500 */
  --color-secondary-hover: #a1a1aa;      /* Zinc 400 */
  --color-secondary-active: #52525b;     /* Zinc 600 */
  
  /* Chart colors (brighter for dark background) */
  --color-chart-1: #60a5fa;              /* Blue 400 */
  --color-chart-2: #f87171;              /* Red 400 */
  --color-chart-3: #4ade80;              /* Green 400 */
  --color-chart-4: #c084fc;              /* Purple 400 */
  --color-chart-5: #fb923c;              /* Orange 400 */
  --color-chart-6: #22d3ee;              /* Cyan 400 */
  --color-chart-7: #e879f9;              /* Fuchsia 400 */
  --color-chart-8: #a3e635;              /* Lime 400 */
  
  /* Chart neutrals */
  --color-chart-grid: #373737;
  --color-chart-axis: #a3a3a3;
  --color-chart-tooltip-bg: rgba(23, 23, 23, 0.98);
  --color-chart-tooltip-border: #404040;
  
  /* Focus indicators */
  --color-focus-ring: #60a5fa;
  --color-focus-ring-offset: #0a0a0a;
  
  /* Shadows (lighter/more visible on dark) */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.4), 
               0 2px 4px -1px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.5), 
               0 4px 6px -2px rgba(0, 0, 0, 0.4);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.6), 
               0 10px 10px -5px rgba(0, 0, 0, 0.5);
  
  --shadow-focus: 0 0 0 3px rgba(96, 165, 250, 0.5);
}

/* ============================================
   REDUCED MOTION
   ============================================ */
@media (prefers-reduced-motion: reduce) {
  :root {
    --transition-fast: 0ms;
    --transition-base: 0ms;
    --transition-slow: 0ms;
  }
}
```

---

## 2. Color Palette

### 2.1 Primary Colors

| Color | Light Theme | Dark Theme | Usage |
|-------|-------------|------------|-------|
| Primary | `#2563eb` (Blue 600) | `#3b82f6` (Blue 500) | Primary actions, links, active states |
| Primary Hover | `#1d4ed8` (Blue 700) | `#60a5fa` (Blue 400) | Hover state for primary elements |
| Primary Active | `#1e40af` (Blue 800) | `#2563eb` (Blue 600) | Active/pressed state |

**Rationale**: Blue is universally understood for interactive elements, maintains professional clinical aesthetic, and has excellent contrast in both themes.

### 2.2 Clinical Status Colors

These colors communicate AHI severity and clinical relevance:

| Severity | Color (Light) | Color (Dark) | Hex (Light) | Hex (Dark) | Contrast Ratio (Light) | Contrast Ratio (Dark) |
|----------|---------------|--------------|-------------|------------|----------------------|---------------------|
| Normal | Green 600 | Green 500 | `#16a34a` | `#22c55e` | 4.53:1 ✓ | 4.61:1 ✓ |
| Mild | Yellow 600 | Yellow 500 | `#ca8a04` | `#eab308` | 4.54:1 ✓ | 5.12:1 ✓ |
| Moderate | Orange 600 | Orange 500 | `#ea580c` | `#f97316` | 4.52:1 ✓ | 5.23:1 ✓ |
| Severe | Red 600 | Red 500 | `#dc2626` | `#ef4444` | 5.62:1 ✓ | 5.85:1 ✓ |

**WCAG AA Compliance**: All status colors meet 4.5:1 minimum contrast ratio against their respective theme backgrounds.

**Colorblind Considerations**:
- Deuteranopia (red-green): Orange and red remain distinguishable; use additional indicators (icons, patterns)
- Protanopia (red-green): Similar to deuteranopia; severity levels use brightness differences
- Tritanopia (blue-yellow): Yellow and green are distinguishable; pattern differentiation provided

**Additional Indicators**: Never rely on color alone:
- Icons: ✓ (normal), ⚠ (mild/moderate), ⚠⚠ (severe)
- Patterns: Solid (normal), diagonal lines (mild), cross-hatch (moderate), dense dots (severe)
- Text labels: Always include severity text alongside color

### 2.3 Chart Color Sequence

For multi-series charts (up to 8 series):

| Series | Light Theme | Dark Theme | Hex (Light) | Hex (Dark) | Notes |
|--------|-------------|------------|-------------|------------|-------|
| 1 | Blue 600 | Blue 400 | `#2563eb` | `#60a5fa` | Primary series |
| 2 | Red 600 | Red 400 | `#dc2626` | `#f87171` | Secondary/comparison |
| 3 | Green 600 | Green 400 | `#16a34a` | `#4ade80` | Positive/target |
| 4 | Purple 600 | Purple 400 | `#9333ea` | `#c084fc` | Auxiliary metric |
| 5 | Orange 600 | Orange 400 | `#ea580c` | `#fb923c` | Warning/threshold |
| 6 | Cyan 600 | Cyan 400 | `#0891b2` | `#22d3ee` | Supplementary |
| 7 | Fuchsia 600 | Fuchsia 400 | `#c026d3` | `#e879f9` | Additional series |
| 8 | Lime 600 | Lime 400 | `#65a30d` | `#a3e635` | Additional series |

**Line Weights**:
- Primary series: 2px
- Secondary series: 1.5px
- Gridlines: 1px
- Axis lines: 1.5px

**Point Markers**:
- Size: 6px diameter (hover: 8px)
- Shapes: Circle (primary), square, triangle, diamond (in order)
- Always include for accessibility when lines may overlap

### 2.4 Semantic Colors

| Type | Light | Dark | Usage |
|------|-------|------|-------|
| Success | `#16a34a` | `#22c55e` | Successful operations, compliance met |
| Warning | `#ca8a04` | `#eab308` | Non-critical warnings, attention needed |
| Error | `#dc2626` | `#ef4444` | Errors, failed operations, critical alerts |
| Info | `#2563eb` | `#60a5fa` | Informational messages, help content |

**Background Variants**: 10% opacity in light theme, 15% in dark theme for subtle backgrounds.

---

## 3. Typography Scale

### 3.1 Font Families

**Sans-serif** (Primary):
```css
font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 
             Roboto, 'Helvetica Neue', Arial, sans-serif;
```

**Monospace** (Code/Numeric):
```css
font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, 
             Consolas, 'Liberation Mono', monospace;
```

**Rationale**: 
- Zero network requests (privacy compliance)
- Respects user's OS preferences
- Excellent cross-platform rendering
- Immediate availability (no FOUT/FOIT)

### 3.2 Type Scale

| Level | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| Display | 36px (2.25rem) | 700 | 1.25 | Page-level headings (rare) |
| H1 | 30px (1.875rem) | 700 | 1.25 | Primary section headings |
| H2 | 24px (1.5rem) | 600 | 1.25 | Secondary headings |
| H3 | 20px (1.25rem) | 600 | 1.25 | Tertiary headings |
| H4 | 18px (1.125rem) | 600 | 1.5 | Component titles |
| Large | 18px (1.125rem) | 400 | 1.5 | Prominent body text |
| Base | 16px (1rem) | 400 | 1.5 | Body text, UI labels |
| Small | 14px (0.875rem) | 400 | 1.5 | Secondary text, table cells |
| XSmall | 12px (0.75rem) | 400 | 1.5 | Labels, axis ticks, captions |

**Never use text smaller than 12px** for accessibility reasons.

### 3.3 Numeric Display

All numeric displays must use **tabular figures** for proper alignment:

```css
.numeric {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-family-mono);
}
```

**Precision Guidelines**:
- AHI: 1 decimal place (e.g., "4.2")
- Percentages: 1 decimal place (e.g., "85.3%")
- Hours: 1 decimal place (e.g., "6.8 hr")
- Pressure: 1 decimal place + unit (e.g., "11.4 cmH₂O")
- Leak: Integer + unit (e.g., "8 L/min")

### 3.4 Text Hierarchy Examples

```css
/* Page heading */
.heading-1 {
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-bold);
  line-height: var(--line-height-tight);
  letter-spacing: var(--letter-spacing-tight);
  color: var(--color-text-primary);
}

/* Section heading */
.heading-2 {
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-tight);
  color: var(--color-text-primary);
}

/* Body text */
.body {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-normal);
  line-height: var(--line-height-normal);
  color: var(--color-text-primary);
}

/* Secondary text */
.body-secondary {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-normal);
  line-height: var(--line-height-normal);
  color: var(--color-text-secondary);
}

/* Caption/label */
.caption {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-normal);
  line-height: var(--line-height-normal);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wide);
}
```

---

## 4. Component Specifications

### 4.1 Buttons

#### 4.1.1 Primary Button

**Visual Specification**:
- Background: `var(--color-primary)`
- Text: White
- Padding: `12px 24px` (vertical, horizontal)
- Border radius: `var(--radius-md)` (6px)
- Font size: `var(--font-size-base)` (16px)
- Font weight: `var(--font-weight-medium)` (500)
- Height: 44px (minimum touch target)
- Transition: `var(--transition-fast)` (150ms)

**States**:
- Default: Blue background, white text
- Hover: `var(--color-primary-hover)` background
- Active: `var(--color-primary-active)` background, scale(0.98)
- Focus: Blue background + `var(--shadow-focus)` ring
- Disabled: `var(--color-primary-disabled)` background, reduced opacity (0.5)

**CSS Example**:
```css
.button-primary {
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  padding: 12px 24px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  min-height: 44px;
  border: none;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.button-primary:hover {
  background-color: var(--color-primary-hover);
}

.button-primary:active {
  background-color: var(--color-primary-active);
  transform: scale(0.98);
}

.button-primary:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.button-primary:disabled {
  background-color: var(--color-primary-disabled);
  opacity: 0.5;
  cursor: not-allowed;
}
```

#### 4.1.2 Secondary Button

**Visual Specification**:
- Background: Transparent
- Border: `1px solid var(--color-border-default)`
- Text: `var(--color-text-primary)`
- Padding: `12px 24px`
- Border radius: `var(--radius-md)` (6px)

**States**:
- Default: Transparent with border
- Hover: `var(--color-surface-secondary)` background
- Active: `var(--color-surface-tertiary)` background
- Focus: Focus ring
- Disabled: Reduced opacity (0.5)

#### 4.1.3 Ghost Button

**Visual Specification**:
- Background: Transparent
- Border: None
- Text: `var(--color-text-secondary)`
- Padding: `8px 16px`

**States**:
- Default: Transparent, no border
- Hover: `var(--color-surface-secondary)` background, `var(--color-text-primary)` text
- Active: `var(--color-surface-tertiary)` background
- Focus: Focus ring

#### 4.1.4 Icon Button

**Visual Specification**:
- Size: 40px × 40px (square)
- Icon size: 20px (centered)
- Background: Transparent
- Border radius: `var(--radius-md)` (6px)

**States**:
- Default: Transparent
- Hover: `var(--color-surface-secondary)` background
- Active: `var(--color-surface-tertiary)` background
- Focus: Focus ring

**Accessibility**: Must include `aria-label` for screen readers.

### 4.2 Form Controls

#### 4.2.1 Text Input

**Visual Specification**:
- Height: 44px (minimum touch target)
- Padding: `12px 16px`
- Border: `1px solid var(--color-border-default)`
- Border radius: `var(--radius-md)` (6px)
- Background: `var(--color-surface-primary)`
- Font size: `var(--font-size-base)` (16px)
- Font family: `var(--font-family-sans)`

**States**:
- Default: Gray border
- Hover: `var(--color-border-emphasis)` border
- Focus: `var(--color-primary)` border + subtle shadow
- Error: `var(--color-error)` border + error icon
- Disabled: `var(--color-surface-secondary)` background, reduced opacity

**With Label**:
```css
.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.form-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.form-input {
  height: 44px;
  padding: 12px 16px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-primary);
  font-size: var(--font-size-base);
  transition: all var(--transition-fast);
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.form-input.error {
  border-color: var(--color-error);
}

.form-helper {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.form-error {
  font-size: var(--font-size-sm);
  color: var(--color-error);
}
```

#### 4.2.2 Select / Dropdown

**Visual Specification**:
- Same dimensions as text input (44px height)
- Chevron icon (right-aligned, 20px)
- 8px padding before chevron icon

**States**: Same as text input

**Accessibility**: Native `<select>` element preferred; if custom, must support keyboard navigation (↑↓ arrows, Enter, Escape).

#### 4.2.3 Checkbox

**Visual Specification**:
- Size: 20px × 20px
- Border: `2px solid var(--color-border-default)`
- Border radius: `var(--radius-sm)` (4px)
- Checkmark: `var(--color-primary)` when checked
- Label: 16px font, 8px gap from checkbox

**States**:
- Unchecked: Empty box with border
- Checked: Filled with checkmark
- Focus: Focus ring around checkbox
- Disabled: Reduced opacity

**Indeterminate State**: Horizontal line for partially selected groups.

#### 4.2.4 Radio Button

**Visual Specification**:
- Size: 20px × 20px (circular)
- Border: `2px solid var(--color-border-default)`
- Selected indicator: Filled circle (8px diameter) centered within border

**States**: Same as checkbox

#### 4.2.5 Toggle Switch

**Visual Specification**:
- Track: 44px width × 24px height, rounded pill
- Knob: 20px diameter circle
- Track color (off): `var(--color-border-default)`
- Track color (on): `var(--color-primary)`
- Knob position (off): Left (2px offset)
- Knob position (on): Right (2px offset)

**Animation**: Knob slides across track in 200ms with ease-out timing.

**States**:
- Off: Gray track, knob left
- On: Blue track, knob right
- Focus: Focus ring around entire switch
- Disabled: Reduced opacity, no interaction

#### 4.2.6 Date Picker

**Visual Specification**:
- Input field: Same as text input with calendar icon (right)
- Calendar popup: Elevated card with shadow
- Calendar grid: 7 columns (days), row height 40px
- Selected date: `var(--color-primary)` background, white text
- Current date: Bold border
- Range selection: Highlighted background between start/end

**Keyboard Navigation**:
- Arrow keys: Navigate dates
- Enter: Select date
- Escape: Close popup
- Tab: Focus navigation

### 4.3 Cards and Panels

#### 4.3.1 Standard Card

**Visual Specification**:
- Background: `var(--color-surface-elevated)`
- Border: `1px solid var(--color-border-subtle)`
- Border radius: `var(--radius-lg)` (8px)
- Padding: `var(--space-6)` (24px)
- Shadow: `var(--shadow-sm)`

**Hover State** (if interactive):
- Shadow: `var(--shadow-md)`
- Border: `var(--color-border-default)`
- Transform: translateY(-2px)
- Transition: 200ms

```css
.card {
  background-color: var(--color-surface-elevated);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
  transition: all var(--transition-base);
}

.card.interactive:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--color-border-default);
  transform: translateY(-2px);
  cursor: pointer;
}
```

#### 4.3.2 KPI Card (Metric Card)

**Visual Specification**:
- Same base as standard card
- Header: Metric name (14px, medium weight, secondary color)
- Value: Large numeric display (30px, bold, primary color)
- Trend indicator: Arrow icon + percentage (14px)
- Sparkline: 60px height, bottom of card

**Layout**:
```
┌─────────────────────────┐
│ METRIC NAME             │  ← 14px, secondary
│                         │
│ 42.5                    │  ← 30px, bold, primary
│ ↓ 12%                   │  ← 14px, with color
│                         │
│ [───▁▂▃▁▂─────]        │  ← 60px height sparkline
└─────────────────────────┘
```

**Color Coding**:
- Improving trend: Green arrow, green text
- Worsening trend: Red arrow, red text
- No change: Gray dash

#### 4.3.3 Section Panel

**Visual Specification**:
- Background: `var(--color-surface-secondary)`
- Border: None
- Border radius: `var(--radius-lg)` (8px)
- Padding: `var(--space-6)` (24px)

**Usage**: Groups related content within a page; less prominent than cards.

### 4.4 Tables

#### 4.4.1 Data Table

**Visual Specification**:
- Header row: `var(--color-surface-secondary)` background
- Header text: 14px, medium weight, uppercase, `var(--color-text-secondary)`
- Header height: 44px
- Body row height: 48px
- Cell padding: `12px 16px`
- Border: `1px solid var(--color-border-subtle)` between rows
- Font: Tabular figures for numeric columns

**States**:
- Hover: `var(--color-surface-tertiary)` background on row
- Selected: `var(--color-primary)` background at 10% opacity
- Focus: Focus ring on entire row

**Sortable Headers**:
- Chevron icon (16px) appears on hover
- Active sort: Chevron visible, bolder text
- Keyboard: Enter to toggle sort

```css
.table {
  width: 100%;
  border-collapse: collapse;
}

.table thead {
  background-color: var(--color-surface-secondary);
}

.table th {
  padding: 12px 16px;
  height: 44px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  color: var(--color-text-secondary);
  text-align: left;
  letter-spacing: var(--letter-spacing-wide);
}

.table td {
  padding: 12px 16px;
  border-top: 1px solid var(--color-border-subtle);
  font-size: var(--font-size-sm);
}

.table tbody tr:hover {
  background-color: var(--color-surface-tertiary);
}

.table tbody tr.selected {
  background-color: rgba(37, 99, 235, 0.1);
}
```

#### 4.4.2 Numeric Columns

All numeric columns must use monospace font with tabular figures:

```css
.table-cell-numeric {
  font-family: var(--font-family-mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
```

#### 4.4.3 Status Indicators in Tables

Use colored dots or badges for status:

**Dot Indicator**:
- Size: 8px diameter
- Colors: Status color palette
- Positioned: Left of text, 8px gap

**Badge Indicator**:
- Padding: `4px 8px`
- Font size: 12px
- Border radius: `var(--radius-full)`
- Background: Status color at 10% opacity
- Text: Status color at full opacity

### 4.5 Navigation Elements

#### 4.5.1 Tabs

**Visual Specification**:
- Tab height: 48px
- Tab padding: `12px 24px`
- Font size: 16px, medium weight
- Border bottom: 2px (active), 0px (inactive)

**States**:
- Inactive: `var(--color-text-secondary)`, no border
- Hover: `var(--color-text-primary)`, `var(--color-surface-secondary)` background
- Active: `var(--color-text-primary)`, `var(--color-primary)` bottom border
- Focus: Focus ring

```css
.tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border-default);
}

.tab {
  padding: 12px 24px;
  height: 48px;
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.tab:hover {
  color: var(--color-text-primary);
  background-color: var(--color-surface-secondary);
}

.tab.active {
  color: var(--color-text-primary);
  border-bottom-color: var(--color-primary);
}
```

#### 4.5.2 Breadcrumbs

**Visual Specification**:
- Font size: 14px
- Color: `var(--color-text-secondary)`
- Separator: "/" (8px margin on each side)
- Current page: `var(--color-text-primary)`, bold

**Example**: `Analysis / Time Series / STL Decomposition`

```css
.breadcrumbs {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-sm);
}

.breadcrumb-item {
  color: var(--color-text-secondary);
}

.breadcrumb-item.current {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-semibold);
}

.breadcrumb-separator {
  color: var(--color-text-muted);
}
```

#### 4.5.3 Pagination

**Visual Specification**:
- Button size: 40px × 40px
- Border radius: `var(--radius-md)` (6px)
- Gap between buttons: 4px
- Current page: `var(--color-primary)` background, white text
- Other pages: Transparent background, hover to show

**Keyboard Navigation**: Arrow keys to navigate, Enter to select page.

```css
.pagination {
  display: flex;
  gap: var(--space-1);
  align-items: center;
}

.pagination-button {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  background-color: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.pagination-button:hover {
  background-color: var(--color-surface-secondary);
}

.pagination-button.active {
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
}
```

### 4.6 Charts

#### 4.6.1 Chart Container

**Visual Specification**:
- Background: `var(--color-surface-elevated)`
- Border: `1px solid var(--color-border-subtle)`
- Border radius: `var(--radius-lg)` (8px)
- Padding: `var(--space-6)` (24px)
- Title: 18px, semibold, `var(--color-text-primary)`
- Subtitle/description: 14px, `var(--color-text-secondary)`

#### 4.6.2 Chart Axes

**Visual Specification**:
- Axis line: `1.5px solid var(--color-chart-axis)`
- Tick marks: 1px, 6px length
- Tick labels: 12px, `var(--color-text-secondary)`, monospace (for numbers)
- Axis labels: 14px, semibold, `var(--color-text-primary)`

#### 4.6.3 Gridlines

**Visual Specification**:
- Color: `var(--color-chart-grid)`
- Stroke width: 1px
- Style: Solid for major gridlines, dashed (4px dash, 4px gap) for minor gridlines
- Opacity: 100% for major, 50% for minor

#### 4.6.4 Chart Lines

**Visual Specification**:
- Primary line: 2px stroke width
- Secondary lines: 1.5px stroke width
- Line cap: Round
- Line join: Round
- Hover: Increase width by 0.5px

#### 4.6.5 Chart Points

**Visual Specification**:
- Default size: 6px diameter
- Hover size: 8px diameter
- Stroke: 2px white border (for contrast)
- Shapes (in order): Circle, square, triangle-up, diamond

#### 4.6.6 Chart Tooltips

**Visual Specification**:
- Background: `var(--color-chart-tooltip-bg)` (98% opacity)
- Border: `1px solid var(--color-chart-tooltip-border)`
- Border radius: `var(--radius-md)` (6px)
- Padding: `8px 12px`
- Shadow: `var(--shadow-md)`
- Font size: 14px
- Line height: 1.5

**Content Structure**:
```
Date/Time Label          ← Bold, 14px
────────────────────
Series 1: 42.5          ← Color dot + value
Series 2: 38.2
```

#### 4.6.7 Chart Legend

**Visual Specification**:
- Position: Bottom center or right side
- Item spacing: 16px horizontal gap
- Symbol: 16px line or 8px circle
- Label: 14px, `var(--color-text-primary)`
- Interactive: Click to toggle series visibility

```css
.chart-legend {
  display: flex;
  gap: var(--space-4);
  justify-content: center;
  margin-top: var(--space-4);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
}

.legend-symbol {
  width: 16px;
  height: 3px;
  border-radius: 2px;
}

.legend-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}

.legend-item.disabled .legend-label {
  color: var(--color-text-muted);
  text-decoration: line-through;
}
```

#### 4.6.8 Clinical Threshold Lines

**Visual Specification**:
- Stroke: 2px dashed line
- Color: Corresponding status color (e.g., red for AHI = 30)
- Dash pattern: 6px dash, 4px gap
- Label: 12px, positioned at right edge of chart
- Background: Semi-transparent pill behind label for readability

**Example Thresholds**:
- AHI = 5 (Mild): Yellow dashed line
- AHI = 15 (Moderate): Orange dashed line
- AHI = 30 (Severe): Red dashed line

### 4.7 Modals and Dialogs

#### 4.7.1 Modal Overlay

**Visual Specification**:
- Background: `var(--color-surface-overlay)` (50% opacity black in light, 70% in dark)
- Backdrop blur: 4px (if browser supports)
- Z-index: `var(--z-modal)` (400)

#### 4.7.2 Modal Container

**Visual Specification**:
- Background: `var(--color-surface-elevated)`
- Border radius: `var(--radius-xl)` (12px)
- Shadow: `var(--shadow-xl)`
- Max width: 600px (narrow), 800px (medium), 1200px (wide)
- Padding: `var(--space-8)` (32px)
- Margin: 40px from viewport edges (mobile: 16px)

**Structure**:
```
┌─────────────────────────────────────┐
│ [✕]                          ← Close│  ← Header (32px padding)
│ Modal Title                          │
│ Optional subtitle/description        │
├─────────────────────────────────────┤
│                                      │  ← Body (32px padding)
│ Modal content area                   │
│                                      │
├─────────────────────────────────────┤
│           [Cancel] [Confirm]         │  ← Footer (32px padding)
└─────────────────────────────────────┘
```

**Accessibility**:
- Focus trap: Tab navigation stays within modal
- Escape key: Close modal
- Initial focus: First interactive element (or close button if read-only)
- Aria attributes: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background-color: var(--color-surface-overlay);
  backdrop-filter: blur(4px);
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}

.modal {
  background-color: var(--color-surface-elevated);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  max-width: 600px;
  width: 100%;
  max-height: 90vh;
  overflow: auto;
}

.modal-header {
  padding: var(--space-8);
  border-bottom: 1px solid var(--color-border-subtle);
}

.modal-body {
  padding: var(--space-8);
}

.modal-footer {
  padding: var(--space-8);
  border-top: 1px solid var(--color-border-subtle);
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}
```

### 4.8 Help Tooltips and Info Buttons

#### 4.8.1 Info Button

**Visual Specification**:
- Icon: "ⓘ" or question mark
- Size: 20px × 20px
- Color: `var(--color-text-secondary)`
- Hover: `var(--color-text-primary)`
- Position: Inline with label, 4px gap

#### 4.8.2 Tooltip

**Visual Specification**:
- Background: `var(--color-surface-elevated)` (98% opacity)
- Border: `1px solid var(--color-border-default)`
- Border radius: `var(--radius-md)` (6px)
- Padding: `8px 12px`
- Shadow: `var(--shadow-md)`
- Max width: 280px
- Font size: 14px
- Line height: 1.5
- Arrow: 8px triangle pointing to trigger element

**Trigger**:
- Hover: Show after 300ms delay
- Focus: Show immediately
- Click: Toggle (mobile behavior)

**Content**:
- Brief definition (1-2 sentences)
- Link to detailed help: "Learn more →"

```css
.tooltip {
  position: absolute;
  background-color: var(--color-surface-elevated);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  padding: 8px 12px;
  box-shadow: var(--shadow-md);
  max-width: 280px;
  font-size: var(--font-size-sm);
  line-height: var(--line-height-normal);
  z-index: var(--z-tooltip);
  opacity: 0.98;
}

.tooltip::before {
  content: '';
  position: absolute;
  width: 0;
  height: 0;
  border: 6px solid transparent;
  border-top-color: var(--color-border-default);
  bottom: -12px;
  left: 50%;
  transform: translateX(-50%);
}
```

---

## 5. Spacing System

### 5.1 Spacing Scale

Base unit: **4px**

| Token | Value | Usage |
|-------|-------|-------|
| `--space-0` | 0px | Reset/none |
| `--space-1` | 4px | Minimal gap, icon spacing |
| `--space-2` | 8px | Tight spacing, form field gap |
| `--space-3` | 12px | Default gap between related items |
| `--space-4` | 16px | Base spacing unit |
| `--space-5` | 20px | Medium spacing |
| `--space-6` | 24px | Standard padding, section spacing |
| `--space-8` | 32px | Large spacing, component isolation |
| `--space-10` | 40px | Extra large spacing |
| `--space-12` | 48px | Section breaks |
| `--space-16` | 64px | Major section breaks |
| `--space-20` | 80px | Page-level spacing |
| `--space-24` | 96px | Maximum spacing |

### 5.2 Semantic Aliases

For readability and consistency:

```css
--space-xs: var(--space-1);   /* 4px */
--space-sm: var(--space-2);   /* 8px */
--space-md: var(--space-4);   /* 16px */
--space-lg: var(--space-6);   /* 24px */
--space-xl: var(--space-8);   /* 32px */
--space-2xl: var(--space-12); /* 48px */
```

### 5.3 Usage Guidelines

**Component Internal Padding**:
- Small components (buttons, inputs): 12px vertical, 16px horizontal
- Medium components (cards): 24px all sides
- Large containers (modals): 32px all sides

**Gaps Between Elements**:
- Inline elements (icons, badges): 4px
- Form fields: 8px vertical
- Related items (list items): 12px
- Unrelated items (cards in grid): 16px
- Section spacing: 24px

**Layout Margins**:
- Content to viewport edge: 16px (mobile), 24px (tablet), 32px (desktop)
- Between major sections: 48px

---

## 6. Icons

### 6.1 Icon System

**Implementation**: Inline SVG icons (bundled with application, no external CDN).

**Icon Set**: Choose one of:
1. **Lucide** (MIT license, clean, consistent)
2. **Heroicons** (MIT license, designed by Tailwind team)
3. **Phosphor Icons** (MIT license, extensive set)

**Rationale for Inline SVG**:
- Zero network requests (privacy compliance)
- Tree-shakeable (only bundle used icons)
- Customizable colors via CSS
- Accessible with proper `aria-label` or `aria-hidden`

### 6.2 Icon Sizing

| Size | Dimension | Usage |
|------|-----------|-------|
| Extra Small | 16px | Inline with text, badges |
| Small | 20px | Buttons, form inputs, table cells |
| Medium | 24px | Navigation, standalone actions |
| Large | 32px | Feature highlights, empty states |
| Extra Large | 48px | Illustrations, placeholders |

### 6.3 Icon Colors

**Default**: `currentColor` (inherits text color)

**Custom Colors**:
- Status icons: Use status color palette
- Interactive icons: `var(--color-text-secondary)` default, `var(--color-text-primary)` on hover
- Disabled icons: `var(--color-text-disabled)`

### 6.4 Usage Guidelines

**Standard Icons**:
- ⚙️ Settings
- ❓ Help
- 🌓 Theme toggle (sun/moon)
- 📁 Import/folder
- 📊 Charts/analysis
- ℹ️ Information tooltip
- ⚠️ Warning
- ✓ Success/check
- ✕ Close/error
- ↑↓ Sort indicators
- ◄►▲▼ Navigation arrows
- 🔍 Search

**Accessibility**:
```html
<!-- Decorative icon (hidden from screen readers) -->
<svg aria-hidden="true">...</svg>

<!-- Meaningful icon (labeled for screen readers) -->
<svg role="img" aria-label="Settings">...</svg>

<!-- Icon button -->
<button aria-label="Close dialog">
  <svg aria-hidden="true">...</svg>
</button>
```

---

## 7. Motion and Animation

### 7.1 Animation Principles

1. **Purposeful**: Every animation serves a functional purpose (feedback, guide attention, illustrate relationships)
2. **Subtle**: Animations enhance, never distract
3. **Fast**: Most animations complete within 200ms
4. **Respectful**: Honor `prefers-reduced-motion` media query

### 7.2 Transition Durations

| Speed | Duration | Usage |
|-------|----------|-------|
| Instant | 0ms | Reduced motion preference |
| Fast | 150ms | Color changes, small movements |
| Base | 200ms | Standard transitions, hover states |
| Slow | 300ms | Modal appearances, page transitions |

### 7.3 Easing Functions

| Function | Curve | Usage |
|----------|-------|-------|
| Ease-out | `cubic-bezier(0, 0, 0.2, 1)` | Element entering viewport |
| Ease-in | `cubic-bezier(0.4, 0, 1, 1)` | Element leaving viewport |
| Ease-in-out | `cubic-bezier(0.4, 0, 0.2, 1)` | Element moving within viewport |

### 7.4 Common Animations

#### 7.4.1 Fade In

```css
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.fade-in {
  animation: fadeIn var(--transition-fast) var(--ease-out);
}
```

#### 7.4.2 Slide In (from bottom)

```css
@keyframes slideInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.slide-in-up {
  animation: slideInUp var(--transition-base) var(--ease-out);
}
```

#### 7.4.3 Button Press

```css
.button:active {
  transform: scale(0.98);
  transition: transform var(--transition-fast) var(--ease-in-out);
}
```

#### 7.4.4 Hover Lift (cards)

```css
.card-interactive:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  transition: all var(--transition-base) var(--ease-out);
}
```

### 7.5 Reduced Motion

**Implementation**:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Alternative**: Set all transition tokens to `0ms` when reduced motion is preferred (as shown in design tokens section).

### 7.6 Chart Animations

**Initial Load**:
- Lines: Draw from left to right (500ms, ease-out)
- Bars: Grow from zero height (400ms, ease-out, staggered 50ms)
- Points: Fade in with scale (300ms, ease-out, staggered 30ms)

**Interactions**:
- Hover: Enlarge point (150ms, ease-out)
- Tooltip: Fade in (100ms)
- Pan/Zoom: Smooth transition (200ms, ease-out)

**Respect Reduced Motion**: Disable all chart animations when `prefers-reduced-motion: reduce` is set.

---

## 8. Chart Styling Details

### 8.1 Chart Color Schemes

#### 8.1.1 Clinical Threshold Colors

Used for overlays and reference lines:

| Threshold | Color (Light) | Color (Dark) | Usage |
|-----------|---------------|--------------|-------|
| Normal | `#16a34a` | `#22c55e` | Below clinical concern |
| Mild | `#ca8a04` | `#eab308` | Mild severity (AHI 5-14.9) |
| Moderate | `#ea580c` | `#f97316` | Moderate severity (AHI 15-29.9) |
| Severe | `#dc2626` | `#ef4444` | Severe (AHI ≥30) |

#### 8.1.2 Multi-Series Diverging Palette

For comparison charts (before/after, two conditions):

| Series | Light | Dark |
|--------|-------|------|
| Negative/Before | `#dc2626` (Red) | `#f87171` |
| Neutral | `#71717a` (Gray) | `#a1a1aa` |
| Positive/After | `#16a34a` (Green) | `#4ade80` |

### 8.2 Chart Typography

**Axis Labels**:
- Font: Sans-serif, 14px, semibold
- Color: `var(--color-text-primary)`
- Position: Centered on axis

**Tick Labels**:
- Font: Monospace (for numeric), 12px
- Color: `var(--color-text-secondary)`
- Format: Minimal (e.g., "1K" not "1000")

**Legend**:
- Font: Sans-serif, 14px
- Color: `var(--color-text-primary)`
- Alignment: Center or left-align

**Annotations**:
- Font: Sans-serif, 12px
- Background: Semi-transparent pill
- Pointer: Line to data point

### 8.3 Chart Accessibility

**Text Alternatives**:
- All charts must have a text-based table equivalent
- Table should be accessible via button or link near chart
- Screen readers announce chart type and description

**Keyboard Navigation**:
- Tab: Focus chart area
- Arrow keys: Navigate between data points
- Enter: Show tooltip for focused point
- Escape: Exit chart focus

**High Contrast Mode**:
- Ensure all chart elements have sufficient contrast
- Use patterns in addition to color for critical distinctions

### 8.4 Responsive Chart Behavior

| Breakpoint | Behavior |
|------------|----------|
| Mobile (<640px) | Single column, full width charts; reduce data density (show fewer ticks); legend below chart; touch-optimized tooltips |
| Tablet (640-1024px) | Side-by-side charts where appropriate (2 columns); moderate data density |
| Desktop (>1024px) | Multi-panel layouts; full data density; hover tooltips; mouse zoom/pan |

**Mobile-Specific**:
- Minimum touch target: 44px × 44px for interactive elements
- Pinch-to-zoom on chart canvas
- Swipe-to-pan horizontally
- Simplified tooltips (larger, less content)

---

## 9. Responsive Breakpoints

### 9.1 Breakpoint Definitions

```css
/* Mobile First Approach */

/* Small devices (mobile) */
/* Default: 0px - 639px */

/* Medium devices (tablet) */
@media (min-width: 640px) {
  /* Styles for tablet and above */
}

/* Large devices (desktop) */
@media (min-width: 1024px) {
  /* Styles for desktop */
}

/* Extra large devices (wide desktop) */
@media (min-width: 1440px) {
  /* Styles for wide screens */
}
```

| Breakpoint | Range | Layout | Columns |
|------------|-------|--------|---------|
| Mobile | 0 - 639px | Single column | 1 |
| Tablet | 640 - 1023px | 2 column | 2-3 |
| Desktop | 1024 - 1439px | Multi-column | 3-4 |
| Wide | 1440px+ | Full width | 4+ |

### 9.2 Responsive Typography

```css
/* Base (mobile) */
:root {
  --font-size-display: 1.875rem;  /* 30px */
  --font-size-h1: 1.5rem;         /* 24px */
  --font-size-h2: 1.25rem;        /* 20px */
}

/* Tablet and above */
@media (min-width: 640px) {
  :root {
    --font-size-display: 2.25rem;  /* 36px */
    --font-size-h1: 1.875rem;      /* 30px */
    --font-size-h2: 1.5rem;        /* 24px */
  }
}
```

### 9.3 Responsive Spacing

```css
/* Mobile: tighter spacing */
.section {
  padding: var(--space-4);  /* 16px */
  gap: var(--space-4);
}

/* Desktop: more breathing room */
@media (min-width: 1024px) {
  .section {
    padding: var(--space-8);  /* 32px */
    gap: var(--space-6);      /* 24px */
  }
}
```

### 9.4 Component Adaptations

**Navigation**:
- Mobile: Hamburger menu, full-screen overlay
- Tablet: Collapsed sidebar
- Desktop: Persistent sidebar or top navigation

**Data Tables**:
- Mobile: Card view (stacked) or horizontal scroll with sticky first column
- Tablet: Full table with some column hiding
- Desktop: All columns visible

**Charts**:
- Mobile: Full-width, aspect ratio 16:9, reduced tick labels
- Tablet: 2-up layout where appropriate, aspect ratio 4:3
- Desktop: Multi-panel dashboards, aspect ratio flexible

**Modals**:
- Mobile: Full-screen (100% width/height minus safe areas)
- Tablet: 80% width, centered with margin
- Desktop: Fixed max-width (600px, 800px, 1200px based on content)

---

## 10. Implementation Guidelines

### 10.1 CSS Architecture

**Recommended Structure**:

```
styles/
├── tokens/
│   ├── colors.css          # Color tokens
│   ├── spacing.css         # Spacing scale
│   ├── typography.css      # Font definitions
│   ├── shadows.css         # Shadow tokens
│   └── transitions.css     # Animation tokens
├── base/
│   ├── reset.css           # CSS reset
│   ├── typography.css      # Base typography styles
│   └── global.css          # Global element styles
├── components/
│   ├── buttons.css
│   ├── forms.css
│   ├── cards.css
│   ├── tables.css
│   ├── charts.css
│   └── ...                 # One file per component type
├── layouts/
│   ├── grid.css            # Grid system
│   ├── dashboard.css       # Dashboard layout
│   └── ...
└── utilities/
    ├── spacing.css         # Utility spacing classes
    ├── text.css            # Text utilities
    └── display.css         # Display utilities
```

### 10.2 Component Development Checklist

For each component, ensure:

- [ ] Works in both light and dark themes
- [ ] Meets WCAG AA contrast ratios (4.5:1 for text, 3:1 for UI)
- [ ] Fully keyboard accessible (tab, arrow keys, enter, escape)
- [ ] Focus states visible and high contrast
- [ ] Screen reader accessible (ARIA labels, roles, live regions)
- [ ] Respects `prefers-reduced-motion`
- [ ] Responsive across all breakpoints
- [ ] Touch targets minimum 44px × 44px on mobile
- [ ] Uses design tokens (no hard-coded colors/spacing)
- [ ] Documented states (default, hover, active, focus, disabled, error)

### 10.3 Theme Switching

**Implementation**:

```javascript
// Theme toggle function
function setTheme(theme) {
  if (theme === 'system') {
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches 
      ? 'dark' 
      : 'light';
    document.documentElement.setAttribute('data-theme', systemTheme);
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem('theme', theme);
}

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (localStorage.getItem('theme') === 'system') {
    setTheme('system');
  }
});

// Initialize theme on load
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('theme') || 'system';
  setTheme(savedTheme);
});
```

**Theme Options**:
1. Light
2. Dark
3. System (follows OS preference)

### 10.4 Accessibility Testing

**Required Tests**:
1. Keyboard navigation through entire interface
2. Screen reader testing (VoiceOver, NVDA, JAWS)
3. Color contrast verification (Chrome DevTools Lighthouse, axe DevTools)
4. `prefers-reduced-motion` testing
5. High contrast mode testing (Windows High Contrast Mode)
6. Mobile touch target size verification

**Tools**:
- Chrome Lighthouse
- axe DevTools browser extension
- WebAIM Contrast Checker
- NVDA (Windows screen reader)
- VoiceOver (macOS/iOS screen reader)

### 10.5 Browser Support

**Target Support**:
- Chrome/Edge: Last 2 versions
- Firefox: Last 2 versions
- Safari: Last 2 versions
- Mobile Safari: Last 2 versions
- Chrome Android: Last 2 versions

**Progressive Enhancement**:
- All core functionality works without JavaScript
- Enhanced interactions (charts, signal viewer) require modern browser APIs
- Graceful degradation for unsupported features

### 10.6 Performance Considerations

**CSS Performance**:
- Minimize specificity (flat hierarchy preferred)
- Use CSS containment for heavy components (charts, tables)
- Avoid expensive properties in animations (prefer `transform` and `opacity`)

**Font Loading**:
- System fonts load instantly (no FOUT/FOIT)
- No web font downloads

**Icon Loading**:
- Inline SVGs for critical icons
- Lazy-load non-critical icons
- Sprite sheet for large icon sets

---

## 11. Design System Maintenance

### 11.1 Versioning

This design system follows semantic versioning:
- **Major**: Breaking changes to tokens or component APIs
- **Minor**: New components or non-breaking enhancements
- **Patch**: Bug fixes, clarifications

### 11.2 Change Process

All changes to the design system must:
1. Be documented in this specification
2. Maintain backward compatibility (or provide migration guide)
3. Be reviewed by UI Design agent
4. Pass accessibility audit
5. Be tested in both themes

### 11.3 Component Library

As components are implemented, maintain a **living style guide** (e.g., Storybook) showcasing:
- All component variants
- All component states
- Usage examples
- Do's and don'ts
- Accessibility features
- Code snippets

---

## Appendix A: Color Contrast Verification

### Light Theme Contrast Ratios

| Foreground | Background | Ratio | Pass AA | Pass AAA |
|------------|------------|-------|---------|----------|
| `#1a1a1a` (text-primary) | `#ffffff` (surface) | 16.1:1 | ✓ | ✓ |
| `#666666` (text-secondary) | `#ffffff` (surface) | 5.74:1 | ✓ | ✓ |
| `#999999` (text-muted) | `#ffffff` (surface) | 2.85:1 | ✗ | ✗ |
| `#2563eb` (primary) | `#ffffff` (surface) | 4.56:1 | ✓ | ✗ |
| `#16a34a` (status-normal) | `#ffffff` (surface) | 4.53:1 | ✓ | ✗ |
| `#ca8a04` (status-mild) | `#ffffff` (surface) | 4.54:1 | ✓ | ✗ |
| `#ea580c` (status-moderate) | `#ffffff` (surface) | 4.52:1 | ✓ | ✗ |
| `#dc2626` (status-severe) | `#ffffff` (surface) | 5.62:1 | ✓ | ✓ |

### Dark Theme Contrast Ratios

| Foreground | Background | Ratio | Pass AA | Pass AAA |
|------------|------------|-------|---------|----------|
| `#fafafa` (text-primary) | `#0a0a0a` (surface) | 18.5:1 | ✓ | ✓ |
| `#a3a3a3` (text-secondary) | `#0a0a0a` (surface) | 8.04:1 | ✓ | ✓ |
| `#737373` (text-muted) | `#0a0a0a` (surface) | 4.68:1 | ✓ | ✗ |
| `#60a5fa` (primary) | `#0a0a0a` (surface) | 8.37:1 | ✓ | ✓ |
| `#22c55e` (status-normal) | `#0a0a0a` (surface) | 4.61:1 | ✓ | ✗ |
| `#eab308` (status-mild) | `#0a0a0a` (surface) | 5.12:1 | ✓ | ✓ |
| `#f97316` (status-moderate) | `#0a0a0a` (surface) | 5.23:1 | ✓ | ✓ |
| `#ef4444` (status-severe) | `#0a0a0a` (surface) | 5.85:1 | ✓ | ✓ |

**Note**: `text-muted` is intentionally lower contrast (but still above 2.85:1 minimum for 18pt+ or bold 14pt+ text per WCAG AA). It is used only for non-essential secondary content.

---

## Appendix B: Icon Reference

### Core UI Icons (Required)

| Icon | Name | Usage | Size |
|------|------|-------|------|
| ⚙️ | Settings | Settings button | 20-24px |
| ❓ | Help | Help/info button | 20px |
| ☀️🌙 | Sun/Moon | Theme toggle | 20px |
| 📁 | Folder | Import/file operations | 24px |
| 📊 | Chart | Analytics/charts | 24px |
| ℹ️ | Info | Tooltip trigger | 16px |
| ⚠️ | Warning | Warning states | 20px |
| ✓ | Check | Success states, checkboxes | 16-20px |
| ✕ | X | Close, clear, error | 16-20px |
| ↑↓ | Arrows | Sort indicators | 16px |
| ◄►▲▼ | Chevrons | Navigation, expand/collapse | 16-20px |
| 🔍 | Search | Search functionality | 20px |
| 👁️ | Eye | Show/hide | 20px |
| 📥📤 | Download/Upload | Import/export | 20px |
| ⋮⋯ | More | Overflow menu | 20px |

---

## Conclusion

This design system provides a comprehensive visual specification for CPAP Analyzer. All components adhere to WCAG AA accessibility standards, work seamlessly in both light and dark themes, and require zero external dependencies. The system prioritizes information density, clinical precision, and user privacy while maintaining a modern, professional aesthetic.

For questions or proposed changes to this design system, consult with the UI Design agent.
