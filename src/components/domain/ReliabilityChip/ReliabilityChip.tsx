/**
 * ReliabilityChip — a quiet, selective annotation of a metric's measurement
 * reliability and any active per-session data-quality flag.
 *
 * Design contract (consensus D2 / D6, see docs/accuracy/_consensus.md and the
 * `ui-design` + `ux` proposals):
 *
 * - **`high` tier renders nothing.** Absence of a chip *is* the trust signal
 *   — high-reliability metrics (pressure, usage, clean apnea counts) must look
 *   exactly as before. This is the key anti-clutter rule.
 * - **`moderate`** → outline-triangle icon + "Estimate".
 * - **`low`** → hexagon icon + "Modeled".
 * - An active **data-quality flag** (e.g. `high-leak`) is shown as a separate
 *   filled-warning `!` chip with the flag's label (e.g. "Leak-affected"). It is
 *   orthogonal to the tier and may co-occur with it.
 *
 * Reliability lives on the desaturated VIOLET/NEUTRAL colour axis only; the
 * red/orange clinical-severity axis is never used here. Every state carries a
 * non-colour cue (a distinct icon shape AND a text label), satisfying WCAG
 * 1.4.1.
 *
 * The chip is a focusable `<button>` that exposes its `reason` through the
 * shared Radix `Tooltip` on hover and keyboard focus. It uses
 * `role="status"` semantics (informational), never `role="alert"` — a soft
 * metric is information, not an error (ux §5).
 *
 * @module components/domain/ReliabilityChip
 */

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { JSX } from 'react';

import {
  dataQualityFlagLabel,
  reliabilityTierLabel,
  type DataQualityFlag,
  type ReliabilityTier,
} from '@/analysis/uncertainty';

import styles from './ReliabilityChip.module.css';

export interface ReliabilityChipProps {
  /** Intrinsic reliability tier of the metric in its current context. */
  readonly tier: ReliabilityTier;
  /** Active per-session data-quality flags (orthogonal to the tier). */
  readonly flags?: readonly DataQualityFlag[];
  /**
   * Plain-language explanation surfaced in the tooltip and folded into the
   * accessible name (e.g. "Aggregate AHI is algorithmically detected and
   * undercounts vs PSG.").
   */
  readonly reason?: string;
  /** Optional override className applied to the chip group. */
  readonly className?: string;
}

/** A single rendered chip entry (tier chip or flag chip). */
interface ChipEntry {
  readonly key: string;
  readonly kind: 'tier-moderate' | 'tier-low' | 'flag';
  readonly label: string;
  readonly icon: JSX.Element;
}

/**
 * Render the reliability/data-quality chips for a metric, or `null` when there
 * is nothing decision-relevant to show (high tier with no active flags).
 */
export function ReliabilityChip({
  tier,
  flags,
  reason,
  className,
}: ReliabilityChipProps): JSX.Element | null {
  const entries = buildEntries(tier, flags ?? []);
  if (entries.length === 0) return null;

  const groupClass = [styles.group, className].filter(Boolean).join(' ');

  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <span className={groupClass}>
        {entries.map((entry) => (
          <ReliabilityChipButton key={entry.key} entry={entry} reason={reason} />
        ))}
      </span>
    </TooltipPrimitive.Provider>
  );
}

/** A single focusable chip with its tooltip. */
function ReliabilityChipButton({
  entry,
  reason,
}: {
  readonly entry: ChipEntry;
  readonly reason?: string;
}): JSX.Element {
  // Full sentence for the accessible name: state + reason. The visible icon and
  // text are aria-hidden so a screen reader hears the summary once.
  const ariaLabel = reason ? `${entry.label}: ${reason}` : entry.label;
  const chipClass = [styles.chip, styles[entry.kind]].join(' ');

  const button = (
    <button
      type="button"
      className={chipClass}
      // Informational, NOT an alert. The chip never interrupts the SR user.
      role="status"
      aria-label={ariaLabel}
      data-kind={entry.kind}
    >
      <span className={styles.icon} aria-hidden="true">
        {entry.icon}
      </span>
      <span className={styles.label} aria-hidden="true">
        {entry.label}
      </span>
    </button>
  );

  // No reason → no tooltip; the aria-label still carries the label.
  if (!reason) return button;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{button}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className={styles.tooltip} side="top" sideOffset={4}>
          {reason}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/**
 * Build the ordered list of chips to render. The tier chip (if any) comes
 * first, followed by one chip per active data-quality flag. A `high` tier
 * contributes no tier chip.
 */
function buildEntries(tier: ReliabilityTier, flags: readonly DataQualityFlag[]): ChipEntry[] {
  const entries: ChipEntry[] = [];

  if (tier === 'moderate') {
    entries.push({
      key: 'tier',
      kind: 'tier-moderate',
      label: reliabilityTierLabel('moderate'),
      icon: <TriangleOutlineIcon />,
    });
  } else if (tier === 'low') {
    entries.push({
      key: 'tier',
      kind: 'tier-low',
      label: reliabilityTierLabel('low'),
      icon: <HexagonOutlineIcon />,
    });
  }

  for (const flag of flags) {
    entries.push({
      key: `flag-${flag}`,
      kind: 'flag',
      label: dataQualityFlagLabel(flag),
      icon: <WarningFilledIcon />,
    });
  }

  return entries;
}

/* --- Icons -----------------------------------------------------------------
 * Hand-rolled inline SVG (no icon dependency — privacy/bundle constraint),
 * 24×24 viewBox, recoloured via `currentColor`, decorative (aria-hidden via
 * the wrapping span). Shapes are deliberately distinct so the cue survives
 * colour loss / colour-blindness (WCAG 1.4.1). */

/** Moderate: a quiet OUTLINE triangle (no exclamation) — "estimate". */
function TriangleOutlineIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <path d="M12 4 L21 19 H3 Z" />
    </svg>
  );
}

/** Low: an OUTLINE hexagon — "modeled / inferred", visually unlike a warning. */
function HexagonOutlineIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <path d="M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z" />
    </svg>
  );
}

/** Data-quality flag: a FILLED warning triangle with `!` — the conventional
 * caveat cue, distinct from the quiet outline triangle. */
function WarningFilledIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" focusable="false">
      <path
        d="M12 4 L21 19 H3 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M12 10 V14 M12 17 h.01"
        stroke="var(--color-surface-elevated)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default ReliabilityChip;
