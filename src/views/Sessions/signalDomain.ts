/**
 * Hybrid display-domain resolution for Signal Viewer CPAP lanes.
 *
 * ## Why this exists
 *
 * EDF channel headers carry `physicalMin`/`physicalMax`. Those are **decode
 * calibration anchors** — the physical values that map to the digital extremes
 * of the sample encoding — NOT sensible *display* bounds. Scaling a lane's
 * y-axis to them produces two failure modes:
 *
 * 1. Declared range too *narrow* → real data (e.g. a leak spike) exceeds the
 *    range and the waveform flat-tops / clips against the lane edge.
 * 2. Declared range too *wide* → the actual signal occupies a sliver of the
 *    lane, wasting vertical resolution.
 *
 * The renderer ({@link module:components/charts/canvas/SignalRenderer}) keeps
 * consuming `physicalMin`/`physicalMax` as the **lane display bounds** (its
 * normalisation maths is correct given good bounds). This module computes the
 * *good bounds*: a clinical default range that is **expanded only** to cover
 * what the session's data actually needs, with plausibility clamps so a single
 * corrupt sample can't blow out the axis.
 *
 * The DECODE path (EDF header → sample decoding) is untouched; only the DISPLAY
 * path changes, at channel-construction time in `SignalViewer.tsx`.
 *
 * ## Future direction
 *
 * The clinical range table below is keyed by the app's standardized channel
 * names and is, today, ResMed-derived (see {@link RESMED_CLINICAL_RANGES}). It
 * is exported as a named table so a future machine plugin can supply its own
 * clinical defaults; the resolver already falls back to the EDF declared range
 * for any channel absent from the table, so this stays additive and safe for
 * machines/channels we don't yet have clinical knowledge of. Full per-plugin
 * wiring is intentionally out of scope here.
 *
 * @module views/Sessions/signalDomain
 */

/** Per-signal expansion behaviour. */
export type DomainBehavior =
  /** Expand symmetrically around 0: bound = max(default, |dataMin|, |dataMax|). */
  | 'symmetric'
  /** Keep min anchored; only the max edge may grow upward. */
  | 'expandUp'
  /** Either edge may grow outward from the clinical default. */
  | 'expandBoth'
  /** Max pinned at the clinical max; only the min edge may grow downward. */
  | 'downwardOnly'
  /** Never expand; out-of-range samples are decode errors and are clamped. */
  | 'fixed';

/** One clinical range entry for a standardized channel name. */
export interface ClinicalRange {
  /** Clinical default lower bound (display units). */
  readonly min: number;
  /** Clinical default upper bound (display units). */
  readonly max: number;
  /** How auto-expansion is allowed to move each edge. */
  readonly behavior: DomainBehavior;
  /**
   * Plausibility ceiling for the upper edge (display units). Auto-expansion is
   * clamped to this; beyond it we clamp (do not stretch). Omit when not
   * applicable (e.g. `fixed`).
   */
  readonly clampMax?: number;
  /**
   * Plausibility floor for the lower edge (display units). Used by behaviours
   * that grow downward (`downwardOnly`, `expandBoth`).
   */
  readonly clampMin?: number;
  /**
   * Symmetric-bound ceiling (display units), for `symmetric` behaviour: the
   * computed `bound` is clamped to this before forming `[-bound, +bound]`.
   */
  readonly clampBound?: number;
  /**
   * Minimum span (hi - lo) to guarantee, guarding against divide-by-zero in the
   * renderer for degenerate/flat data.
   */
  readonly minSpan: number;
  /**
   * Optional unit guard. When set, the entry only applies if the descriptor's
   * `unit` matches (case-insensitive). Lets us key e.g. tidal volume on whether
   * the channel is encoded in mL vs L. See {@link computeLaneDomain}.
   */
  readonly unit?: string;
}

/**
 * ResMed clinical display ranges, keyed by the app's standardized channel
 * names (see `CHANNEL_MAP` in `src/parsers/resmed/ResMedInterpreter.ts`).
 *
 * Sourced from the resmed-specialist. Exported as a named, machine-scoped table
 * so a future machine plugin can register its own; see the module docstring.
 *
 * Tidal volume is special: ResMed AirSense channels encode it in **mL**
 * (`tidvol.2s`), so the default entry is mL. A litres-encoded variant
 * (`unit: 'L'`) is provided for machines that report it in L; the resolver
 * selects by the descriptor's runtime `unit` string.
 */
export const RESMED_CLINICAL_RANGES: Readonly<
  Record<string, ClinicalRange | readonly ClinicalRange[]>
> = {
  flow: { min: -60, max: 60, behavior: 'symmetric', clampBound: 200, minSpan: 10 },
  pressure: { min: 0, max: 25, behavior: 'expandUp', clampMax: 60, minSpan: 2 },
  maskPressure: { min: 0, max: 25, behavior: 'expandUp', clampMax: 60, minSpan: 2 },
  epap: { min: 0, max: 25, behavior: 'expandUp', clampMax: 60, minSpan: 2 },
  ipap: { min: 0, max: 30, behavior: 'expandUp', clampMax: 60, minSpan: 2 },
  eprPressure: { min: 0, max: 25, behavior: 'expandUp', clampMax: 60, minSpan: 2 },
  leak: { min: 0, max: 60, behavior: 'expandUp', clampMax: 200, minSpan: 5 },
  respRate: { min: 0, max: 30, behavior: 'expandUp', clampMax: 60, minSpan: 2 },
  // Tidal volume: mL by default; litres variant keyed on unit.
  tidalVolume: [
    { min: 0, max: 1.0, behavior: 'expandUp', clampMax: 3.0, minSpan: 0.1, unit: 'L' },
    { min: 0, max: 1000, behavior: 'expandUp', clampMax: 3000, minSpan: 50 },
  ],
  minuteVent: { min: 0, max: 20, behavior: 'expandUp', clampMax: 40, minSpan: 2 },
  spo2: { min: 85, max: 100, behavior: 'downwardOnly', clampMin: 50, minSpan: 2 },
  pulse: { min: 40, max: 120, behavior: 'expandBoth', clampMin: 20, clampMax: 240, minSpan: 5 },
  snore: { min: 0, max: 1, behavior: 'expandUp', clampMax: 10, minSpan: 0.1 },
  flowLimitation: { min: 0, max: 1, behavior: 'fixed', minSpan: 0.1 },
};

/** Fraction of the expanded span used to pad data-pushed edges. */
const PAD_FRACTION = 0.05;

// ---------------------------------------------------------------------------
// Nice-number helpers
// ---------------------------------------------------------------------------
//
// These mirror the [1,2,5]·10^k step ladder used by `chooseYTicks` in
// `SignalRenderer.ts` so that expanded bounds land on (or just outside)
// gridlines rather than at arbitrary fractional values.

/** The [1,2,5]·10^k step that is >= `target`, for a positive target. */
function niceStep(target: number): number {
  if (!(target > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
  for (const n of [1, 2, 5, 10]) {
    if (n * magnitude >= target) return n * magnitude;
  }
  return 10 * magnitude;
}

/**
 * Round `value` *outward toward -∞* to a multiple of a nice step derived from
 * `span`. Used for expanded lower edges so the axis lands on a gridline.
 */
export function niceFloor(value: number, span: number): number {
  const step = niceStep(span / 5);
  if (!(step > 0)) return value;
  return Math.floor(value / step) * step;
}

/**
 * Round `value` *outward toward +∞* to a multiple of a nice step derived from
 * `span`. Used for expanded upper edges so the axis lands on a gridline.
 */
export function niceCeil(value: number, span: number): number {
  const step = niceStep(span / 5);
  if (!(step > 0)) return value;
  return Math.ceil(value / step) * step;
}

// ---------------------------------------------------------------------------
// Domain resolution
// ---------------------------------------------------------------------------

/** Inputs to {@link computeLaneDomain}. */
export interface LaneDomainOptions {
  /** Standardized channel name (key into the clinical table). */
  readonly channelName: string;
  /** Descriptor unit string (used for unit-keyed entries, e.g. tidal volume). */
  readonly unit?: string;
  /** EDF declared lower bound (decode anchor) — the safe fallback. */
  readonly declaredMin: number;
  /** EDF declared upper bound (decode anchor) — the safe fallback. */
  readonly declaredMax: number;
  /** Observed finite data minimum across the whole session, if known. */
  readonly dataMin?: number;
  /** Observed finite data maximum across the whole session, if known. */
  readonly dataMax?: number;
  /** Clinical table to resolve against (defaults to the ResMed table). */
  readonly table?: Readonly<Record<string, ClinicalRange | readonly ClinicalRange[]>>;
}

/** Resolved display domain for a lane. */
export interface LaneDomain {
  readonly min: number;
  readonly max: number;
}

/** Pick the clinical entry for a channel, honouring any unit guard. */
function resolveEntry(
  table: Readonly<Record<string, ClinicalRange | readonly ClinicalRange[]>>,
  channelName: string,
  unit: string | undefined,
): ClinicalRange | null {
  const raw = table[channelName];
  if (!raw) return null;
  const candidates = Array.isArray(raw) ? raw : [raw];
  const u = unit?.trim().toLowerCase();
  // Prefer an entry whose unit guard matches; fall back to the first unguarded entry.
  let unguarded: ClinicalRange | null = null;
  for (const c of candidates) {
    if (c.unit === undefined) {
      if (unguarded === null) unguarded = c;
      continue;
    }
    if (u !== undefined && c.unit.toLowerCase() === u) return c;
  }
  return unguarded ?? candidates[0] ?? null;
}

/**
 * Compute the display domain for one lane.
 *
 * Pure function — given identical inputs it always returns the same `{min,max}`,
 * which keeps it trivially unit-testable.
 *
 * Algorithm:
 * 1. Seed `[lo, hi]` from the clinical default (or the EDF declared range when
 *    the channel has no clinical entry — preserving legacy behaviour).
 * 2. Expand-only to cover finite `dataMin`/`dataMax`, respecting the per-signal
 *    behaviour (symmetric around 0 for flow; SpO₂ pinned at 100 and downward
 *    only; flow limitation never expands).
 * 3. Plausibility-clamp the auto-expansion to a per-signal ceiling/floor so a
 *    single corrupt sample can't blow out the axis (beyond the clamp, clamp).
 * 4. Asymmetric padding: pad only the edge(s) that *data* pushed beyond the
 *    clinical default (~5% of span); leave clinically-anchored edges exact.
 * 5. Nice-number rounding: round *expanded* edges outward to a [1,2,5]·10^k
 *    step; leave clinical/anchored edges exact.
 * 6. Degenerate guard: ensure `hi - lo >= minSpan`.
 */
export function computeLaneDomain(opts: LaneDomainOptions): LaneDomain {
  const table = opts.table ?? RESMED_CLINICAL_RANGES;
  const entry = resolveEntry(table, opts.channelName, opts.unit);

  // Unknown channel → fall back to the EDF declared range (legacy behaviour).
  if (!entry) {
    const lo = Number.isFinite(opts.declaredMin) ? opts.declaredMin : 0;
    const hi = Number.isFinite(opts.declaredMax) ? opts.declaredMax : lo + 1;
    // Degenerate / non-ordered declared range → minimal safe window.
    if (!(hi > lo)) return { min: lo, max: lo + 1 };

    // Generic sanity guard (defense for unknown/future-machine channels, which
    // are non-clinical here so a plain numeric guard is sufficient). A crafted
    // EDF can declare an absurd physical range (e.g. physicalMax = 1e300),
    // yielding an illegible axis. We only guard the *fallback* path; known
    // clinical channels keep their tuned behaviour above.
    const GENERIC_MAX_MAGNITUDE = 1e6;
    const GENERIC_MAX_SPAN = 1e6;
    const absurd =
      hi - lo > GENERIC_MAX_SPAN ||
      Math.abs(lo) > GENERIC_MAX_MAGNITUDE ||
      Math.abs(hi) > GENERIC_MAX_MAGNITUDE;
    if (!absurd) return { min: lo, max: hi };

    // Prefer the channel's observed finite data extent, nice-rounded with a
    // small pad, so the axis covers real data without the absurd declared edges.
    const dLo = Number.isFinite(opts.dataMin) ? (opts.dataMin as number) : undefined;
    const dHi = Number.isFinite(opts.dataMax) ? (opts.dataMax as number) : undefined;
    if (dLo !== undefined && dHi !== undefined && dHi > dLo) {
      const span = dHi - dLo;
      const pad = span * PAD_FRACTION;
      return { min: niceFloor(dLo - pad, span), max: niceCeil(dHi + pad, span) };
    }

    // No usable data extent → clamp the declared span to a generic readable
    // window anchored at the (now bounded) lower edge.
    const safeLo = Math.max(-GENERIC_MAX_MAGNITUDE, Math.min(lo, GENERIC_MAX_MAGNITUDE));
    return { min: safeLo, max: safeLo + GENERIC_MAX_SPAN };
  }

  const dataMin = Number.isFinite(opts.dataMin) ? (opts.dataMin as number) : undefined;
  const dataMax = Number.isFinite(opts.dataMax) ? (opts.dataMax as number) : undefined;

  // ── Symmetric (flow) ──────────────────────────────────────────
  if (entry.behavior === 'symmetric') {
    let bound = Math.max(entry.max, Math.abs(entry.min));
    const absData = Math.max(
      dataMin !== undefined ? Math.abs(dataMin) : 0,
      dataMax !== undefined ? Math.abs(dataMax) : 0,
    );
    const expanded = absData > bound;
    if (expanded) bound = absData;
    if (entry.clampBound !== undefined) bound = Math.min(bound, entry.clampBound);
    if (expanded) {
      bound += bound * 2 * PAD_FRACTION; // pad relative to the full [-bound,+bound] span
      bound = niceCeil(bound, bound);
      // Re-apply the clamp AFTER nice-rounding (mirrors the expandUp/expandBoth
      // path): niceCeil can round a near-clampBound value slightly above it, so
      // re-clamp to guarantee the final bound never exceeds clampBound.
      if (entry.clampBound !== undefined) bound = Math.min(bound, entry.clampBound);
    }
    bound = Math.max(bound, entry.minSpan / 2);
    return { min: -bound, max: bound };
  }

  // ── Fixed (flow limitation) ───────────────────────────────────
  if (entry.behavior === 'fixed') {
    return { min: entry.min, max: entry.max };
  }

  // ── Expand-up / expand-both / downward-only ───────────────────
  let lo = entry.min;
  let hi = entry.max;
  let loExpanded = false;
  let hiExpanded = false;

  const canGrowDown = entry.behavior === 'expandBoth' || entry.behavior === 'downwardOnly';
  const canGrowUp = entry.behavior === 'expandUp' || entry.behavior === 'expandBoth';

  if (canGrowDown && dataMin !== undefined && dataMin < lo) {
    lo = dataMin;
    loExpanded = true;
  }
  if (canGrowUp && dataMax !== undefined && dataMax > hi) {
    hi = dataMax;
    hiExpanded = true;
  }

  // Plausibility clamps on the auto-expanded edges only.
  if (hiExpanded && entry.clampMax !== undefined && hi > entry.clampMax) hi = entry.clampMax;
  if (loExpanded && entry.clampMin !== undefined && lo < entry.clampMin) lo = entry.clampMin;

  // Asymmetric padding + nice rounding on data-pushed edges only.
  const span = hi - lo;
  const pad = span > 0 ? span * PAD_FRACTION : entry.minSpan * PAD_FRACTION;
  if (hiExpanded) {
    hi = niceCeil(hi + pad, span);
    if (entry.clampMax !== undefined) hi = Math.min(hi, entry.clampMax);
  }
  if (loExpanded) {
    lo = niceFloor(lo - pad, span);
    if (entry.clampMin !== undefined) lo = Math.max(lo, entry.clampMin);
  }

  // Degenerate guard.
  if (hi - lo < entry.minSpan) {
    if (canGrowUp) {
      hi = lo + entry.minSpan;
    } else {
      // downwardOnly: hi is pinned, grow lo downward.
      lo = hi - entry.minSpan;
    }
  }

  return { min: lo, max: hi };
}
