# 0021 — Automated CalVer Release Pipeline in GitHub Actions

## Status

Accepted

- **Date:** 2026-06-18
- **Deciders:** `devops` (lead), with `orchestrator` coordination.

## Context

[0014](0014-calver-release-management.md) mandates Calendar Versioning in
`YYYY.0M.MICRO` form and [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
changelog discipline, and describes a release process that "determines next
version, tags commit, generates release notes" automatically.
[0012](0012-github-actions-ci-cd.md) and
[0013](0013-github-pages-hosting.md) established continuous deployment: every
merge to `main` runs the quality gates (audit → lint → type-check → unit → e2e →
build) and auto-deploys the result to GitHub Pages. There is no staging step and
no human in the deploy loop — production is whatever is on `main`.

The release half of that picture was never actually built. `ci.yml` ran the
gates and the Pages deploy and **nothing else**: there was no versioning,
tagging, or release step anywhere in the pipeline. The consequences had
accumulated:

- `package.json` was pinned at `0.0.0` and had been since the project began.
- There were **no git tags** (`vYYYY.0M.*`) and **no GitHub Releases**.
- `CHANGELOG.md` had months of shipped, in-production work piled under a single
  `[Unreleased]` heading, with no dated release sections beneath it.

So the CalVer requirement of [0014](0014-calver-release-management.md) was
documented but inert. The only path to a release was the manual
`calver-release` skill — a sequence of seven shell steps a human had to remember
to run. With fully automated deploys, nobody ever did: the code shipped, the
version never moved. The version record had silently diverged from reality, and
every continuous deploy widened the gap. This is a Correctness concern in the
sense that the project values most after Privacy — not clinical correctness, but
honesty of the project's own record: the published version must reflect what is
actually in production.

The fix has to live where the work already happens. Because deploys are
zero-touch, the release must be zero-touch too; any process that depends on a
person performing a step is the process that just failed.

## Decision Drivers

Resolved against the project priority order (Privacy > Correctness > Performance >
UX > Features), plus release-specific concerns:

- **Privacy.** Untouched. Releasing is repository metadata (tags, changelog,
  GitHub Release); it adds no telemetry, no backend, and no data egress, in line
  with [0015](0015-zero-telemetry-analytics.md).
- **Correctness (of the version record).** The version on `main`, the latest git
  tag, and the latest GitHub Release must agree with what is deployed. The whole
  problem is that they didn't; the chosen option must make them agree
  automatically and keep them agreeing.
- **Zero-touch operation.** Deploys require no human decision, so releases must
  not either. A release mechanism that needs someone to merge a PR or run a
  script is the status quo that demonstrably failed.
- **No new runtime dependency.** The bespoke `YYYY.0M.MICRO` scheme is the
  contract; the tool must serve the scheme, not the reverse. Adding a release
  framework whose model is semver-shaped is impedance mismatch we'd fight forever.
- **Alignment with existing standards.** Must compose cleanly with the
  established Conventional Commits, CalVer ([0014](0014-calver-release-management.md)),
  and Keep a Changelog conventions rather than replacing them.

## Considered Options

### 1. A custom release job inside the existing `ci.yml` (chosen)

A first-party job, gated behind the existing quality jobs, that computes the next
CalVer version from git tags, transforms `CHANGELOG.md`, bumps `package.json`,
commits, tags, and publishes a GitHub Release — all in shell and `gh`/`git` the
project already has.

- **Pros:** Full control over the exact `YYYY.0M.MICRO` semantics, including the
  "MICRO = highest existing `vYYYY.0M.*` MICRO + 1" rule that no off-the-shelf
  tool models. No new third-party runtime dependency. Lives in the one workflow
  that
  already deploys, so "deployed" and "released" become the same event by
  construction. No impedance mismatch with the house versioning scheme.
- **Cons:** We own the logic, including its edge cases (empty changelog,
  recursive triggering, the commit-back permission). More YAML and shell to
  maintain and test than adopting a maintained tool.

### 2. `semantic-release`

A mature, fully automated release tool that derives the next version from
Conventional Commit messages.

- **Pros:** Battle-tested, fully automated, native Conventional Commits support,
  large plugin ecosystem.
- **Cons:** Fundamentally **semver-oriented** — it computes MAJOR/MINOR/PATCH
  from commit types. [0014](0014-calver-release-management.md) deliberately
  rejected semver for this end-user app precisely because "breaking change" is
  meaningless here. Bending `semantic-release` to emit `YYYY.0M.MICRO` means
  overriding its core analyzer and version logic — fighting the tool's central
  assumption. **Rejected.**

### 3. `release-please`

Google's "release PR" tool: it maintains an open pull request that accumulates
changelog entries and the version bump, which a human merges to cut the release.

- **Pros:** Popular, maintained, good changelog automation, clear review point
  before a release.
- **Cons:** The release-PR model **reintroduces a manual merge step**, which is
  exactly the human-in-the-loop dependency that failed here — it is not pure
  continuous deployment. It is also semver-centric and does not natively model
  the `YYYY.0M.MICRO`/tag-count scheme. **Rejected.**

### 4. Status quo — manual `calver-release` skill run

Keep the documented seven-step manual process and rely on discipline.

- **Pros:** Zero new automation; the process is already written down.
- **Cons:** It depends on a human remembering to run it after an automated
  deploy, and **this is the option that has already failed** — it is the direct
  cause of `0.0.0`, zero tags, and the months-long `[Unreleased]` backlog.
  Re-choosing it re-chooses the failure. **Rejected.**

## Decision Outcome

Adopt **option 1**: automated CalVer releasing as a job inside the existing
GitHub Actions CI/CD pipeline. Every merge to `main` already deploys to
production; the pipeline now also cuts a release on each deploy, with **zero
human decisions**.

### Versioning rule

The next version is `YYYY.0M.MICRO` where `YYYY.0M` is the current year and
zero-padded month, and **`MICRO` is one greater than the highest `MICRO` among
existing `vYYYY.0M.*` git tags, starting at `0`** when no tags exist for the
current month. The first release in a month is `.0`; each subsequent release
that month is the current maximum `MICRO` plus one. Computing from the highest
existing MICRO rather than from a raw tag count is deliberately gap-safe: if a
tag is ever deleted, a count-based rule would recompute a number that already
exists and collide, whereas highest+1 never reuses a `MICRO`. This is the same
rule the `calver-release` skill documents, now executed by CI from the tag
history rather than by a human.

### Trigger and gating

The release job runs **only on push to `main`** (never on pull requests) and
**only after the existing CI jobs pass** — audit, lint, type-check, unit, e2e,
and build all gate it. Releasing is therefore part of, and downstream of, the
same green pipeline that already authorizes the Pages deploy; an unreleasable
build is also an undeployable one.

### What the job does

On a gated push to `main`, the job:

1. **Checks for releasable content.** If the `[Unreleased]` section of
   `CHANGELOG.md` is empty, it **cuts no release** and exits — deploys without
   changelog entries (e.g. CI-only or infra commits) produce no empty, noise
   release.
2. **Computes the version** from the rule above (current `YYYY.0M` + the highest
   existing `vYYYY.0M.*` MICRO plus one, or `.0` when none exist this month).
3. **Transforms the changelog:** moves `[Unreleased]` into a dated
   `## [YYYY.0M.MICRO] — YYYY-MM-DD` section and re-opens a fresh empty
   `[Unreleased]`.
4. **Bumps `package.json`** `version` to the new CalVer string.
5. **Commits back to `main`** with the changelog and version bump, carrying a
   **CI-skip guard** in the commit so this commit does not re-trigger the
   pipeline (preventing an infinite release loop).
6. **Creates an annotated tag** `vYYYY.0M.MICRO`.
7. **Publishes a GitHub Release** whose body is the changelog section just cut.

### Baseline

Because the version record had diverged, a **one-time baseline release
`2026.06.0` (dated 2026-06-18)** is cut now to capture the current production
state, moving the accumulated `[Unreleased]` backlog into a single dated
section. Automation increments from this baseline — the next changelog-bearing
deploy in June 2026 becomes `2026.06.1`, and so on.

## Consequences

### Positive

- **The failure cannot recur.** Releasing is now a property of the pipeline, not
  of anyone's memory; "deployed" and "released" are the same event by
  construction.
- **Every deploy is versioned.** Each production change that carries changelog
  content gets a tag, a `package.json` bump, and a GitHub Release, so the
  published version, the latest tag, and what is live agree automatically.
- **Honest history going forward.** The `[Unreleased]` backlog can no longer
  silently accumulate; entries are dated and released on the deploy that ships
  them.
- **No semver impedance and no new runtime dependency.** The bespoke
  `YYYY.0M.MICRO` (highest-MICRO-plus-one) scheme is implemented exactly as
  [0014](0014-calver-release-management.md) specifies, using only `git` and `gh`
  the project already depends on.
- **Empty releases are suppressed.** The empty-`[Unreleased]` check keeps
  infra/CI-only deploys from generating meaningless release noise.
- **No privacy or performance cost.** Releasing is repository metadata only — no
  telemetry, no backend, consistent with [0015](0015-zero-telemetry-analytics.md).

### Negative

- **CI now writes to `main`.** The job commits the changelog/version bump back,
  which requires granting the workflow `contents: write` — a broader permission
  than a read-only test pipeline, and a larger blast radius if the workflow or a
  token is compromised. This must be scoped to the release job and reviewed as a
  security-relevant change.
- **Recursive-trigger risk.** A job that pushes to the branch that triggers it
  can loop. It is mitigated by the CI-skip guard on the release commit, but that
  guard is now load-bearing: if it regresses, the pipeline can self-trigger
  repeatedly.
- **The baseline collapses untracked history.** `2026.06.0` folds months of
  already-shipped, never-versioned work into one dated section. That history is
  real but was never released incrementally, so the baseline cannot reconstruct
  per-release boundaries that were never recorded.
- **More owned logic to maintain.** The version computation, changelog
  transform, and loop-guard are first-party shell/YAML and must be tested and
  kept correct ourselves, rather than delegated to a maintained release tool.

### Neutral

- **`package.json` leaves `0.0.0` permanently.** From the baseline on it tracks
  the CalVer version; the historical `0.0.0` simply reflects the pre-automation
  gap and is not restored.
- **MICRO resets each month by construction.** Because it considers only
  `vYYYY.0M.*` tags for the current month, the first release of every month has
  no prior MICRO to exceed and is therefore `.0`; this is the intended CalVer
  behavior, not a discontinuity.
- **Deploys without changelog entries remain releaseless by design.** A green,
  deployed build with an empty `[Unreleased]` is live but unversioned until the
  next changelog-bearing change — an intentional consequence of suppressing empty
  releases.

## Related Decisions

- [0014 — Calendar Versioning (CalVer) for Release Management](0014-calver-release-management.md) — defines the `YYYY.0M.MICRO` scheme and the manual release process this ADR automates.
- [0012 — GitHub Actions for CI/CD](0012-github-actions-ci-cd.md) — the pipeline this release job is added to, and the quality gates that now also gate releasing.
- [0013 — GitHub Pages Hosting](0013-github-pages-hosting.md) — the continuous-deploy-on-merge model that makes a zero-touch release mandatory rather than optional.
- [0015 — Zero Telemetry / Analytics](0015-zero-telemetry-analytics.md) — the privacy posture this change preserves; releasing adds only repository metadata, no egress.
