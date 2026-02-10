---
name: adr-authoring
description: Write Architecture Decision Records using the MADR 4.0 template. Use when documenting architectural choices, technology selections, or design decisions.
metadata:
  version: '1.0'
---

# Writing Architecture Decision Records

ADRs document significant architectural decisions. They go in `docs/decisions/` with sequential numbering.

## File Naming

```
docs/decisions/NNNN-kebab-case-title.md
```

Use 4-digit zero-padded numbers: `0001`, `0002`, etc.

## Template (MADR 4.0)

```markdown
# NNNN — [Decision Title]

## Status

[Proposed | Accepted | Deprecated | Superseded by [NNNN](NNNN-title.md)]

## Context

[What is the issue? What forces are at play? What are the constraints?
Include technical context, business requirements, and any prior decisions
that influence this one.]

## Decision

[What was decided and why. Be specific about what will be done.]

## Consequences

### Positive

- [Benefit 1]
- [Benefit 2]

### Negative

- [Tradeoff 1]
- [Tradeoff 2]

### Neutral

- [Observation that is neither clearly positive nor negative]
```

## Quality Checklist

- [ ] Context captures real constraints, not generic boilerplate
- [ ] Alternatives were considered and documented
- [ ] Decision is justified with reasoning tied to context
- [ ] Consequences honestly list downsides
- [ ] Related ADRs are cross-referenced
- [ ] Status is set correctly

## When to Write an ADR

- Framework or library selection
- Data storage strategy
- Plugin API design
- Algorithm or approach selection for critical functionality
- New external dependency additions
- Major refactoring decisions
- Integration architecture decisions
