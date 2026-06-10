---
name: conventional-commits
description: Write commit messages following the Conventional Commits specification. Use when committing changes, writing commit messages, or reviewing commit message format.
---

# Conventional Commits

All commits in this project must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

## Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

## Types

| Type       | When to use                                           |
| ---------- | ----------------------------------------------------- |
| `feat`     | A new feature or capability                           |
| `fix`      | A bug fix                                             |
| `docs`     | Documentation changes only                            |
| `chore`    | Maintenance tasks, dependency updates, config changes |
| `refactor` | Code restructuring without behavior change            |
| `test`     | Adding or updating tests                              |
| `perf`     | Performance improvements                              |
| `ci`       | CI/CD pipeline changes                                |
| `style`    | Formatting changes (Prettier, whitespace)             |
| `build`    | Build system or dependency changes                    |

## Rules

- **Description**: Imperative mood, lowercase, no period at end. Max 72 characters.
- **Scope**: Optional. Use module/feature name (e.g., `feat(import):`, `fix(charts):`).
- **Body**: Explain _what_ and _why_, not _how_. Wrap at 72 characters.
- **Breaking changes**: Add `!` after type/scope (e.g., `feat!:`) and include `BREAKING CHANGE:` footer.

## Examples

```
feat(import): add EDF file parsing for ResMed AirSense 11

fix(charts): correct AHI rolling average calculation for gaps in data

docs: update glossary with flow limitation terminology

chore: upgrade vitest to 3.x

refactor(storage): extract chunk indexing into separate module

test(stats): add edge case tests for Kaplan-Meier with censored data

perf(viz): implement LTTB downsampling for time-series rendering

ci: add bundle size check to PR workflow
```
