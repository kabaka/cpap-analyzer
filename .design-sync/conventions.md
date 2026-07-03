# CPAP Analyzer Design System — conventions

Components are the real, shipped `ui/` primitives of the CPAP Analyzer app (a client-side sleep-therapy data tool). Import them from the global bundle: `window.CpapDS.Button`, `window.CpapDS.Card`, etc. Build clinical, data-dense UIs with them — the audience is technically sophisticated patients.

## Setup & wrapping

- **No app-wide provider is required.** Components are styled by CSS custom properties (design tokens) defined on `:root` and shipped in `styles.css` — they work as soon as that stylesheet is loaded.
- **`Tooltip` is the one exception**: wrap it (or your subtree) in `<CpapDS.TooltipProvider>`, e.g. `<TooltipProvider><Tooltip content="…"><span>AHI</span></Tooltip></TooltipProvider>`.
- **Toasts** are imperative: render one `<CpapDS.ToastProvider>` near the root and call `const { toast } = CpapDS.useToast()` inside it. (No preview card — it's interaction-only.)
- **Dark mode**: set `data-theme="dark"` on a root element; every token flips automatically. Don't hardcode hex — read tokens.

## Styling idiom — props + tokens, NOT utility classes

This is **not** a Tailwind/utility-class system. There is no class vocabulary to compose. Style in two ways only:

1. **Configure library components through their props.** Never add `className`/CSS to restyle them.
   - `Button` — `variant="primary|secondary|ghost|danger"`, `size="sm|md|lg"`, `loading`.
   - `Badge` — `variant="default|success|warning|danger|info"`, `size="sm|md"`.
   - `Input`/`Select` — `label`, `error`, `hint`/`placeholder`, `disabled`.
   - `Slider` — `value={[n]}` (array; range = two values). `Switch` — `checked`, `label`.
   - `Icon` — `name` (one of a fixed set: `dashboard, sessions, trends, explore, reports, data, settings, help, theme-light, theme-dark, theme-system, menu, close, storage, calendar, clock, brand`), `size`. Uses `currentColor`.
   - `MathEquation` (`math`, `display`) / `MathText` (`text` with inline `$…$` / block `$$…$$`) render LaTeX via KaTeX.
   - Compound: `Table` + `TableHeader/TableBody/TableRow/TableHead/TableCell`; `Accordion`/`Tabs` take an `items`/`tabs` array; `Dialog`/`Popover`/`DropdownMenu` take a `trigger` plus content.

2. **For your OWN layout/glue, use the design tokens** (`var(--…)`), never invented values:
   - Surfaces `var(--color-surface-primary|secondary|elevated)`, text `var(--color-text-primary|secondary|muted)`, borders `var(--color-border-default|subtle)`.
   - **Clinical severity** has a dedicated scale — use it for AHI/event severity, not the generic semantic colors: `var(--color-status-normal|mild|moderate|severe)` (+ matching `-bg`). Generic feedback: `var(--color-success|warning|error|info)` (+ `-bg`).
   - Spacing `var(--space-1…24)` (4px step) or `--space-xs|sm|md|lg|xl|2xl`. Radius `var(--radius-sm|md|lg|xl|2xl|full)`. Shadows `var(--shadow-sm|md|lg|xl)`.
   - Type `var(--font-family-sans|mono)`, `var(--font-size-xs…4xl)`, `var(--font-weight-normal|medium|semibold|bold)`, `var(--line-height-normal)`.

## Where the truth lives

Before styling, read the bound `styles.css` and its `@import`s — `tokens/tokens.css` is the authoritative list of every `--*` token (light + `[data-theme='dark']`), `tokens/base.css` sets element defaults, `_ds_bundle.css` holds component styles. Each component's exact API and usage is in `components/<group>/<Name>/<Name>.d.ts` and `<Name>.prompt.md`.

## Idiomatic snippet

```jsx
const { Card, Badge, Button } = window.CpapDS;

<Card>
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 'var(--space-3)',
    }}
  >
    <div>
      <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Last night · Jul 2</h3>
      <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
        7.4 h used · 95% leak 14 L/min
      </p>
    </div>
    <Badge variant="success">AHI 3.2 · Normal</Badge>
  </div>
  <Button variant="secondary" size="sm" style={{ marginTop: 'var(--space-4)' }}>
    View details
  </Button>
</Card>;
```
