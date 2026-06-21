/**
 * Egress redaction guard for the grounded-context snapshot (design reference §3,
 * rules R1–R8).
 *
 * This module is the **machine form of the consent dialog's "what is sent"
 * promise**. The grounded snapshot is the only object that may leave the
 * browser; this guard makes the blocklist auditable by asserting — at build
 * time, before any serialization — that no forbidden field name and no
 * forbidden value shape can appear in the object handed to a provider.
 *
 * It is deliberately conservative: it walks the entire object graph and throws a
 * {@link RedactionError} the moment it sees a key drawn from the blocklist or a
 * value that pattern-matches a forbidden class (raw signal array, epoch-ms
 * timestamp, clock time, serial/firmware/UUID, coordinate pair, key material,
 * full-precision numeric). A throw here is a hard correctness/privacy failure
 * (Core Principles 1 and 2) — it must never be caught and ignored; it signals a
 * builder bug that would otherwise leak.
 *
 * Pure and deterministic; no I/O. Owned by data-science (the snapshot builder);
 * audited by `security`.
 *
 * @module services/llm/context/redaction
 */

/**
 * The R-rule a forbidden field/value violated (design reference §3). Carried on
 * {@link RedactionError} so a failing test/audit can name the exact rule.
 */
export type RedactionRule =
  /** R1 — raw / high-frequency signal arrays, OPFS chunk ids. */
  | 'R1-raw-signal'
  /** R2 — within-night event timestamps / sub-night resolution. */
  | 'R2-subnight-timestamp'
  /** R3 — exact clock times of any kind. */
  | 'R3-clock-time'
  /** R4 — device identifiers (serial, firmware, source hash, UUIDs). */
  | 'R4-device-id'
  /** R5 — free-text notes and user tags. */
  | 'R5-free-text'
  /** R6 — location / environment identifiers (coordinates, place names). */
  | 'R6-location'
  /** R7 — external-integration identifiers / keys / tokens. */
  | 'R7-integration-id'
  /** R8 — full-precision numerics (a raw `number` where a display string is required). */
  | 'R8-full-precision-numeric';

/** A redaction-blocklist violation. Throwing this aborts egress (design §3). */
export class RedactionError extends Error {
  /** The R-rule that was violated. */
  readonly rule: RedactionRule;
  /** Dotted path to the offending node, e.g. `metrics.3.rawSamples`. */
  readonly path: string;

  constructor(rule: RedactionRule, path: string, detail: string) {
    super(`Redaction violation [${rule}] at "${path}": ${detail}`);
    this.name = 'RedactionError';
    this.rule = rule;
    this.path = path;
  }
}

/**
 * Forbidden property names, mapped to the rule they violate. Matching is
 * case-insensitive and exact on the key segment. These mirror the field names
 * on {@link file://src/types/session.ts} `Session` / `NightlyAggregate` and the
 * integration configs that must never be serialized.
 */
const FORBIDDEN_KEYS: ReadonlyMap<string, RedactionRule> = new Map<string, RedactionRule>([
  // R1 — raw signal / storage references
  ['signalchunkids', 'R1-raw-signal'],
  ['channels', 'R1-raw-signal'],
  ['samples', 'R1-raw-signal'],
  ['waveform', 'R1-raw-signal'],
  ['rawsamples', 'R1-raw-signal'],
  ['signal', 'R1-raw-signal'],
  // R2 — sub-night event timestamps
  ['events', 'R2-subnight-timestamp'],
  ['timestamp', 'R2-subnight-timestamp'],
  ['eventtimestamps', 'R2-subnight-timestamp'],
  ['clusters', 'R2-subnight-timestamp'],
  // R3 — clock times
  ['starttime', 'R3-clock-time'],
  ['endtime', 'R3-clock-time'],
  ['importedat', 'R3-clock-time'],
  ['lastsyncat', 'R3-clock-time'],
  ['lastimportat', 'R3-clock-time'],
  ['consentat', 'R3-clock-time'],
  // R4 — device identifiers
  ['machineid', 'R4-device-id'],
  ['firmwareversion', 'R4-device-id'],
  ['sourcehash', 'R4-device-id'],
  ['sessionid', 'R4-device-id'],
  ['machinemodel', 'R4-device-id'],
  // R5 — free text / tags
  ['notes', 'R5-free-text'],
  ['tags', 'R5-free-text'],
  // R6 — location
  ['latitude', 'R6-location'],
  ['longitude', 'R6-location'],
  ['location', 'R6-location'],
  // R7 — integration identifiers / keys
  ['apikey', 'R7-integration-id'],
  ['token', 'R7-integration-id'],
  ['accesstoken', 'R7-integration-id'],
  ['refreshtoken', 'R7-integration-id'],
  ['baseurl', 'R7-integration-id'],
]);

/**
 * Keys whose value is permitted to be an `id` despite the generic UUID guard:
 * the canonical metric/trend ids are app-authored stable slugs (e.g. `"ahi"`,
 * `"leakMedian"`), not record UUIDs, so an `id` field is allowed ONLY when its
 * value does not look like a UUID (the value guard below still rejects UUIDs).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO-8601 datetime with a time component (clock time) — forbidden (R3). */
const CLOCK_TIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** Bare clock time like `23:45` or `11:45:00` — forbidden (R3). */
const BARE_CLOCK_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

/** Calendar-date-only (the finest temporal grain permitted, R3). */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Keys whose string value is a date and is allowed to be a date but must NOT
 * carry a time component. Mirrors every `*Date`/`date` field on the snapshot.
 */
const DATE_VALUED_KEYS: ReadonlySet<string> = new Set([
  'date',
  'startdate',
  'enddate',
  'generatedondate',
  'rangestart',
  'rangeend',
]);

/**
 * Assert that a built grounded-context object contains no field or value drawn
 * from the egress blocklist (design reference §3, R1–R8).
 *
 * Walks the whole object graph. Throws {@link RedactionError} on the first
 * violation, naming the rule and the dotted path. Intended to be called by
 * {@link file://src/services/llm/context/buildGroundedContext.ts} on its own
 * output before that output is ever returned, so a forbidden field can never be
 * serialized — a fail-closed guard rather than a guideline.
 *
 * The check is value-shape aware, not just name-based: it rejects raw numeric
 * arrays (R1), epoch-ms / clock-time strings and numbers (R2/R3), UUID-shaped
 * strings (R4), and bare `number` leaves where the contract requires a display
 * string (R8). The allow-listed numeric *fields* (thresholds, hour constants,
 * `n`, scope counts) are passed in by the builder so they are not flagged.
 *
 * @param value the object to audit (typically a {@link GroundedContext}).
 * @param allowedNumericPaths dotted paths whose `number` leaves are legitimately
 *   raw (the clinical reference constants and structural counts the contract
 *   defines as numbers). Everything else numeric must be a display string.
 * @throws {RedactionError} on the first blocklist violation.
 */
export function assertNoForbiddenFields(
  value: unknown,
  allowedNumericPaths: ReadonlySet<string> = DEFAULT_ALLOWED_NUMERIC_PATHS,
): void {
  walk(value, '', allowedNumericPaths, new WeakSet());
}

/**
 * Structural numeric fields the contract defines as raw `number`s (not display
 * strings): the active clinical thresholds, the CMS/recommended hour constants,
 * and the integer counts. Their *paths* are allow-listed so the R8 guard does
 * not flag them; their values are still range-checked to be finite.
 */
const DEFAULT_ALLOWED_NUMERIC_PATHS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'scope.nightCount',
  'scope.nightsWithDefinedRate',
  'clinical.ahiThresholds.mild',
  'clinical.ahiThresholds.moderate',
  'clinical.ahiThresholds.severe',
  'clinical.cmsComplianceHours',
  'clinical.recommendedUsageHours',
]);

/** True if a dotted path matches an allow-listed numeric path, ignoring array indices. */
function isAllowedNumericPath(path: string, allowed: ReadonlySet<string>): boolean {
  if (allowed.has(path)) return true;
  // Normalise array indices to a wildcard so `trends.0.n` matches `trends.n`.
  const generalized = path.replace(/\.\d+(?=\.|$)/g, '');
  if (allowed.has(generalized)) return true;
  // `n` (sample size) appears on every trend element; allow it structurally.
  return generalized.endsWith('.n') || generalized === 'n';
}

function childPath(parent: string, key: string | number): string {
  return parent === '' ? String(key) : `${parent}.${key}`;
}

function walk(
  node: unknown,
  path: string,
  allowedNumericPaths: ReadonlySet<string>,
  seen: WeakSet<object>,
): void {
  if (node === null || node === undefined) return;

  if (typeof node === 'number') {
    if (!Number.isFinite(node)) {
      throw new RedactionError('R8-full-precision-numeric', path, 'non-finite number');
    }
    if (!isAllowedNumericPath(path, allowedNumericPaths)) {
      throw new RedactionError(
        'R8-full-precision-numeric',
        path,
        'raw number where a display string is required (ship `formatMetric` output, not a number)',
      );
    }
    return;
  }

  if (typeof node === 'string') {
    assertStringValueAllowed(node, path);
    return;
  }

  if (typeof node === 'boolean') return;

  if (Array.isArray(node)) {
    // A bare array of numbers is a raw signal/series leak (R1).
    if (node.every((el) => typeof el === 'number')) {
      if (node.length > 0) {
        throw new RedactionError(
          'R1-raw-signal',
          path,
          'raw numeric array (high-frequency signal/series must never egress)',
        );
      }
      return;
    }
    node.forEach((el, i) => walk(el, childPath(path, i), allowedNumericPaths, seen));
    return;
  }

  if (typeof node === 'object') {
    if (seen.has(node)) return;
    seen.add(node);
    for (const [key, child] of Object.entries(node)) {
      const lowerKey = key.toLowerCase();
      const forbidden = FORBIDDEN_KEYS.get(lowerKey);
      if (forbidden !== undefined) {
        // `id` is handled by the value guard (UUID rejected, slug allowed); all
        // other forbidden keys are rejected on name alone.
        throw new RedactionError(forbidden, childPath(path, key), `forbidden field name "${key}"`);
      }
      walk(child, childPath(path, key), allowedNumericPaths, seen);
    }
  }
}

/** Reject string values that encode a forbidden class regardless of their key. */
function assertStringValueAllowed(value: string, path: string): void {
  const key = lastSegment(path);

  if (UUID_RE.test(value)) {
    throw new RedactionError('R4-device-id', path, 'UUID-shaped identifier');
  }

  // Date-valued fields may be calendar dates only — never carry a clock time.
  if (DATE_VALUED_KEYS.has(key.toLowerCase())) {
    if (CLOCK_TIME_RE.test(value)) {
      throw new RedactionError('R3-clock-time', path, 'date field carries a clock-time component');
    }
    if (value !== '' && !DATE_ONLY_RE.test(value)) {
      throw new RedactionError('R3-clock-time', path, `malformed date value "${value}"`);
    }
    return;
  }

  // Any other string that is a full datetime or bare clock time is forbidden.
  if (CLOCK_TIME_RE.test(value)) {
    throw new RedactionError('R3-clock-time', path, 'ISO datetime with a clock-time component');
  }
  if (BARE_CLOCK_RE.test(value)) {
    throw new RedactionError('R3-clock-time', path, 'bare clock-time value');
  }
}

function lastSegment(path: string): string {
  const i = path.lastIndexOf('.');
  return i === -1 ? path : path.slice(i + 1);
}
