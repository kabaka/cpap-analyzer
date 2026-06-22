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
