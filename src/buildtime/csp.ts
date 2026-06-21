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
  // The Weather & Environmental Data integration (opt-in, off by default) is
  // the first feature that makes an outbound network request. It calls the
  // keyless Open-Meteo API and ONLY these four hosts — explicit, minimal, and
  // auditable (no wildcards; nothing but exact host origins). Per the weather
  // integration design reference §4.1 and the privacy contract §5, only rounded
  // coordinates and calendar dates leave the device; no identifiers are sent.
  //
  // The AI Insights integration (opt-in, off by default; ADR 0024) adds the
  // named cloud-backend hosts below. Only the grounded metric snapshot egresses,
  // and only after explicit two-gate consent. As with weather, every entry is an
  // exact origin — no wildcards.
  'connect-src ' +
    [
      "'self'",
      // — Weather (Open-Meteo, keyless) —
      'https://archive-api.open-meteo.com',
      'https://api.open-meteo.com',
      'https://air-quality-api.open-meteo.com',
      'https://geocoding-api.open-meteo.com',
      // — AI Insights: Claude (Anthropic) browser-direct backend —
      // BYO-key cloud backend; the request carries the user's own key as the
      // auth header (never our key; we have no backend — ADR 0024 §3/§4).
      'https://api.anthropic.com',
      // — AI Insights: OpenAI-compatible backend —
      // KNOWN LIMITATION (ADR 0024 §4 "CSP"): a meta-tag CSP cannot allowlist a
      // host the user TYPES at runtime (an arbitrary OpenAI-compatible base URL)
      // without a wildcard, and a wildcard `connect-src` is unacceptable — it
      // would re-open the exfiltration surface that ADR 0015/0022 closed.
      // Resolution per the ADR: ship ONLY the named OpenAI host as an opt-in
      // preset (below) plus loopback origins for local servers; a genuinely
      // arbitrary REMOTE host is unsupported this phase rather than allowed via
      // a wildcard. (Future named presets — OpenRouter, Together — would be added
      // here as exact origins.)
      'https://api.openai.com',
      // Loopback origins for local OpenAI-compatible servers (Ollama, LM Studio)
      // so they work out of the box and keep data on-device. NOTE: connect-src
      // host syntax has no valid port wildcard, so we cannot express
      // `http://localhost:*`; these bare origins match the DEFAULT ports only
      // (http: → 80). A non-default local port (e.g. Ollama's 11434) is a known
      // limitation — see ADR 0024 §4; broadening to per-port entries or a
      // documented setup note is a follow-up for the provider wave.
      'http://localhost',
      'http://127.0.0.1',
    ].join(' '),
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
