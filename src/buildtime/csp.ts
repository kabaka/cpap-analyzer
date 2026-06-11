import type { Plugin } from 'vite';

/**
 * Content-Security-Policy delivered via a <meta http-equiv> tag.
 *
 * GitHub Pages cannot set custom HTTP response headers, so the CSP must ride
 * along in the served HTML as a <meta> tag. It is injected at BUILD time only
 * (see cspMetaPlugin below): a static CSP in index.html would break the Vite
 * dev server, whose React-Refresh HMR injects inline module scripts and opens
 * a websocket that a strict `script-src 'self'` would block.
 *
 * Each directive is one `directive value` string so the policy is easy to read,
 * review, and extend.
 *
 * Note: `frame-ancestors`, `report-uri`, and `sandbox` are IGNORED when a CSP
 * is delivered via <meta> (they only take effect as real HTTP headers). We
 * therefore intentionally OMIT `frame-ancestors` rather than ship a directive
 * that silently does nothing. Clickjacking protection would require an HTTP
 * header (e.g. `X-Frame-Options` / `frame-ancestors`), which GitHub Pages
 * cannot send.
 */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  // 'unsafe-inline' required for inline `style=` ATTRIBUTES (not <style>
  // elements). CSP nonces/hashes only cover <style> elements and inline event
  // handlers — they do NOT cover style attributes — so 'unsafe-inline' is the
  // only mechanism that permits them:
  // - KaTeX (katex.renderToString) emits markup with inline `style=` attributes,
  //   rendered via dangerouslySetInnerHTML in
  //   src/components/ui/MathEquation/MathEquation.tsx
  // - React sets inline `style={{ '--chart-height': ... }}` as `style=`
  //   attributes, e.g. src/components/charts/ChartContainer.tsx,
  //   src/views/Settings/Settings.tsx
  "style-src 'self' 'unsafe-inline'",
  // data: + blob: needed for chart/PDF export:
  // - blob: object URLs for PNG/SVG chart export (src/components/charts/ChartContainer.tsx)
  // - data: URIs from canvas.toDataURL('image/png') in PDF reports
  //   (src/services/reports/pdf/charts.ts)
  "img-src 'self' data: blob:",
  // data: needed because Vite may inline small font files (e.g. KaTeX woff2)
  // as data: URIs even with assetsInlineLimit: 0 in edge cases.
  "font-src 'self' data:",
  // No live external network calls exist yet — Fitbit/weather/LLM integrations
  // are scaffolded in settings but unimplemented ("coming soon"). When they
  // ship, add their hosts here:
  //   https://api.fitbit.com, https://api.openweathermap.org,
  //   https://api.openai.com, https://api.anthropic.com
  "connect-src 'self'",
  // Module workers via new Worker(new URL(...), { type: 'module' }) — edfParser,
  // downsample, analysis workers. blob: is a safe fallback for bundled workers.
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  // Standard hardening:
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

/**
 * The assembled Content-Security-Policy string injected into production HTML.
 *
 * Exported so the injection can be regression-tested (see csp.test.ts) without
 * importing the entire Vite config.
 */
export const CSP_VALUE = CSP_DIRECTIVES.join('; ');

/**
 * Injects the CSP <meta http-equiv> tag into <head> at build time only.
 *
 * The tag is placed immediately after `<head>` so it precedes every other head
 * resource — a <meta> CSP only governs resources that appear after it in the
 * document, so it must come first to take effect.
 *
 * apply: 'build' ensures this never runs during `npm run dev`, so HMR is
 * unaffected. The built dist/index.html (and its dist/404.html copy) carry the
 * CSP; `npm run preview` serves dist, so the policy is testable there.
 */
export function cspMetaPlugin(): Plugin {
  return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP_VALUE}" />`;
      return html.replace('<head>', `<head>\n    ${meta}`);
    },
  };
}
