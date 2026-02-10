# 0014 — Calendar Versioning (CalVer) for Release Management

## Status

Accepted

## Context

CPAP Analyzer requires a versioning scheme for releases that communicates release timing clearly to users and enables automated release workflows. Version numbering must support:

- Clear communication of release recency to users
- Automated changelog generation
- No semantic confusion about "breaking changes" in a client-side application
- Simple mental model for both developers and users
- Compatibility with npm and git tag conventions

Versioning needs:

- Users care about "how recent" more than API stability (no external API consumers)
- Application auto-updates via GitHub Pages (no manual update process)
- Breaking changes are seamless to users (browser storage migrations handled automatically)
- Multiple releases per month possible during active development
- Long-term maintenance releases infrequent (months between releases)

Alternatives evaluated:

- **Semantic Versioning (SemVer)**: Industry standard (MAJOR.MINOR.PATCH), but MAJOR version increments require defining "breaking changes"—meaningless for end-user application with no API consumers. User doesn't care if internal API changed.
- **Sequential versioning**: Simple incrementing (v1, v2, v3), but loses temporal information about release timing.
- **Date-based versioning**: Clear temporal meaning but various formats exist (Ubuntu YY.MM, Windows YYMM, etc.)
- **CalVer (Calendar Versioning)**: Date-based with standardized format, used by Ubuntu, Twisted, pytz, and others

## Decision

Adopt **Calendar Versioning (CalVer)** in `YYYY.0M.MICRO` format.

Format specification:

- `YYYY`: Full year (2026, 2027, ...)
- `0M`: Zero-padded month (01-12)
- `MICRO`: Sequential release number within month (0, 1, 2, ...)

Examples:

- `2026.02.0`: First release in February 2026
- `2026.02.1`: Second release in February 2026 (hotfix or feature)
- `2026.03.0`: First release in March 2026

Rationale:

- **Temporal clarity**: Users immediately understand release recency (2026.02.x is from February 2026)
- **No semantic confusion**: No need to debate what constitutes "breaking change" for end-user application
- **Automated release numbering**: CI can determine next version from date and previous releases
- **Frequency flexibility**: MICRO allows multiple releases per month without confusion
- **Long-term clarity**: Years from now, `2026.02.0` clearly indicates an old release (unlike v47 which is opaque)
- **Consistent with project values**: Transparency and clarity over convention

Changelog management:

- Follow "Keep a Changelog" format (keepachangelog.com)
- Sections: Added, Changed, Deprecated, Removed, Fixed, Security
- Automated extraction for release notes during deployment

Release process:

1. Update `CHANGELOG.md` with unreleased changes
2. Run release script: determines next version, tags commit, generates release notes
3. CI builds and deploys on tag push
4. GitHub Release created automatically with changelog excerpt

Version in code:

```typescript
// src/version.ts
export const VERSION = '2026.02.0';
export const RELEASE_DATE = '2026-02-10';
```

Version displayed in UI footer and About dialog.

## Consequences

### Positive

- Temporal clarity helps users quickly assess if they should update ("my version is from August 2025, latest is February 2026")
- Eliminates debate about semantic versioning for an application with no external API surface
- Automated versioning simpler: no need to determine if change is MAJOR, MINOR, or PATCH
- Aligns with successful projects (Ubuntu, Twisted, etc.) proving viability
- MICRO component allows bug fixes and hotfixes within month without confusion
- Simpler release automation: version determined purely from date + tag count
- Clear in changelog: users see "2026.02.0 — February 10, 2026" and understand immediately

### Negative

- Unfamiliar to developers expecting SemVer (though common in OS distributions and date-centric software)
- No implicit API stability signal (in SemVer, MAJOR bump signals breaking changes)
  - **Mitigation**: Not an issue for end-user application; storage migrations handled transparently
- Multiple releases in one month have identical YYYY.0M prefix, differentiated only by MICRO
- Could theoretically exhaust MICRO namespace if > 100 releases in a month (unrealistic)

### Neutral

- npm registry accepts CalVer (treats as valid version string)
- Git tags follow same format: `v2026.02.0`
- Sorting works correctly: YYYY major component ensures chronological ordering
- Comparison logic different from SemVer but straightforward
