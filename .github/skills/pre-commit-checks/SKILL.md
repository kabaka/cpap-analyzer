---
name: pre-commit-checks
description: Run and troubleshoot the pre-commit hook quality checks. Use when commits fail, when adding new checks, or when verifying code quality locally.
metadata:
  version: '2.0'
---

# Pre-Commit Quality Checks

The pre-commit hook uses **lint-staged** for performance, running checks only on staged files. All must pass for a commit to proceed.

## Checks

### 1. Formatting and Linting (lint-staged)

```bash
./node_modules/.bin/lint-staged
```

Configuration in `package.json` under `"lint-staged"`:

- **JS/TS files**: `prettier --write` → `eslint --fix`
- **Other files**: `prettier --write`

**Runs only on staged files** for maximum performance.

### 2. Type Checking (TypeScript)

```bash
npx tsc --noEmit
```

Runs on the full project (fast enough, ensures project-wide type safety). No auto-fix — type errors must be resolved manually.

### 3. Unit Tests (Vitest)

```bash
./node_modules/.bin/vitest related --run $(git diff --name-only --cached)
```

Runs tests **only for files related to staged changes** using Vitest's "related" mode.

## Guarantee

**If pre-commit passes locally, CI must be green.** If this guarantee is ever broken, it is a bug in the pipeline and must be fixed immediately.

## Key Benefits

- **Performance**: Only processes staged files for formatting/linting
- **Stability**: Uses local paths (`./node_modules/.bin/`) instead of `npx` to avoid $PATH issues
- **Smart testing**: Vitest "related" mode runs only tests affected by your changes
- **Auto-fix**: Prettier and ESLint automatically fix issues when possible

## Troubleshooting

- **lint-staged fails**: Check the output for specific Prettier or ESLint errors. Most issues are auto-fixed; remaining issues need manual correction.
- **TypeScript fails**: Read the type error carefully. Do not use `// @ts-ignore` or `any` to suppress.
- **Tests fail**: Run `npx vitest` interactively to debug. The hook only tests files related to your changes.
- **Hook not running**: Ensure `.husky/pre-commit` is executable: `chmod +x .husky/pre-commit`
- **lint-staged not found**: Run `npm install` to install dependencies.

## Manual Check Commands

To run checks manually before committing:

```bash
# Format all files
npm run format

# Lint all files
npm run lint

# Type check
npm run typecheck

# Run full test suite
npm test
```
