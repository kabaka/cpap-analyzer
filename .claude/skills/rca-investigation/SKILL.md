---
name: rca-investigation
description: Conduct root cause analysis for bugs and incidents. Use when investigating failures, regressions, or unexpected behavior.
---

# Root Cause Analysis

## Investigation Process

### 1. Reproduce

- Confirm the issue is reproducible
- Document exact steps, inputs, and environment
- Note whether the issue is deterministic or intermittent

### 2. Isolate

- Identify the minimal reproduction case
- Narrow to the specific module, function, or data condition
- Use binary search (git bisect, code commenting) to find the introducing change

### 3. Root Cause

- Identify _why_ the failure occurs, not just _what_ fails
- Distinguish root cause from symptoms and contributing factors
- Check if the root cause affects other code paths

### 4. Recommend

- Propose a fix approach
- Identify which agent should implement the fix
- Estimate impact and risk of the fix

### 5. Prevent

- Recommend specific tests to prevent recurrence
- Suggest architectural changes if the root cause is systemic
- Recommend monitoring or assertions for early detection

## Report Template

```markdown
# RCA: [Brief descriptive title]

**Date**: YYYY-MM-DD
**Severity**: Critical | High | Medium | Low
**Status**: Investigating | Root Cause Identified | Fix Verified

## Issue Summary

One-paragraph description of what was observed.

## Reproduction

1. Step-by-step reproduction instructions
2. ...

## Timeline

- [timestamp] Issue first observed
- [timestamp] Investigation began
- [timestamp] Root cause identified

## Root Cause

Detailed explanation of why the issue occurred.

## Contributing Factors

- Factor 1
- Factor 2

## Fix Recommendation

What should be changed, by which agent, with what priority.

## Prevention Measures

- Tests to add
- Checks to implement
- Architectural changes to consider
```
