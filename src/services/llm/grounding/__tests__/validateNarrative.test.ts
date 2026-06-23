/**
 * Tests for the deterministic narrative validator (design reference §5 vectors).
 *
 * Covers: a fabricated numeral is rejected; a correct quote passes; a wrong-unit
 * quote is rejected; an inconsistent severity/compliance verdict is rejected; a
 * missing reliability hedge is flagged; diagnosis language is flagged; declared
 * structured citations are checked.
 *
 * @module services/llm/grounding/__tests__/validateNarrative.test
 */

import { describe, it, expect } from 'vitest';
import { validateNarrative, extractNumerals } from '../validateNarrative';
import { buildSingleNightContext, buildClinicalContext } from '../../context/buildGroundedContext';
import { COMMON, makeAggregate } from '../../context/__tests__/fixtures';

const singleNight = () => buildSingleNightContext({ ...COMMON, aggregate: makeAggregate() });

/**
 * Single-night context with a usage value chosen so its H/M decomposition tokens
 * (6.7 h → 6 h / 42 min / 402 total min) do NOT coincidentally collide with any
 * other allow-listed numeral — so the decomposition-admission path is what the
 * tests actually exercise. Mask-on is 400 min (≠ the 402 total) on purpose.
 */
const usageNight = () =>
  buildSingleNightContext({
    ...COMMON,
    aggregate: makeAggregate({ usageHours: 6.7, maskOnTimeMinutes: 400 }),
  });

describe('extractNumerals', () => {
  it('extracts decimals, integers, and split ranges', () => {
    expect(extractNumerals('AHI was 4.2 events/h, between 5-15.')).toEqual(['4.2', '5', '15']);
  });

  it('strips ISO dates so their components are not extracted', () => {
    expect(extractNumerals('On 2026-06-20 your AHI was 4.2.')).toEqual(['4.2']);
  });

  it('strips long-form dates (Mon DD, YYYY / Month DD YYYY / DD Mon YYYY)', () => {
    expect(extractNumerals('Night of Jun 9, 2026 — AHI 4.2.')).toEqual(['4.2']);
    expect(extractNumerals('Night of June 9 2026 — AHI 4.2.')).toEqual(['4.2']);
    expect(extractNumerals('Night of 9 Jun 2026 — AHI 4.2.')).toEqual(['4.2']);
  });

  it('strips a month-name-with-year span ("through June 2026")', () => {
    expect(extractNumerals('Data through June 2026, AHI 4.2.')).toEqual(['4.2']);
  });

  it('does not strip an arbitrary "<word> <number>" pair (no month name)', () => {
    expect(extractNumerals('Section 12 covered 4.2.')).toEqual(['12', '4.2']);
  });
});

describe('validateNarrative — numeral extraction', () => {
  it('passes a narrative that only quotes allow-listed values', () => {
    const ctx = singleNight();
    const res = validateNarrative(
      'Your AHI was 4.2 events/h, an estimate given the moderate reliability of the count.',
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  it('FABRICATED-NUMERAL: rejects a narrative containing a 6.1 not in the allow-list', () => {
    const ctx = singleNight();
    expect(ctx.numericAllowList).not.toContain('6.1');
    const res = validateNarrative('Your AHI was 6.1 events/h overnight.', ctx);
    expect(res.ok).toBe(false);
    expect(
      res.violations.some((v) => v.kind === 'fabricated-numeral' && v.offending === '6.1'),
    ).toBe(true);
  });

  it('permits tiny safe-literal integers (0–10) used as ordinals/counts', () => {
    const ctx = singleNight();
    const res = validateNarrative('This is the 1 night summarized here.', ctx);
    expect(res.violations.some((v) => v.kind === 'fabricated-numeral')).toBe(false);
  });

  it('LONG-FORM DATE: passes a single-night summary that writes the date long-form', () => {
    // Regression: the model renders the app-provided scope date (2026-06-20) in
    // long form. The year "2026" and day "20" must not be flagged as fabricated.
    const ctx = singleNight();
    const res = validateNarrative(
      'Summary for the night of Jun 20, 2026: your AHI was 4.2 events/h, an estimate given the moderate reliability of the count.',
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  it('LONG-FORM DATE: passes the full-month rendering ("June 20, 2026")', () => {
    const ctx = singleNight();
    const res = validateNarrative(
      'On June 20, 2026 your AHI was 4.2 events/h — treat this as an estimate.',
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  it('DATE RANGE: passes a narrative referencing the scope years/months long-form', () => {
    const ctx = buildClinicalContext({
      ...COMMON,
      aggregate: makeAggregate({ ahi: 18 }),
    });
    // buildClinicalContext is single-aggregate; scope start/end both 2026-06-20,
    // generatedOnDate 2026-06-21. Reference the months/years in long form.
    const res = validateNarrative(
      'Covering Jun 20, 2026 through June 2026 (generated Jun 21, 2026), your AHI of 18.0 events/h falls in the moderate band — an estimate.',
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.violations.some((v) => v.kind === 'fabricated-numeral')).toBe(false);
  });

  it('YEAR ADMISSION IS SCOPED: a 4-digit number that is not a context date year is still rejected', () => {
    const ctx = singleNight();
    const res = validateNarrative(
      'Back in 1999 the situation differed; your AHI was 4.2 events/h (an estimate).',
      ctx,
    );
    expect(
      res.violations.some((v) => v.kind === 'fabricated-numeral' && v.offending === '1999'),
    ).toBe(true);
  });

  it('GUARD INTACT: a fabricated clinical number is still rejected even amid a long-form date', () => {
    // 7.5 is NOT the context AHI (4.2); writing the date long-form must not let it through.
    const ctx = singleNight();
    expect(ctx.numericAllowList).not.toContain('7.5');
    const res = validateNarrative('On Jun 20, 2026 your AHI was 7.5 events/h (an estimate).', ctx);
    expect(res.ok).toBe(false);
    expect(
      res.violations.some((v) => v.kind === 'fabricated-numeral' && v.offending === '7.5'),
    ).toBe(true);
  });

  it('DECOMPOSED TIME: passes a usage restated as "6 hours 42 minutes" (from "6.7 h")', () => {
    // Usage 6.7 h → floor 6 h, round(0.7 × 60) = 42 min. The model restates the
    // allow-listed "6.7 h" in mixed units; "42" (well above the 0–10 safe set
    // and NOT a raw allow-list value) must be admitted as the derived
    // decomposition of the context's own hours metric, not flagged.
    const ctx = usageNight();
    const usage = ctx.metrics.find((m) => m.id === 'usageHours');
    expect(usage?.displayValue).toBe('6.7');
    expect(ctx.numericAllowList).not.toContain('42'); // not a raw allow-list value
    const res = validateNarrative(
      'You wore the mask about 6 hours 42 minutes — treat this as an estimate.',
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  it('DECOMPOSED TIME: passes the abbreviated "6 h 42 min" variant', () => {
    const ctx = usageNight();
    const res = validateNarrative(
      'Usage was approximately 6 h 42 min for the night (an estimate).',
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  it('DECOMPOSED TIME: passes a total-minutes restatement ("402 minutes")', () => {
    // 6.7 h → round(6.7 × 60) = 402 min, an exact derivation of the usage value.
    // The fixture's mask-on metric is 400 min, so 402 is NOT separately
    // allow-listed; it is admitted purely as the hours-metric decomposition.
    const ctx = usageNight();
    expect(ctx.numericAllowList).not.toContain('402');
    const res = validateNarrative(
      'That is roughly 402 minutes of therapy — an estimate given the reliability tier.',
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  it('DECOMPOSED TIME: tolerates ±1 minute on the sub-hour component ("6 hours 41 minutes")', () => {
    // 42 ± 1 is admitted to tolerate the model rounding the displayed decimal
    // slightly differently; 41 is within the tight window.
    const ctx = usageNight();
    const res = validateNarrative(
      'You used it about 6 hours 41 minutes overnight (an estimate).',
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  it('GUARD INTACT — FABRICATED MINUTE: rejects "6 hours 55 minutes" (real decomposition is 42)', () => {
    // 55 ≠ the true 42 (and is outside the ±1 window), so a fabricated minutes
    // value must still be flagged — the decomposition admission does NOT widen
    // to arbitrary integers > 10.
    const ctx = usageNight();
    expect(ctx.numericAllowList).not.toContain('55');
    const res = validateNarrative(
      'You wore the mask about 6 hours 55 minutes — treat this as an estimate.',
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(
      res.violations.some((v) => v.kind === 'fabricated-numeral' && v.offending === '55'),
    ).toBe(true);
  });

  it('GUARD INTACT — FABRICATED TOTAL MINUTES: rejects "420 minutes" (real total is 402)', () => {
    // A made-up total-minutes value that is not round(value × 60) for any context
    // hours metric stays a fabrication.
    const ctx = usageNight();
    expect(ctx.numericAllowList).not.toContain('420');
    const res = validateNarrative('That is roughly 420 minutes of therapy (an estimate).', ctx);
    expect(
      res.violations.some((v) => v.kind === 'fabricated-numeral' && v.offending === '420'),
    ).toBe(true);
  });

  it('DAY/MONTH NOT ADMITTED: a fabricated integer equal to the scope day-of-month is still rejected', () => {
    // Only the date YEAR is admitted; the day (20) and month (6) are not, so a
    // fabricated count that coincides with the date's day-of-month — written
    // outside a strippable long-form date and with no recognized unit — must
    // still be flagged. (Guards against the day/month admission widening.)
    const ctx = singleNight();
    expect(ctx.numericAllowList).not.toContain('20');
    const res = validateNarrative(
      'You woke 20 times overnight; your AHI was 4.2 events/h (an estimate).',
      ctx,
    );
    expect(
      res.violations.some((v) => v.kind === 'fabricated-numeral' && v.offending === '20'),
    ).toBe(true);
  });
});

describe('validateNarrative — unit consistency', () => {
  it('WRONG-UNIT: rejects AHI quoted with the wrong unit', () => {
    const ctx = singleNight();
    // 4.2 is the AHI in events/h; quoting it as cmH2O is a wrong-unit fabrication.
    const res = validateNarrative('The pressure-like figure was 4.2 cmH2O.', ctx);
    expect(res.ok).toBe(false);
    expect(res.violations.some((v) => v.kind === 'wrong-unit')).toBe(true);
  });

  it('accepts AHI quoted with its correct unit', () => {
    const ctx = singleNight();
    const res = validateNarrative('Your AHI was 4.2 events/h (an estimate).', ctx);
    expect(res.violations.some((v) => v.kind === 'wrong-unit')).toBe(false);
  });
});

describe('validateNarrative — verdict consistency', () => {
  it('rejects a severity claim that contradicts the context band', () => {
    // AHI 18 → "moderate" under defaults; claiming "severe" is inconsistent.
    const ctx = buildClinicalContext({ ...COMMON, aggregate: makeAggregate({ ahi: 18 }) });
    const res = validateNarrative(
      'This puts you in the severe range based on your thresholds.',
      ctx,
    );
    expect(res.violations.some((v) => v.kind === 'inconsistent-verdict')).toBe(true);
  });

  it('accepts a severity claim that matches the context band', () => {
    const ctx = buildClinicalContext({ ...COMMON, aggregate: makeAggregate({ ahi: 18 }) });
    const res = validateNarrative(
      'Your AHI of 18 events/h falls in the moderate band (an estimate).',
      ctx,
    );
    expect(res.violations.some((v) => v.kind === 'inconsistent-verdict')).toBe(false);
  });
});

describe('validateNarrative — mandatory hedge', () => {
  it('MISSING-HEDGE: flags a narrative citing a non-high metric with no hedging', () => {
    const ctx = singleNight(); // AHI is 'moderate' tier → hedge required
    const res = validateNarrative('Your AHI was 4.2 events/h overnight.', ctx);
    expect(res.violations.some((v) => v.kind === 'missing-hedge')).toBe(true);
  });

  it('passes when hedging language is present', () => {
    const ctx = singleNight();
    const res = validateNarrative(
      'Your AHI was about 4.2 events/h — treat this as an estimate.',
      ctx,
    );
    expect(res.violations.some((v) => v.kind === 'missing-hedge')).toBe(false);
  });
});

describe('validateNarrative — no-diagnosis lint', () => {
  it('flags diagnosis and imperative therapy-change language', () => {
    const ctx = singleNight();
    const res = validateNarrative(
      'You have sleep apnea; you should increase your pressure. This is an estimate.',
      ctx,
    );
    expect(res.violations.some((v) => v.kind === 'diagnosis-language')).toBe(true);
  });
});

describe('validateNarrative — declared structured citations', () => {
  it('rejects a declared cited number outside the allow-list', () => {
    const ctx = singleNight();
    const res = validateNarrative('Your AHI was 4.2 events/h (an estimate).', ctx, {
      citedNumbers: ['4.2', '99.9'],
    });
    expect(
      res.violations.some((v) => v.kind === 'fabricated-numeral' && v.offending === '99.9'),
    ).toBe(true);
  });
});
