import { describe, it, expect } from 'vitest';
import { parsePageParam } from '../paginationParams';

/**
 * `parsePageParam` maps the raw `?page=N` query-string value into a sane,
 * 1-based page number. It is the single source of truth for "which page is the
 * Session List showing", so its fallback behavior (missing/invalid → page 1)
 * directly governs the URL-state pagination fix. These cases pin that contract,
 * including the documented `parseInt` leniency for trailing garbage.
 */
describe('SessionList/parsePageParam', () => {
  it('returns page 1 when the param is absent (null)', () => {
    expect(parsePageParam(null)).toBe(1);
  });

  it('returns page 1 for "1" (the explicit default)', () => {
    expect(parsePageParam('1')).toBe(1);
  });

  it('returns the parsed page for a valid integer string', () => {
    expect(parsePageParam('3')).toBe(3);
  });

  it('returns the parsed page for a large valid value', () => {
    expect(parsePageParam('99')).toBe(99);
  });

  it('returns page 1 for "0" (below the 1-based floor)', () => {
    expect(parsePageParam('0')).toBe(1);
  });

  it('returns page 1 for a negative value', () => {
    expect(parsePageParam('-2')).toBe(1);
  });

  it('returns page 1 for a non-numeric value (NaN)', () => {
    expect(parsePageParam('abc')).toBe(1);
  });

  it('returns page 1 for an empty string', () => {
    expect(parsePageParam('')).toBe(1);
  });

  // Documents CURRENT behavior: parseInt('3abc', 10) === 3, so trailing garbage
  // after a leading integer is tolerated and the leading integer wins. This is
  // intentional documentation of the implementation, not an endorsement; if the
  // parser is ever tightened this test should be updated alongside it.
  it('parses the leading integer of a trailing-garbage value ("3abc" → 3)', () => {
    expect(parsePageParam('3abc')).toBe(3);
  });
});
