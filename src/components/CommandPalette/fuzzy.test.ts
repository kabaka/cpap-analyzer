import { describe, it, expect } from 'vitest';
import { fuzzyMatch, highlightSegments } from './fuzzy';

/** Assert a match exists and return its score (narrows the FuzzyResult | null). */
function scoreOf(query: string, target: string): number {
  const result = fuzzyMatch(query, target);
  if (result === null) throw new Error(`expected "${query}" to match "${target}"`);
  return result.score;
}

describe('fuzzyMatch', () => {
  describe('subsequence matching', () => {
    it('matches an in-order subsequence and reports the matched indices', () => {
      expect(fuzzyMatch('dsh', 'Dashboard')).toEqual({
        score: expect.any(Number),
        indices: [0, 2, 3],
      });
      expect(fuzzyMatch('abc', 'abc')?.indices).toEqual([0, 1, 2]);
      expect(fuzzyMatch('ac', 'abc')?.indices).toEqual([0, 2]);
    });

    it('is case-insensitive and ignores surrounding query whitespace', () => {
      expect(fuzzyMatch('DASH', 'Dashboard')?.indices).toEqual([0, 1, 2, 3]);
      expect(fuzzyMatch('  ab  ', 'abc')?.indices).toEqual([0, 1]);
    });

    it('returns null when characters are absent or out of order', () => {
      expect(fuzzyMatch('xyz', 'Dashboard')).toBeNull(); // characters absent
      expect(fuzzyMatch('ca', 'abc')).toBeNull(); // present but wrong order
      expect(fuzzyMatch('abcd', 'abc')).toBeNull(); // one char never consumed
    });

    it('returns null for an empty or whitespace-only query', () => {
      expect(fuzzyMatch('', 'abc')).toBeNull();
      expect(fuzzyMatch('   ', 'abc')).toBeNull();
    });
  });

  // Scores are only meaningful RELATIVELY, so assert ordering, not magnitudes.
  describe('scoring order', () => {
    it('ranks a contiguous run above a gapped one (same start index)', () => {
      expect(scoreOf('ab', 'ab')).toBeGreaterThan(scoreOf('ab', 'axb'));
    });

    it('ranks a word-boundary start above a mid-word match (same index)', () => {
      // 's' lands at index 2 in both targets; only the preceding boundary differs.
      expect(scoreOf('s', 'x sun')).toBeGreaterThan(scoreOf('s', 'xxsun'));
    });

    it('ranks an earlier match above a later one (same structure)', () => {
      // 'o' at index 1 vs index 2; neither follows a word boundary.
      expect(scoreOf('o', 'xox')).toBeGreaterThan(scoreOf('o', 'xxox'));
    });
  });
});

describe('highlightSegments', () => {
  it('returns a single unmatched segment when there are no indices', () => {
    expect(highlightSegments('abc', [])).toEqual([{ text: 'abc', match: false }]);
  });

  it('merges a leading contiguous matched run into ONE matched span', () => {
    expect(highlightSegments('Dashboard', [0, 1, 2])).toEqual([
      { text: 'Das', match: true },
      { text: 'hboard', match: false },
    ]);
  });

  it('merges an interior contiguous run and splits the surrounding text out', () => {
    expect(highlightSegments('abcdef', [1, 2, 3])).toEqual([
      { text: 'a', match: false },
      { text: 'bcd', match: true },
      { text: 'ef', match: false },
    ]);
  });

  it('splits non-adjacent matches into separate spans at the right boundaries', () => {
    expect(highlightSegments('abcd', [0, 2])).toEqual([
      { text: 'a', match: true },
      { text: 'b', match: false },
      { text: 'c', match: true },
      { text: 'd', match: false },
    ]);
  });

  it('handles a match at the final character', () => {
    expect(highlightSegments('abc', [2])).toEqual([
      { text: 'ab', match: false },
      { text: 'c', match: true },
    ]);
  });

  it('flags the entire string as one span when every character matches', () => {
    expect(highlightSegments('abc', [0, 1, 2])).toEqual([{ text: 'abc', match: true }]);
  });

  it('always reconstructs the original text when segments are concatenated', () => {
    const text = 'Dashboard';
    for (const indices of [[], [0], [4], [0, 1, 2], [0, 2, 4], [8]]) {
      const rebuilt = highlightSegments(text, indices)
        .map((segment) => segment.text)
        .join('');
      expect(rebuilt).toBe(text);
    }
  });

  it('collapses the contiguous run produced by a real fuzzyMatch into one span', () => {
    const result = fuzzyMatch('das', 'Dashboard');
    if (result === null) throw new Error('expected "das" to match "Dashboard"');
    expect(highlightSegments('Dashboard', result.indices)).toEqual([
      { text: 'Das', match: true },
      { text: 'hboard', match: false },
    ]);
  });
});
