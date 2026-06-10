---
name: code-review
description: Conduct thorough code reviews following project quality standards. Use when reviewing pull requests, evaluating code changes, or performing QA checks.
---

# Code Review Process

## Review Checklist

### Correctness

- [ ] Code does what it claims to do
- [ ] Edge cases are handled
- [ ] Error paths are handled (not swallowed)
- [ ] No off-by-one errors in loops or array access
- [ ] Floating-point comparisons use tolerance where appropriate

### TypeScript Quality

- [ ] Strict mode compliant — no `any` type without justification
- [ ] Proper use of `readonly`, `const`, and immutability
- [ ] Discriminated unions preferred over type assertions
- [ ] No unnecessary type assertions (`as`)
- [ ] Generics used appropriately
- [ ] Exported types are documented

### Standards Compliance

- [ ] Prettier formatted (`npx prettier --check .`)
- [ ] ESLint clean (`npx eslint .`)
- [ ] TypeScript compiles (`npx tsc --noEmit`)
- [ ] Tests pass (`npx vitest run`)
- [ ] Conventional Commit message format

### Testing

- [ ] New public APIs have tests
- [ ] Edge cases are tested
- [ ] Error paths are tested
- [ ] Tests are descriptive and independent
- [ ] No flaky assertions (timing-dependent, order-dependent)

### Documentation

- [ ] CHANGELOG.md updated for user-facing changes
- [ ] In-app help updated if feature behavior changed
- [ ] JSDoc comments on exported functions
- [ ] Complex algorithms have explanatory comments

### Security (flag for Security agent if any apply)

- [ ] No unsanitized user input rendered as HTML
- [ ] File parsing validates input before processing
- [ ] No secrets or credentials in code
- [ ] External API responses are validated
- [ ] No new network calls to unexpected endpoints

## Issue Severity

| Severity    | Definition                                                        | Action                |
| ----------- | ----------------------------------------------------------------- | --------------------- |
| **Blocker** | Incorrect behavior, security issue, data loss risk                | Must fix before merge |
| **Major**   | Significant quality issue, missing tests, accessibility violation | Must fix before merge |
| **Minor**   | Style inconsistency, non-critical improvement                     | Should fix, can defer |
| **Nit**     | Cosmetic preference, optional improvement                         | Optional              |
