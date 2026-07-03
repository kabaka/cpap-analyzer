/**
 * PHI-safe logging helper for the Google Health (Fitbit) parsers.
 *
 * The parsers in {@link module:services/import/googlehealth/parsers} catch
 * errors from `JSON.parse` / CSV parsing of imported files. A raw parse error's
 * `message` (or `stack`) can embed a fragment of the offending file content —
 * for example V8's "Unexpected token … in JSON at position N" sometimes quotes
 * the surrounding substring. Imported files are health data, so logging the raw
 * error object would write health-data-adjacent content into the devtools
 * console (it never leaves the device, but it is poor PHI hygiene).
 *
 * This module centralizes parser warnings so that the ONLY information logged is:
 * - the static `[GoogleHealth]` prefix,
 * - a static, developer-authored context string,
 * - the file name, and
 * - the error's *name* (e.g. `SyntaxError`) — never its message, stack, or the
 *   error object itself, and never any parsed data or file content.
 *
 * Warnings are gated behind `import.meta.env.DEV`, so production builds emit
 * nothing. The single `no-console` lint suppression for the whole subsystem
 * lives here.
 *
 * @module services/import/googlehealth/logging
 */

/**
 * Whether the parser warnings should be emitted at all.
 *
 * `parsers.ts` is imported from both the main thread and the
 * `fitbitParser.worker` Web Worker; Vite injects `import.meta.env.DEV` into both
 * contexts. The access is wrapped defensively so that an environment where
 * `import.meta.env` is unavailable degrades to silence rather than throwing.
 */
function isDevEnvironment(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

/**
 * Log a PHI-safe warning about a parse issue in a Google Health import file.
 *
 * In development only, emits a single `console.warn` of the shape:
 *
 * ```
 * [GoogleHealth] <context> <fileName> (<errorName>)
 * ```
 *
 * where `errorName` is `e.name` for `Error` instances (e.g. `SyntaxError`) and
 * the literal `parse error` otherwise. The raw error `message`, `stack`, the
 * error object `e`, and any parsed content are intentionally NOT logged.
 *
 * @param context  Static, developer-authored description of what failed
 *                 (e.g. "Failed to parse SpO2 intraday file").
 * @param fileName Name of the file being parsed.
 * @param e        The caught error (logged only as its type name).
 */
export function warnParseIssue(context: string, fileName: string, e: unknown): void {
  if (!isDevEnvironment()) return;
  const errorName = e instanceof Error ? e.name : 'parse error';
  // eslint-disable-next-line no-console -- centralized, PHI-safe parser warning (DEV-only)
  console.warn(`[GoogleHealth] ${context} ${fileName} (${errorName})`);
}
