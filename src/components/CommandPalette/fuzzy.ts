/**
 * Fuzzy subsequence matcher for the ⌘K command palette.
 *
 * A deliberately small, dependency-free matcher: it accepts a target string if
 * the (lower-cased) query characters appear in order as a subsequence, and
 * scores matches so that contiguous runs, word-boundary starts, and early
 * matches rank higher. Pure and side-effect-free so it is unit-testable in
 * isolation and cheap to run over the palette's small, fixed command set.
 *
 * @module components/CommandPalette/fuzzy
 */

/** A scored fuzzy match: the ordered indices in the target that matched. */
export interface FuzzyResult {
  /** Higher is a better match. Only meaningful relative to other results. */
  readonly score: number;
  /** Ascending indices into the target string that the query matched. */
  readonly indices: number[];
}

/** Characters that begin a new "word" — a match right after one scores higher. */
const WORD_BOUNDARIES = new Set([' ', '-', '/', ':', '.', ',', '_']);

/**
 * Attempt to match `query` against `target` as an ordered subsequence.
 *
 * @param query - The user's search text. Leading/trailing space is ignored; an
 *   empty query returns `null` (there is nothing to match or highlight).
 * @param target - The candidate label/keyword string.
 * @returns A {@link FuzzyResult} when every query character was found in order,
 *   otherwise `null`.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = query.trim().toLowerCase();
  if (q === '') return null;

  const t = target.toLowerCase();
  const indices: number[] = [];
  let qi = 0;
  let score = 0;
  let prevMatch = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;

    indices.push(ti);
    // Contiguous with the previous matched char reads as a real substring hit.
    score += ti === prevMatch + 1 ? 3 : 1;
    // Matching at the start of a word is a stronger signal than mid-word.
    const prevChar = ti > 0 ? t[ti - 1] : undefined;
    if (ti === 0 || (prevChar !== undefined && WORD_BOUNDARIES.has(prevChar))) {
      score += 2;
    }
    prevMatch = ti;
    qi++;
  }

  // Not every query character was consumed → not a match.
  if (qi < q.length) return null;

  // Prefer matches that begin earlier in the target.
  score += Math.max(0, 5 - (indices[0] ?? 0));
  return { score, indices };
}

/** A contiguous run of target text, flagged as matched or not, for highlighting. */
export interface HighlightSegment {
  readonly text: string;
  readonly match: boolean;
}

/**
 * Split `text` into consecutive matched / unmatched runs given the matched
 * character `indices`. Adjacent matched characters collapse into a single
 * matched segment, so a contiguous substring hit renders as one highlighted
 * span. Used to wrap matched characters per spec B5 (colour + weight).
 *
 * @param text - The label being rendered.
 * @param indices - Matched character indices (from {@link fuzzyMatch}).
 */
export function highlightSegments(text: string, indices: readonly number[]): HighlightSegment[] {
  if (indices.length === 0) return [{ text, match: false }];

  const matched = new Set(indices);
  const segments: HighlightSegment[] = [];
  let current = '';
  let currentMatch = matched.has(0);

  for (let i = 0; i < text.length; i++) {
    const isMatch = matched.has(i);
    if (isMatch === currentMatch) {
      current += text[i];
    } else {
      if (current !== '') segments.push({ text: current, match: currentMatch });
      current = text[i] ?? '';
      currentMatch = isMatch;
    }
  }
  if (current !== '') segments.push({ text: current, match: currentMatch });
  return segments;
}
