---
name: pre-commit-checks
description: Run and troubleshoot the pre-commit hook quality checks. Use when commits fail, when adding new checks, or when verifying code quality locally.
metadata:
  version: '1.0'
---

# Pre-Commit Quality Checks

The pre-commit hook runs the following checks in order. All must pass for a commit to proceed.

## Checks

### 1. Formatting (Prettier)

```bash
npx prettier --check .
```

To fix: `npx prettier --write .`

Configuration: `.prettierrc` and `.prettierignore`

### 2. Linting (ESLint)

```bash
npx eslint .
```

Fix auto-fixable issues: `npx eslint . --fix`

### 3. Type Checking (TypeScript)

```bash
npx tsc --noEmit
```

Only runs if `tsconfig.json` exists. No auto-fix — type errors must be resolved manually.

### 4. Unit Tests (Vitest)

```bash
npx vitest run --reporter=dot
```

Runs the full unit test suite. Failed tests must be fixed before committing.

## Guarantee

**If pre-commit passes locally, CI must be green.** If this guarantee is ever broken, it is a bug in the pipeline and must be fixed immediately.

## Troubleshooting

- **Prettier fails**: Run `npx prettier --write .` to auto-format, then re-commit.
- **ESLint fails**: Check the specific rule violation. Use `--fix` for auto-fixable issues.
- **TypeScript fails**: Read the type error carefully. Do not use `// @ts-ignore` or `any` to suppress.
- **Tests fail**: Run `npx vitest` interactively to debug.
- **Hook not running**: Ensure `.husky/pre-commit` is executable: `chmod +x .husky/pre-commit`
