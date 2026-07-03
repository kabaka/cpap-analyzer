/**
 * Deterministic post-generation validator (design reference §5).
 *
 * The backstop that catches hallucinated figures regardless of backend. It runs
 * on the model's narrative BEFORE it is ever shown to the user and returns a
 * structured result; a failing narrative is never displayed (the orchestrator
 * regenerates once, then falls back to the non-generative template).
 *
 * Checks performed:
 * 1. **Numeral-extraction (primary).** Every numeral in the narrative must match
 *    a token in `context.numericAllowList` or a small, documented safe-literal
 *    set. A numeral not in either is a fabrication.
 * 2. **Unit consistency.** When a numeral is quoted with a unit token, that unit
 *    must be a unit the context actually attaches to a metric — a value quoted
 *    with the wrong unit is rejected.
 * 3. **Severity / compliance consistency.** If the narrative asserts a severity
 *    band or a compliance verdict, it must equal the one the context carries.
 * 4. **Reliability-hedge presence.** If any non-high / flagged metric exists in
 *    the context, the narrative must contain hedging language.
 * 5. **No-diagnosis lint.** A small banned-phrase set (diagnosis / imperative
 *    therapy-change language) triggers a violation.
 *
 * Pure and deterministic; no I/O.
 *
 * @module services/llm/grounding/validateNarrative
 */

import type { GroundedContext, MetricSnapshot } from '../context/types';

/** The category of a {@link NarrativeViolation}. */
export type ViolationKind =
  /** A numeral not present in the allow-list or the safe-literal set. */
  | 'fabricated-numeral'
  /** A value quoted with a unit the context does not attach to it. */
  | 'wrong-unit'
  /** A severity band / compliance verdict that contradicts the context. */
  | 'inconsistent-verdict'
  /** A required reliability hedge is missing. */
  | 'missing-hedge'
  /** Diagnosis or imperative therapy-change language. */
  | 'diagnosis-language';

/** One detected problem with the narrative. */
export interface NarrativeViolation {
  readonly kind: ViolationKind;
  /** The offending token / phrase, for the strengthened-regeneration reminder. */
  readonly offending: string;
  /** Human-readable explanation (for logs / the regeneration prompt). */
  readonly detail: string;
}

/** Structured validation result. `ok` is true iff `violations` is empty. */
export interface ValidationResult {
  readonly ok: boolean;
  readonly violations: readonly NarrativeViolation[];
}

/**
 * Optional declared-citations channel from a structured-output backend
 * (`{ citedNumbers, citedMetricIds }`). When present, `citedNumbers` is also
 * checked against the allow-list (a declared number outside the allow-list is a
 * fabrication even if it never appears in the prose).
 */
export interface DeclaredCitations {
  readonly citedNumbers?: readonly string[];
  readonly citedMetricIds?: readonly string[];
}

/**
 * Safe-literal allow-set (design §5 step 1): bare integers 0–10 that the model
 * may legitimately use in prose ("the first night", "all 3 nights"). Kept
 * deliberately tiny. Any other numeral must come from the context allow-list.
 */
const SAFE_LITERALS: ReadonlySet<string> = new Set(Array.from({ length: 11 }, (_, i) => String(i)));

/**
 * Tolerant numeral regex: matches non-negative integers and decimals. A leading
 * sign is intentionally NOT captured so that a hyphenated range like "5-15" or a
 * negative-looking slope embedded in prose is read as its bare magnitudes (each
 * checked independently); a genuine negative slope display string (e.g.
 * "-0.18") is matched as "0.18" and the sign is treated as the safe literal "-".
 */
const NUMERAL_RE = /\d+(?:\.\d+)?/g;

/** ISO calendar date (YYYY-MM-DD) — a legitimately quotable token (design §3). */
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;

/**
 * Month names (full and 3-letter), for the long-form date pre-pass. Models
 * routinely render the app-provided ISO scope dates in natural language
 * ("Jun 9, 2026" / "June 9, 2026" / "9 Jun 2026"); their component numerals are
 * legitimately quotable, so we strip recognizable long-form dates the same way
 * ISO dates are stripped before numeral extraction.
 */
const MONTH_NAMES =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

/**
 * Long-form calendar dates the model commonly emits. Conservative: each pattern
 * pins a month NAME against a 1–2 digit day and/or a 4-digit year, so we never
 * strip an arbitrary "<word> <number>" pair. Covers:
 *  - "Mon DD, YYYY" / "Month DD YYYY"   (e.g. "Jun 9, 2026", "June 9 2026")
 *  - "DD Mon YYYY"                      (e.g. "9 Jun 2026")
 *  - "Mon YYYY"                         (e.g. "through June 2026")
 */
const LONG_DATE_RE = new RegExp(
  [
    // Month [day][,] year  — day optional so "June 2026" is also covered.
    `\\b(?:${MONTH_NAMES})\\.?\\s+(?:\\d{1,2}(?:st|nd|rd|th)?\\s*,?\\s+)?\\d{4}\\b`,
    // DD Month YYYY
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_NAMES})\\.?\\s+\\d{4}\\b`,
  ].join('|'),
  'gi',
);

/** Unit tokens the narrative may attach, mapped to a normalized form. */
const KNOWN_UNITS: readonly string[] = [
  'events/h',
  'events per hour',
  'cmH2O',
  'cmH₂O',
  'L/min',
  'breaths/min',
  'mL',
  '%',
  'h',
  'hours',
  'min',
  'minutes',
];

/** AHI severity band words the validator recognizes in prose. */
const SEVERITY_WORDS: readonly string[] = ['normal', 'mild', 'moderate', 'severe'];

/** Compliance verdict words. */
const COMPLIANCE_WORDS: readonly string[] = [
  'compliant',
  'non-compliant',
  'noncompliant',
  'partial',
];

/** Banned diagnosis / imperative-therapy phrases (design §5 no-diagnosis lint). */
const BANNED_PHRASES: readonly string[] = [
  'you have',
  'you are diagnosed',
  'this means you are diagnosed',
  'you suffer from',
  'i diagnose',
  'increase your pressure',
  'decrease your pressure',
  'change your pressure',
  'raise your pressure',
  'lower your pressure',
  'adjust your settings',
  'stop using',
];

/** Hedging vocabulary that satisfies the mandatory-hedge check. */
const HEDGE_WORDS: readonly string[] = [
  'estimate',
  'estimated',
  'approximate',
  'modeled',
  'modelled',
  'may',
  'might',
  'caution',
  'less reliable',
  'leak-affected',
  'low coverage',
  'few events',
  'short recording',
  'interpret with care',
];

/**
 * Validate a model narrative against the grounded context (design §5).
 *
 * @param narrative the raw model output prose.
 * @param context the snapshot the narrative was generated from.
 * @param declared optional structured-output declared citations.
 * @returns a {@link ValidationResult}; `ok` is true iff no violations.
 */
export function validateNarrative(
  narrative: string,
  context: GroundedContext,
  declared?: DeclaredCitations,
): ValidationResult {
  const violations: NarrativeViolation[] = [];
  // Allow the allow-list values plus the scope counts/dates the snapshot ships
  // (they are computed app-side and are legitimately quotable). Normalize each
  // to its bare magnitude so a signed slope "-0.18" matches the prose "0.18".
  const allow = new Set<string>();
  for (const t of context.numericAllowList) allow.add(bareMagnitude(t));
  allow.add(bareMagnitude(String(context.scope.nightCount)));
  allow.add(bareMagnitude(String(context.scope.nightsWithDefinedRate)));
  // The snapshot's own calendar dates are app-authored and legitimately
  // quotable. A long-form date ("Jun 9, 2026") is stripped wholesale before
  // numeral extraction (see extractNumerals), so its day/month never reach this
  // check; the one component that can still surface on its own is the YEAR (a
  // 4-digit value, never a safe literal — e.g. "compared with early 2026").
  // Admit only the year of each scope/generation date — scoped to THESE dates,
  // never blanket 4-digit numbers. Day/month are deliberately NOT admitted: that
  // would let a fabricated small integer that happens to equal the date's
  // day-of-month slip past the numeral check, weakening the backstop.
  for (const iso of [context.scope.startDate, context.scope.endDate, context.generatedOnDate]) {
    const year = dateYear(iso);
    if (year !== null) allow.add(year);
  }
  // App-authored label/caption text legitimately contains fixed numerals (e.g.
  // "T90", "95th-percentile", "below 90%"). Those are not model-introduced
  // figures, so admit every numeral that appears in the snapshot's own labels.
  for (const token of labelNumerals(context)) allow.add(token);
  // An hours-valued metric shown as "7.3 h" is naturally restated by the model
  // in mixed units ("7 hours 18 minutes" / "7 h 18 min" / "438 minutes"). The
  // whole-hours / minutes / total-minutes restatement is a faithful re-rendering
  // of a value already in the allow-list, so admit ONLY the specific tokens that
  // an actual context hours-value decomposes to — exactly as the scope-date fix
  // admits only the years of the context's own dates. A fabricated minute that
  // does not match any context hours decomposition is still rejected. Mirrored in
  // checkUnitConsistency so "<minutes> min" is also accepted with its true unit.
  for (const d of hourDecompositions(context)) allow.add(d.token);

  // ── 1. Numeral-extraction (prose) ─────────────────────────────────────────
  for (const token of extractNumerals(narrative)) {
    if (allow.has(token) || SAFE_LITERALS.has(token)) continue;
    violations.push({
      kind: 'fabricated-numeral',
      offending: token,
      detail: `Numeral "${token}" is not in the allow-list of computed values.`,
    });
  }

  // ── 1b. Declared citations (structured backends) ──────────────────────────
  if (declared?.citedNumbers) {
    for (const token of declared.citedNumbers) {
      if (allow.has(bareMagnitude(token)) || SAFE_LITERALS.has(token)) continue;
      violations.push({
        kind: 'fabricated-numeral',
        offending: token,
        detail: `Declared cited number "${token}" is not in the allow-list.`,
      });
    }
  }

  // ── 2. Unit consistency ───────────────────────────────────────────────────
  violations.push(...checkUnitConsistency(narrative, context));

  // ── 3. Severity / compliance consistency ──────────────────────────────────
  violations.push(...checkVerdictConsistency(narrative, context));

  // ── 4. Reliability-hedge presence ─────────────────────────────────────────
  if (requiresHedge(context) && !containsAny(narrative, HEDGE_WORDS)) {
    violations.push({
      kind: 'missing-hedge',
      offending: '(no hedge)',
      detail:
        'A cited metric is non-high reliability or flagged, but the narrative contains no hedging language.',
    });
  }

  // ── 5. No-diagnosis lint ──────────────────────────────────────────────────
  const lower = narrative.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) {
      violations.push({
        kind: 'diagnosis-language',
        offending: phrase,
        detail: `Narrative contains banned diagnosis/therapy-change phrase "${phrase}".`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Extract every numeral token from text (design §5 step 2).
 *
 * Calendar dates are stripped first so a date's component numbers are not
 * mistaken for fabricated figures — dates are a permitted, separately-checked
 * token class. Both ISO form (`YYYY-MM-DD`) and the common long forms the model
 * emits ("Jun 9, 2026", "9 June 2026", "through June 2026") are stripped. The
 * long-date patterns are conservative (anchored on a month NAME), so ordinary
 * "<word> <number>" prose is untouched. Remaining numerals are matched as bare
 * non-negative magnitudes, so a hyphenated range "5-15" yields "5" and "15".
 */
export function extractNumerals(text: string): string[] {
  const withoutDates = text.replace(ISO_DATE_RE, ' ').replace(LONG_DATE_RE, ' ');
  const matches = withoutDates.match(NUMERAL_RE);
  return matches ? [...matches] : [];
}

/**
 * The year of an `YYYY-MM-DD` date — the only date component admitted to the
 * numeral allow-list (day/month are handled by long-form stripping and the
 * 0–10 safe-literal set; see the admission site for why they are not admitted).
 * Returns `null` for anything not matching the ISO shape, so a malformed date
 * never widens the allow-list.
 */
function dateYear(iso: string): string | null {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(iso);
  return m === null ? null : (m[1] ?? null);
}

/** Strip a single leading sign so signed/unsigned forms compare equal. */
function bareMagnitude(token: string): string {
  return token.startsWith('-') || token.startsWith('+') ? token.slice(1) : token;
}

/**
 * Numerals appearing in the snapshot's app-authored label/caption strings. These
 * are fixed UI text (e.g. "T90", "95th-percentile leak", "below 90%"), not
 * model-introduced figures, so the validator admits them.
 */
function labelNumerals(context: GroundedContext): string[] {
  const sources: string[] = [];
  for (const m of context.metrics) sources.push(m.label);
  for (const t of context.trends) sources.push(t.label, t.slopeUnit);
  if (context.series) {
    sources.push(context.series.chartTitle, context.series.caption, context.series.yUnit);
    for (const r of context.series.referenceLines) sources.push(r.label, r.unit);
  }
  return sources.flatMap(extractNumerals);
}

/** A decomposition token admitted from an hours-valued metric, with its unit. */
interface HourDecompositionToken {
  /** The bare numeral the model may write (e.g. "7", "18", "438"). */
  readonly token: string;
  /** The restatement unit this token is paired with ("h" or "min"). */
  readonly unit: string;
}

/**
 * Tolerance (in minutes) applied to the sub-hour MINUTES component only.
 *
 * The model sees the value already rounded to one decimal ("7.3 h") and most
 * naturally computes round(0.3 × 60) = 18. We additionally admit ±1 minute to
 * tolerate the model rounding the decimal→minutes conversion slightly
 * differently (e.g. truncating, or carrying an extra digit of the displayed
 * decimal). The window is kept to ±1: it is wide enough for benign re-rounding
 * yet far too tight to admit a fabricated minute (a made-up "42 minutes" against
 * a true 18 is rejected). The whole-hours and total-minutes restatements get NO
 * tolerance — they are exact single derivations of the displayed value.
 */
const MINUTES_TOLERANCE = 1;

/**
 * Derive the admissible H/M decomposition tokens from the context's OWN
 * hours-valued metrics (unit `h`/`hours`), mirroring how `dateYear` admits only
 * the years of the context's own dates. For a metric whose `displayValue` parses
 * to `value` hours:
 *  - whole hours  = floor(value)                      → admitted as "h"
 *  - minutes      = round((value − wholeHours) × 60)  → admitted as "min" (±1)
 *  - total minutes= round(value × 60)                 → admitted as "min" (exact)
 *
 * This admits ONLY the specific decomposition of a value already in the
 * allow-list. A fabricated minute that matches no context hours value (e.g. "42"
 * when the real 7.3 h decomposes to 18) is NOT produced here and remains a
 * fabricated-numeral violation, so the anti-fabrication backstop is intact.
 *
 * Whole-number hour values (e.g. "8.0 h") yield minutes 0 (a safe literal
 * already), so they add nothing new beyond the hours token.
 */
function hourDecompositions(context: GroundedContext): HourDecompositionToken[] {
  const out: HourDecompositionToken[] = [];
  for (const m of context.metrics) {
    if (m.availability !== 'present' || m.displayValue === null) continue;
    if (normalizeUnit(m.unit) !== 'h') continue;
    const value = Number(m.displayValue);
    if (!Number.isFinite(value) || value < 0) continue;
    const wholeHours = Math.floor(value);
    const minutes = Math.round((value - wholeHours) * 60);
    const totalMinutes = Math.round(value * 60);
    out.push({ token: String(wholeHours), unit: 'h' });
    out.push({ token: String(totalMinutes), unit: 'min' });
    for (let delta = -MINUTES_TOLERANCE; delta <= MINUTES_TOLERANCE; delta++) {
      const candidate = minutes + delta;
      if (candidate >= 0 && candidate < 60) out.push({ token: String(candidate), unit: 'min' });
    }
  }
  return out;
}

/**
 * Check that any value quoted with a unit is quoted with the SAME unit the
 * context attaches to a metric of that display value. A value present in the
 * allow-list but paired with a unit no metric uses for it is a `wrong-unit`
 * violation (design §5 step 3 unit re-check).
 */
function checkUnitConsistency(narrative: string, context: GroundedContext): NarrativeViolation[] {
  const out: NarrativeViolation[] = [];
  // Build value → set of legitimate units from the present metrics + series.
  const valueUnits = new Map<string, Set<string>>();
  const note = (display: string | null, unit: string): void => {
    if (display === null) return;
    const key = display.replace(/^[+-]/, '');
    const set = valueUnits.get(key) ?? new Set<string>();
    set.add(normalizeUnit(unit));
    valueUnits.set(key, set);
  };
  for (const m of context.metrics) note(m.displayValue, m.unit);
  if (context.series) {
    for (const p of context.series.points) note(p.displayValue, context.series.yUnit);
    for (const r of context.series.referenceLines) note(r.value, r.unit);
  }
  // Admit the H/M decomposition tokens of every hours-valued metric with their
  // restatement units, so "7 hours 18 minutes" / "438 minutes" (a faithful
  // re-rendering of a "7.3 h" value) is not flagged wrong-unit. Without this, a
  // decomposed minute that happens to equal another metric's display value (e.g.
  // a leak of 18 L/min) would be mis-attributed to that metric's unit.
  for (const d of hourDecompositions(context)) note(d.token, d.unit);

  // For each "<number> <unit>" pair in the prose, if we know that value's
  // units, the attached unit must be one of them.
  const pairRe = new RegExp(
    `(-?\\d+(?:\\.\\d+)?)\\s*(${KNOWN_UNITS.map(escapeRe).join('|')})`,
    'gi',
  );
  let match: RegExpExecArray | null;
  while ((match = pairRe.exec(narrative)) !== null) {
    const value = match[1];
    const rawUnit = match[2];
    if (value === undefined || rawUnit === undefined) continue;
    const legit = valueUnits.get(value);
    if (legit === undefined) continue; // value not unit-bound in context; numeral check handles it
    const attached = normalizeUnit(rawUnit);
    if (!legit.has(attached)) {
      out.push({
        kind: 'wrong-unit',
        offending: `${value} ${rawUnit}`,
        detail: `Value ${value} was quoted with unit "${rawUnit}", but the context attaches it to ${[
          ...legit,
        ].join(', ')}.`,
      });
    }
  }
  return out;
}

/**
 * Check that an asserted severity band / compliance verdict matches the context.
 * The context carries the band as a `severityBand` metric's `displayValue` and
 * the compliance verdict as a `complianceStatus` metric. A contradicting word in
 * the prose is an `inconsistent-verdict` violation.
 */
function checkVerdictConsistency(
  narrative: string,
  context: GroundedContext,
): NarrativeViolation[] {
  const out: NarrativeViolation[] = [];
  const lower = narrative.toLowerCase();

  const severityMetric = findMetric(context, 'severityBand');
  if (severityMetric?.displayValue) {
    const expected = severityMetric.displayValue.toLowerCase();
    for (const word of SEVERITY_WORDS) {
      if (word === expected) continue;
      // Only a VERDICT assertion counts — the word used as a band/range
      // classification (e.g. "the severe range", "classified as moderate"), not
      // a bare mention in a threshold listing ("moderate 10, severe 20").
      if (assertsBand(lower, word)) {
        out.push({
          kind: 'inconsistent-verdict',
          offending: word,
          detail: `Narrative implies severity "${word}", but the context band is "${expected}".`,
        });
      }
    }
  }

  const complianceMetric = findMetric(context, 'complianceStatus');
  const expectedCompliance = complianceMetric?.displayValue?.toLowerCase() ?? null;
  if (expectedCompliance) {
    for (const word of COMPLIANCE_WORDS) {
      const normExpected = expectedCompliance.replace('-', '');
      if (word.replace('-', '') === normExpected) continue;
      if (wordPresent(lower, word)) {
        out.push({
          kind: 'inconsistent-verdict',
          offending: word,
          detail: `Narrative implies compliance "${word}", but the context verdict is "${expectedCompliance}".`,
        });
      }
    }
  }
  return out;
}

/** Whether any context metric is non-high reliability or carries a flag. */
function requiresHedge(context: GroundedContext): boolean {
  const metricNeedsHedge = (m: MetricSnapshot): boolean =>
    m.availability === 'present' && (m.reliabilityTier !== 'high' || m.dataQualityFlags.length > 0);
  if (context.metrics.some(metricNeedsHedge)) return true;
  // Trends with non-significant / negligible qualifiers also need a hedge.
  return context.trends.some(
    (t) => t.strength === 'negligible' || t.strength === 'weak' || t.pValueDisplay === null,
  );
}

// ─── small helpers ──────────────────────────────────────────────────────────

function findMetric(context: GroundedContext, id: string): MetricSnapshot | undefined {
  return context.metrics.find((m) => m.id === id);
}

function normalizeUnit(unit: string): string {
  const u = unit.toLowerCase().replace('₂', '2').trim();
  if (u === 'events per hour') return 'events/h';
  if (u === 'hours') return 'h';
  if (u === 'minutes') return 'min';
  return u;
}

function containsAny(text: string, needles: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

/** Whole-word presence test (avoids matching "moderate" inside "moderately"). */
function wordPresent(lowerText: string, word: string): boolean {
  const re = new RegExp(`\\b${escapeRe(word)}\\b`);
  return re.test(lowerText);
}

/** Verdict cues that turn a severity word into a band assertion. */
const BAND_CUES: readonly string[] = ['band', 'range', 'category', 'classified', 'puts you in'];

/**
 * Whether `word` is used as a severity-band ASSERTION (adjacent to a verdict
 * cue), as opposed to a bare mention in a threshold listing. Requires the band
 * word and a cue within a short window of each other.
 */
function assertsBand(lowerText: string, word: string): boolean {
  const re = new RegExp(`\\b${escapeRe(word)}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(lowerText)) !== null) {
    const start = Math.max(0, m.index - 24);
    const end = Math.min(lowerText.length, m.index + word.length + 24);
    const window = lowerText.slice(start, end);
    if (BAND_CUES.some((cue) => window.includes(cue))) {
      // Suppress when the threshold-listing pattern "<word> <number>" is what we
      // matched (e.g. "moderate 10") — that is a cutoff label, not a verdict.
      const after = lowerText.slice(m.index + word.length, m.index + word.length + 6);
      if (/^\s+\d/.test(after)) continue;
      return true;
    }
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
