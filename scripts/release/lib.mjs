// Pure, dependency-light helpers for the automated CalVer release pipeline.
//
// This module holds the LOGIC (version computation + changelog transform) so it
// can be unit-tested in isolation, away from the side effects (git, gh, fs) that
// the CLI entrypoints (compute-version.mjs, cut-release.mjs) perform. Everything
// here is a pure function: same inputs -> same outputs, no I/O.
//
// Versioning contract (ADR 0021 / ADR 0014): CalVer `YYYY.0M.MICRO` where
// `YYYY.0M` is the current UTC year + zero-padded month and MICRO is the count
// of releases already cut in that `YYYY.0M` (highest existing MICRO + 1; 0 if
// none this month), derived from existing `vYYYY.0M.*` git tags.

/**
 * Format a Date as the `YYYY.0M` CalVer prefix, in UTC.
 * UTC is deliberate: CI runners and tags must agree regardless of runner TZ.
 * @param {Date} date
 * @returns {string} e.g. "2026.06"
 */
export function calverPrefix(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}.${month}`;
}

/**
 * Format a Date as `YYYY-MM-DD`, in UTC (the changelog date stamp).
 * @param {Date} date
 * @returns {string} e.g. "2026-06-18"
 */
export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Compute the next CalVer version for `date` given the existing git tags.
 *
 * MICRO = (highest existing MICRO among `vYYYY.0M.*` tags for this month) + 1,
 * or 0 if there are no tags for this month. Only well-formed
 * `vYYYY.0M.<integer>` tags for the CURRENT prefix are considered; anything
 * else (other months, malformed, pre-release suffixes) is ignored.
 *
 * @param {string[]} tags - all tag names, e.g. ["v2026.06.0", "v2026.05.3"].
 * @param {Date} date - the reference date (defaults to now at call sites).
 * @returns {{ version: string, prefix: string, micro: number }}
 */
export function computeNextVersion(tags, date) {
  const prefix = calverPrefix(date);
  // Match any well-formed `v<year>.<month>.<micro>` tag, capturing the
  // `<year>.<month>` prefix and the integer MICRO. A static pattern (no
  // interpolation of `prefix`) avoids building a RegExp from a string and the
  // partial-escaping pitfalls that come with it; the month gate is done by an
  // exact string comparison against `prefix` below instead.
  const re = /^v(\d+\.\d{2})\.(\d+)$/;

  let highest = -1;
  for (const tag of tags) {
    const m = re.exec(tag.trim());
    if (m && m[1] === prefix) {
      const micro = Number.parseInt(m[2], 10);
      if (Number.isInteger(micro) && micro > highest) {
        highest = micro;
      }
    }
  }

  const micro = highest + 1;
  return { version: `${prefix}.${micro}`, prefix, micro };
}

/**
 * The placeholder text the changelog uses for an empty Unreleased section.
 */
export const UNRELEASED_PLACEHOLDER = '_Nothing yet._';

/**
 * Split a CHANGELOG into its `## [Unreleased]` body and the rest.
 *
 * Returns the raw text BETWEEN the `## [Unreleased]` heading and the next
 * `## ` heading (or EOF). Throws if there is no `## [Unreleased]` heading at
 * all, since that is a structural invariant the pipeline depends on.
 *
 * @param {string} changelog
 * @returns {{
 *   beforeHeading: string,   // text up to and including the Unreleased heading line
 *   unreleasedBody: string,  // raw text of the Unreleased section body
 *   afterUnreleased: string, // everything from the next `## ` heading onward
 * }}
 */
export function splitUnreleased(changelog) {
  const lines = changelog.split('\n');
  const headingRe = /^## \[Unreleased\]/;

  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      headingIdx = i;
      break;
    }
  }
  if (headingIdx === -1) {
    throw new Error('CHANGELOG.md has no "## [Unreleased]" heading.');
  }

  // Find the next `## ` heading after the Unreleased one (the next release
  // section), or EOF.
  let nextIdx = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      nextIdx = i;
      break;
    }
  }

  const beforeHeading = lines.slice(0, headingIdx + 1).join('\n');
  const unreleasedBody = lines.slice(headingIdx + 1, nextIdx).join('\n');
  const afterUnreleased = lines.slice(nextIdx).join('\n');

  return { beforeHeading, unreleasedBody, afterUnreleased };
}

/**
 * Decide whether the Unreleased section has real, releasable content.
 *
 * Empty means: nothing but whitespace and/or the `_Nothing yet._` placeholder.
 * Docs/chore merges that never touched the changelog leave the placeholder in
 * place, and those must NOT produce an (empty) release.
 *
 * @param {string} unreleasedBody - raw body text from splitUnreleased().
 * @returns {boolean} true if there is releasable content.
 */
export function hasReleasableContent(unreleasedBody) {
  const stripped = unreleasedBody
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== UNRELEASED_PLACEHOLDER)
    .join('\n')
    .trim();
  return stripped.length > 0;
}

/**
 * Transform the changelog for a release: rename `## [Unreleased]` to the dated
 * `## [<version>] — <date>` section and insert a fresh empty `## [Unreleased]`
 * above it. The em dash (—) matches the existing file convention.
 *
 * Idempotent in spirit but not in fact: callers must only invoke this when
 * hasReleasableContent() is true.
 *
 * @param {string} changelog - full CHANGELOG.md contents.
 * @param {string} version - e.g. "2026.06.1".
 * @param {string} date - `YYYY-MM-DD`.
 * @returns {{ changelog: string, releasedSection: string }}
 *   The transformed changelog, plus the just-released section (heading + body),
 *   suitable for use as a GitHub Release body.
 */
export function cutReleaseChangelog(changelog, version, date) {
  const { beforeHeading, unreleasedBody, afterUnreleased } = splitUnreleased(changelog);

  // The Unreleased heading line is the last line of `beforeHeading`; everything
  // before it is the changelog preamble we keep verbatim.
  const beforeLines = beforeHeading.split('\n');
  const preamble = beforeLines.slice(0, -1).join('\n');

  const datedHeading = `## [${version}] — ${date}`;

  // Normalize the released body: trim leading/trailing blank lines, then frame
  // it with single blank lines so spacing is consistent regardless of input.
  const releasedBody = trimBlankEdges(unreleasedBody);

  const freshUnreleased = `## [Unreleased]\n\n${UNRELEASED_PLACEHOLDER}`;

  const releasedSection = `${datedHeading}\n\n${releasedBody}`;

  const parts = [
    preamble.replace(/\s+$/, ''),
    '',
    freshUnreleased,
    '',
    releasedSection,
    '',
    afterUnreleased.replace(/^\s+/, ''),
  ];

  // Join and collapse any accidental run of 3+ blank lines down to 1.
  let result = parts.join('\n').replace(/\n{3,}/g, '\n\n');
  // Guarantee exactly one trailing newline.
  result = `${result.replace(/\s+$/, '')}\n`;

  return { changelog: result, releasedSection };
}

/**
 * Trim leading and trailing blank lines from a block of text (preserving
 * internal blank lines).
 * @param {string} text
 * @returns {string}
 */
function trimBlankEdges(text) {
  const lines = text.split('\n');
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end).join('\n');
}

/**
 * Bump the `version` field in a package.json string, preserving formatting.
 * Uses a targeted replace on the first top-level `"version"` key rather than
 * JSON.parse/stringify, so indentation, key order, and trailing newline survive
 * untouched (avoids a noisy diff and a Prettier reformat).
 *
 * @param {string} pkgJson - raw package.json contents.
 * @param {string} version - new version string.
 * @returns {string} updated package.json contents.
 */
export function bumpPackageVersion(pkgJson, version) {
  const re = /(^\s*"version"\s*:\s*")([^"]*)(")/m;
  if (!re.test(pkgJson)) {
    throw new Error('package.json has no "version" field to bump.');
  }
  return pkgJson.replace(re, `$1${version}$3`);
}
