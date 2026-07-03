import { describe, it, expect } from 'vitest';

import {
  calverPrefix,
  isoDate,
  computeNextVersion,
  splitUnreleased,
  hasReleasableContent,
  cutReleaseChangelog,
  bumpPackageVersion,
  UNRELEASED_PLACEHOLDER,
} from '../lib.mjs';

// A fixed UTC reference date used across the version tests: June 2026.
const JUNE_2026 = new Date(Date.UTC(2026, 5, 18, 12, 0, 0));

describe('calverPrefix', () => {
  it('zero-pads the month and uses UTC', () => {
    expect(calverPrefix(new Date(Date.UTC(2026, 0, 1)))).toBe('2026.01');
    expect(calverPrefix(new Date(Date.UTC(2026, 5, 18)))).toBe('2026.06');
    expect(calverPrefix(new Date(Date.UTC(2026, 11, 31)))).toBe('2026.12');
  });

  it('uses UTC even near a day boundary in another timezone', () => {
    // 2026-06-30T23:30Z is still June in UTC.
    expect(calverPrefix(new Date('2026-06-30T23:30:00Z'))).toBe('2026.06');
  });
});

describe('isoDate', () => {
  it('formats YYYY-MM-DD in UTC', () => {
    expect(isoDate(JUNE_2026)).toBe('2026-06-18');
  });
});

describe('computeNextVersion', () => {
  it('returns .0 when no tags exist for the month', () => {
    expect(computeNextVersion([], JUNE_2026).version).toBe('2026.06.0');
  });

  it('returns .0 when tags exist only for other months', () => {
    const tags = ['v2026.05.0', 'v2026.05.3', 'v2025.12.7'];
    expect(computeNextVersion(tags, JUNE_2026).version).toBe('2026.06.0');
  });

  it('increments above the highest existing MICRO for the month', () => {
    const tags = ['v2026.06.0', 'v2026.06.1', 'v2026.06.2'];
    expect(computeNextVersion(tags, JUNE_2026).version).toBe('2026.06.3');
  });

  it('uses highest MICRO, not the count, so a gap does not collide', () => {
    // If .1 were ever deleted, count-based logic would re-issue .2 (collision).
    const tags = ['v2026.06.0', 'v2026.06.2'];
    expect(computeNextVersion(tags, JUNE_2026).version).toBe('2026.06.3');
  });

  it('handles MICRO >= 10 numerically, not lexically', () => {
    const tags = ['v2026.06.9', 'v2026.06.10'];
    expect(computeNextVersion(tags, JUNE_2026).version).toBe('2026.06.11');
  });

  it('ignores malformed or pre-release tags for the month', () => {
    const tags = ['v2026.06.0', 'v2026.06.x', 'v2026.06.1-rc.1', '2026.06.5', 'v2026.6.0'];
    // Only v2026.06.0 is well-formed for the prefix -> next is .1.
    expect(computeNextVersion(tags, JUNE_2026).version).toBe('2026.06.1');
  });

  it('exposes prefix and micro', () => {
    const r = computeNextVersion(['v2026.06.0'], JUNE_2026);
    expect(r.prefix).toBe('2026.06');
    expect(r.micro).toBe(1);
  });
});

const CHANGELOG_WITH_CONTENT = `# Changelog

Intro line.

## [Unreleased]

### Added

- A new thing.

## [2026.06.0] — 2026-06-18

### Added

- The baseline.
`;

const CHANGELOG_EMPTY = `# Changelog

Intro line.

## [Unreleased]

${UNRELEASED_PLACEHOLDER}

## [2026.06.0] — 2026-06-18

### Added

- The baseline.
`;

describe('splitUnreleased', () => {
  it('throws when there is no Unreleased heading', () => {
    expect(() => splitUnreleased('# Changelog\n\n## [2026.06.0] — x\n')).toThrow(/Unreleased/);
  });

  it('isolates the unreleased body', () => {
    const { unreleasedBody, afterUnreleased } = splitUnreleased(CHANGELOG_WITH_CONTENT);
    expect(unreleasedBody).toContain('A new thing.');
    expect(unreleasedBody).not.toContain('The baseline.');
    expect(afterUnreleased).toContain('## [2026.06.0]');
  });
});

describe('hasReleasableContent', () => {
  it('is false for the placeholder only', () => {
    const { unreleasedBody } = splitUnreleased(CHANGELOG_EMPTY);
    expect(hasReleasableContent(unreleasedBody)).toBe(false);
  });

  it('is false for whitespace only', () => {
    expect(hasReleasableContent('\n\n   \n')).toBe(false);
  });

  it('is true for real entries', () => {
    const { unreleasedBody } = splitUnreleased(CHANGELOG_WITH_CONTENT);
    expect(hasReleasableContent(unreleasedBody)).toBe(true);
  });

  it('is true even if the placeholder coexists with real content', () => {
    expect(hasReleasableContent(`${UNRELEASED_PLACEHOLDER}\n\n- real entry`)).toBe(true);
  });
});

describe('cutReleaseChangelog', () => {
  it('renames Unreleased to a dated section and re-opens a fresh Unreleased', () => {
    const { changelog, releasedSection } = cutReleaseChangelog(
      CHANGELOG_WITH_CONTENT,
      '2026.06.1',
      '2026-06-18',
    );

    // Fresh empty Unreleased on top.
    expect(changelog).toContain(`## [Unreleased]\n\n${UNRELEASED_PLACEHOLDER}`);
    // Dated section with the em dash.
    expect(changelog).toContain('## [2026.06.1] — 2026-06-18');
    // The moved content lives under the dated section.
    expect(changelog).toContain('- A new thing.');
    // Prior releases are preserved.
    expect(changelog).toContain('## [2026.06.0] — 2026-06-18');
    // Preamble preserved.
    expect(changelog.startsWith('# Changelog')).toBe(true);

    // Released section (for the GitHub Release body) carries heading + content.
    expect(releasedSection).toContain('## [2026.06.1] — 2026-06-18');
    expect(releasedSection).toContain('- A new thing.');
    expect(releasedSection).not.toContain('## [Unreleased]');
  });

  it('orders the fresh Unreleased above the dated section', () => {
    const { changelog } = cutReleaseChangelog(CHANGELOG_WITH_CONTENT, '2026.06.1', '2026-06-18');
    const unreleasedIdx = changelog.indexOf('## [Unreleased]');
    const datedIdx = changelog.indexOf('## [2026.06.1]');
    expect(unreleasedIdx).toBeGreaterThanOrEqual(0);
    expect(unreleasedIdx).toBeLessThan(datedIdx);
  });

  it('ends with exactly one trailing newline and no 3+ blank-line runs', () => {
    const { changelog } = cutReleaseChangelog(CHANGELOG_WITH_CONTENT, '2026.06.1', '2026-06-18');
    expect(changelog.endsWith('\n')).toBe(true);
    expect(changelog.endsWith('\n\n')).toBe(false);
    expect(changelog).not.toMatch(/\n{3,}/);
  });
});

describe('bumpPackageVersion', () => {
  it('replaces only the version field, preserving formatting', () => {
    const pkg = '{\n  "name": "x",\n  "version": "0.0.0",\n  "private": true\n}\n';
    const out = bumpPackageVersion(pkg, '2026.06.0');
    expect(out).toContain('"version": "2026.06.0"');
    expect(out).toContain('"name": "x"');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('does not touch a nested version-like key in dependencies', () => {
    const pkg = '{\n  "version": "0.0.0",\n  "dependencies": {\n    "version": "^1.0.0"\n  }\n}\n';
    const out = bumpPackageVersion(pkg, '2026.06.0');
    expect(out).toContain('"version": "2026.06.0"');
    // The dependency pin is untouched (only the first, top-level key changed).
    expect(out).toContain('"version": "^1.0.0"');
  });

  it('throws if there is no version field', () => {
    expect(() => bumpPackageVersion('{"name":"x"}', '1.0.0')).toThrow(/version/);
  });
});
