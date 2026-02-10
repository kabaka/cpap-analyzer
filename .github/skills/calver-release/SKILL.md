---
name: calver-release
description: Create releases using Calendar Versioning (CalVer) in YYYY.0M.MICRO format. Use when releasing, versioning, or tagging a new version.
metadata:
  version: '1.0'
---

# CalVer Release Process

This project uses [Calendar Versioning](https://calver.org/) with the format `YYYY.0M.MICRO`.

## Version Format

```
YYYY.0M.MICRO
```

- `YYYY` — Full year (e.g., `2026`)
- `0M` — Zero-padded month (e.g., `02` for February)
- `MICRO` — Incremental patch number within the month, starting at `0`

## Examples

| Version | Meaning |
| ---- | ---- |
| `2026.02.0` | First release of February 2026 |
| `2026.02.1` | Second release of February 2026 |
| `2026.03.0` | First release of March 2026 |

## Release Steps

1. Ensure all CI checks pass on `main`.
2. Update `CHANGELOG.md`: move items from `[Unreleased]` to a new version header.
3. Update `version` in `package.json` to the new CalVer version.
4. Commit: `chore: release YYYY.0M.MICRO`
5. Tag: `git tag vYYYY.0M.MICRO`
6. Push tag: `git push origin vYYYY.0M.MICRO`

## CHANGELOG Format

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):

```markdown
## [YYYY.0M.MICRO] — YYYY-MM-DD

### Added
- ...

### Changed
- ...

### Fixed
- ...
```
