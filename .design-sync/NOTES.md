# design-sync notes — cpap-analyzer

Repo-specific gotchas for future syncs. Read this first.

## Source shape / entry

- This repo is the **CPAP Analyzer app**, not a standalone component library. There is **no library `dist`** — `dist/` is the built _app_. The converter runs in **synth-entry mode** (`[NO_DIST]` is expected, not an error).
- `node_modules/cpap-analyzer` is a **self-symlink to the repo root** (`ln -sfn ../ node_modules/cpap-analyzer`). The converter needs `PKG_DIR = <node_modules>/<pkg>` to exist; a self-repo has no self-install. **Recreate this symlink on a fresh clone** (it lives under gitignored node_modules). Without it the build dies with `ENOENT … node_modules/cpap-analyzer/package.json`.
- `cfg.srcDir = "src/components/ui"` scopes discovery + the synthesized entry to the design-system layer only (the `ui/` primitives), NOT the whole 75-component app. Widening scope means widening `srcDir` or adding `componentSrcMap` pins.

## Scope decisions

- Synced set = the 18 `src/components/ui/**` primitives + `tokens.css`. Product owner scoped to "ui/ primitives + tokens" on the first sync (2026-07-03).
- Pruned via `componentSrcMap: null`: `TableHeader/TableBody/TableRow/TableHead/TableCell` (structural sub-parts — composed inside the Table preview), `ToastProvider`/`TooltipProvider` (context providers, no standalone visual). Toasts are shown via the `useToast()` hook (interaction-driven) — not a static card.

## Props / .d.ts

- Synth-entry mode can't extract real props from source (`.d.ts` comes out as `{ [key: string]: unknown }`). Every component's real props are hand-written in `cfg.dtsPropsFor` — the authoritative API contract the design agent sees. **When a `ui/` component's props change, update `dtsPropsFor` for it.** The `Icon` `name` union is enumerated there in full.

## CSS / tokens

- Global CSS lives in `src/styles/{tokens,reset,base}.css`, aggregated by `src/index.css` (which uses `@import`). Do NOT set `cfg.cssEntry = src/index.css` — the converter appends its raw `@import "./styles/*.css"` lines into `_ds_bundle.css` without copying the files (`[CSS_IMPORT_MISSING]` + `[TOKENS_MISSING]`). Instead ship them via `cfg.tokensPkg = "cpap-analyzer"` + `cfg.tokensGlob = "src/styles/*.css"` (tokensGlob only activates alongside tokensPkg). Component styles are CSS Modules, auto-bundled into `_ds_bundle.css`.
- Dark theme is self-contained in `tokens.css` (`[data-theme]`). Cards render the light/default theme.

## Fonts

- No webfonts ship. `--font-family-sans` and `--font-family-mono` are pure system stacks. `[FONT_MISSING] "Cascadia Code"` is a **false positive**: it's one named entry in the mono fallback stack (`ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, …`) led by `ui-monospace`; there is nothing to ship. Suppressed via `cfg.runtimeFontPrefixes: ["Cascadia Code"]`. This is NOT a font service — it's a system stack; the substitute (the rest of the stack) IS the design intent.

## KaTeX (MathText / MathEquation)

- These render LaTeX via KaTeX `output: 'html'`, which needs `katex.min.css` (layout rules) **and** KaTeX's woff2 fonts. The app loads them globally in `src/main.tsx` (`import 'katex/dist/katex.min.css'`), but the ui-only synth bundle doesn't, so math first rendered as **garbled fallback text** (fractions/subscripts collapsed).
- Fix: `.design-sync/assets/katex.css` is a **generated, self-contained** copy of `katex.min.css` with all 20 woff2 fonts inlined as data URIs and the woff/ttf fallbacks stripped (esbuild has no `.ttf` loader, and inlining sidesteps font-path resolution entirely). It's wired via `cfg.cssEntry` (appended into `_ds_bundle.css`, which is in the styles.css closure). ~359 KB.
- **Regenerate if katex is upgraded**: the one-liner reads `node_modules/katex/dist/katex.min.css` + `fonts/*.woff2`, strips `,url(...woff|ttf) format(...)` clauses, and base64-inlines `url(fonts/*.woff2)`. See git history / the sync transcript for the exact script.
- Do NOT try to bundle katex.css through `extraEntries` (a JS side-effect import) — esbuild dies on the `.ttf` fallback (`No loader is configured for ".ttf"`).

## Overlays (Dialog / Popover / DropdownMenu / Tooltip)

- **Dialog** exposes `open` → the preview forces it open and shows the full modal. Needs `cfg.overrides.Dialog = {cardMode: single, viewport: "720x520"}` so the fixed-position portal overlay is framed inside the card.
- **Popover / DropdownMenu / Tooltip** expose NO `open`/`defaultOpen` — Radix opens them on interaction only. Their static cards deliberately show the **closed trigger** (the honest static state); the floating content/items are documented in each component's `.d.ts`/`.prompt.md`. This is not a defect to "fix" — there is no static open path through the wrapped API.
- **Tooltip** requires a `TooltipProvider` ancestor — composed inside `Tooltip.tsx` (imported from the bundle). `Table.tsx` composes the pruned `TableHeader/Body/Row/Head/Cell` sub-parts (still bundle exports).

## Known render warns

- Pre-authoring, several components showed `[RENDER_BLANK]`/floor cards (default crash-prevention render had no content). All 18 are now authored, so these are gone. No standing warns to record.

## Re-sync risks

- The self-symlink and synth-entry mode mean output quality depends on `dtsPropsFor` staying in sync with source. A prop added to a `ui/` component silently won't appear in the contract until `dtsPropsFor` is updated.
- `dtsPropsFor` bodies are hand-maintained snapshots of the source interfaces — they can drift from the real components. On re-sync, spot-check a couple against source.
