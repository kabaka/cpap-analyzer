/**
 * Gated, default-OFF import-pipeline profiler.
 *
 * ## Purpose
 * Measure where wall-time goes during a CPAP or Fitbit import — per phase
 * (parse / build / validate / store split into IndexedDB vs OPFS), plus worker-
 * pool busy/idle occupancy — so the import-parallelization effort can be driven
 * by hard numbers instead of guesses.
 *
 * ## Zero-overhead-when-off contract
 * The profiler is a NO-OP unless explicitly enabled via the global switch
 * `globalThis.__IMPORT_PROFILE__ = true` BEFORE an import starts. When disabled:
 * - `isEnabled()` returns `false` after a single cheap property read,
 * - every recording method early-returns before doing any work,
 * - nothing is attached to `globalThis`, and no timers/arrays are allocated.
 *
 * This means production behaviour, the public {@link ImportRecord} type, the
 * service signatures, and existing tests are all unaffected — the instrumentation
 * is inert dead-weight (a handful of guarded calls) on the default path.
 *
 * ## How it is read back
 * On `finish()` (when enabled) the aggregated {@link ImportProfile} is published
 * to `globalThis.__IMPORT_PROFILE_RESULT__` so a Playwright/bench harness can read
 * it after the import promise resolves. It is also returned from `finish()` for
 * direct callers.
 *
 * ## Why a module singleton (not DI)
 * The pipeline already threads many parameters; adding a profiler argument to
 * every private method (and to the OPFS service, which lives in another module)
 * would be invasive and would leak a test-only concern into production
 * signatures. A guarded module singleton keeps the touch-points to one-line
 * `profiler.x()` calls that compile away to a cheap disabled-check on the hot
 * path. The switch is read live each `begin()` so a harness can toggle it per run.
 *
 * @module services/import/profiling/ImportProfiler
 */

// ---------------------------------------------------------------------------
// Public profile shape
// ---------------------------------------------------------------------------

/** A single named phase's accumulated wall time. */
export interface PhaseTotals {
  /** Total wall time attributed to this phase, in milliseconds. */
  totalMs: number;
  /** Number of timed spans folded into {@link totalMs}. */
  count: number;
}

/** Per-CPAP-day-group timing breakdown. */
export interface DayGroupSample {
  /** Day-folder name (`YYYYMMDD`) or `(root)`. */
  readonly dayFolder: string;
  /** Files parsed in this day-group. */
  readonly files: number;
  /** Sum of parsed source-buffer bytes for this day-group. */
  readonly parsedBytes: number;
  /** Wall time spent parsing this day's files (pool-concurrent), ms. */
  readonly parseMs: number;
  /** Wall time spent building sessions for this day, ms. */
  readonly buildMs: number;
  /** Wall time spent validating this day's sessions, ms. */
  readonly validateMs: number;
  /** Wall time spent storing (IDB + OPFS) this day's sessions, ms. */
  readonly storeMs: number;
  /** Of {@link storeMs}, the IndexedDB metadata-write portion, ms. */
  readonly storeIdbMs: number;
  /** Of {@link storeMs}, the OPFS chunk-write portion, ms. */
  readonly storeOpfsMs: number;
  /** OPFS chunk files written across this day's sessions. */
  readonly opfsChunks: number;
}

/** Per-Fitbit-data-type timing breakdown. */
export interface FitbitTypeSample {
  readonly dataType: string;
  readonly files: number;
  /** Wall time spent parsing this type's files, ms. */
  readonly parseMs: number;
  /** Wall time spent storing this type's records, ms. */
  readonly storeMs: number;
  /**
   * Parse-idle-during-store: wall time the (single) parser sat idle because the
   * orchestrator was busy storing the previous file's records before reading the
   * next file. This is the cost the Fitbit pipelining opportunity would reclaim.
   */
  readonly parseIdleDuringStoreMs: number;
}

/** Worker-pool occupancy summary across the whole import. */
export interface PoolOccupancy {
  /** Pool size (max workers) observed. */
  readonly poolSize: number;
  /** Number of occupancy samples taken. */
  readonly samples: number;
  /** Mean fraction of the pool busy (0..1) across samples. */
  readonly avgBusyFraction: number;
  /** Peak number of workers simultaneously busy. */
  readonly peakBusy: number;
  /**
   * Sum of worker-seconds busy / sum of worker-seconds available, integrated
   * over time (time-weighted, not sample-count-weighted). 0..1.
   */
  readonly timeWeightedBusyFraction: number;
  /** Total wall time the pool was observed, ms. */
  readonly observedMs: number;
}

/** The complete aggregated profile published at import end. */
export interface ImportProfile {
  readonly kind: 'cpap' | 'fitbit';
  /** Total import wall time, ms. */
  readonly totalMs: number;
  /** Phase → accumulated totals (parse/build/validate/store/storeIdb/storeOpfs/scan/str). */
  readonly phases: Readonly<Record<string, PhaseTotals>>;
  /** Per-phase percentage of {@link totalMs}. */
  readonly phasePercent: Readonly<Record<string, number>>;
  readonly pool: PoolOccupancy | null;
  readonly cpapDayGroups: readonly DayGroupSample[];
  readonly fitbitTypes: readonly FitbitTypeSample[];
  /** Aggregate parsed-buffer byte stats for the CPAP per-day memory-budget calc. */
  readonly perDayParsedBytes: {
    readonly max: number;
    readonly mean: number;
    readonly p95: number;
    readonly total: number;
  } | null;
  /** Hardware concurrency observed (for the machine caveat). */
  readonly hardwareConcurrency: number;
}

// ---------------------------------------------------------------------------
// Internal mutable accumulators
// ---------------------------------------------------------------------------

interface PoolSnapshotFn {
  (): { busy: number; size: number };
}

interface MutableDayGroup {
  dayFolder: string;
  files: number;
  parsedBytes: number;
  parseMs: number;
  buildMs: number;
  validateMs: number;
  storeMs: number;
  storeIdbMs: number;
  storeOpfsMs: number;
  opfsChunks: number;
}

interface MutableFitbitType {
  dataType: string;
  files: number;
  parseMs: number;
  storeMs: number;
  parseIdleDuringStoreMs: number;
}

const PROFILE_FLAG = '__IMPORT_PROFILE__';
const PROFILE_RESULT = '__IMPORT_PROFILE_RESULT__';

/** Monotonic clock; `performance.now()` when available, else `Date.now()`. */
function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

// ---------------------------------------------------------------------------
// Profiler
// ---------------------------------------------------------------------------

/**
 * The gated profiler. All recording methods early-return when disabled, so the
 * overhead on the default (off) path is a single property read per call.
 */
class ImportProfiler {
  private enabled = false;
  private kind: 'cpap' | 'fitbit' = 'cpap';
  private startMs = 0;

  /**
   * Wall time (ms) of the most recently closed {@link open}/{@link span} timing
   * span. Lets callers fold a span's duration into a structured per-unit record
   * (e.g. a day-group sample) without re-measuring. Only meaningful immediately
   * after the span closes and while {@link isEnabled} is true.
   */
  lastSpanMs = 0;

  private readonly phases = new Map<string, PhaseTotals>();
  private readonly dayGroups: MutableDayGroup[] = [];
  private readonly fitbitTypes: MutableFitbitType[] = [];

  // Pool occupancy sampling.
  private poolSnapshot: PoolSnapshotFn | null = null;
  private poolTimer: ReturnType<typeof setInterval> | null = null;
  private poolSize = 0;
  private occSamples = 0;
  private occBusySum = 0;
  private occPeakBusy = 0;
  private occLastSampleMs = 0;
  private occBusyTimeIntegral = 0; // Σ (busyFraction · dtMs)
  private occObservedMs = 0;

  /**
   * Read the live global switch. Cheap; called once per `begin()` so a harness
   * can flip the flag between runs.
   */
  private switchOn(): boolean {
    try {
      return Boolean((globalThis as Record<string, unknown>)[PROFILE_FLAG]);
    } catch {
      return false;
    }
  }

  /** True after a `begin()` that observed the switch on. Hot-path guard. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Start a fresh profiling session. Reads the live switch; if off, the profiler
   * stays inert and every subsequent call is a no-op. Resets all accumulators.
   */
  begin(kind: 'cpap' | 'fitbit'): void {
    this.enabled = this.switchOn();
    if (!this.enabled) return;
    this.kind = kind;
    this.startMs = nowMs();
    this.phases.clear();
    this.dayGroups.length = 0;
    this.fitbitTypes.length = 0;
    this.poolSnapshot = null;
    this.stopPoolSampling();
    this.poolSize = 0;
    this.occSamples = 0;
    this.occBusySum = 0;
    this.occPeakBusy = 0;
    this.occLastSampleMs = 0;
    this.occBusyTimeIntegral = 0;
    this.occObservedMs = 0;
  }

  /** Accumulate `ms` into a named phase total. */
  addPhase(name: string, ms: number): void {
    if (!this.enabled) return;
    const existing = this.phases.get(name);
    if (existing) {
      existing.totalMs += ms;
      existing.count += 1;
    } else {
      this.phases.set(name, { totalMs: ms, count: 1 });
    }
  }

  /**
   * Time an async function and attribute its wall time to `name`. Returns the
   * function's result. When disabled, calls through with zero overhead beyond the
   * guard.
   */
  async span<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!this.enabled) return fn();
    const t0 = nowMs();
    try {
      return await fn();
    } finally {
      const ms = nowMs() - t0;
      this.lastSpanMs = ms;
      this.addPhase(name, ms);
    }
  }

  /**
   * Open a manual timing span; returns a stop fn that records on call and stores
   * the elapsed time in {@link lastSpanMs}.
   */
  open(name: string): () => void {
    if (!this.enabled) return () => undefined;
    const t0 = nowMs();
    return () => {
      const ms = nowMs() - t0;
      this.lastSpanMs = ms;
      this.addPhase(name, ms);
    };
  }

  // --- CPAP per-day-group recording ---------------------------------------

  recordCpapDayGroup(sample: {
    dayFolder: string;
    files: number;
    parsedBytes: number;
    parseMs: number;
    buildMs: number;
    validateMs: number;
    storeMs: number;
    storeIdbMs: number;
    storeOpfsMs: number;
    opfsChunks: number;
  }): void {
    if (!this.enabled) return;
    this.dayGroups.push({ ...sample });
  }

  // --- Fitbit per-type recording ------------------------------------------

  recordFitbitType(sample: {
    dataType: string;
    files: number;
    parseMs: number;
    storeMs: number;
    parseIdleDuringStoreMs: number;
  }): void {
    if (!this.enabled) return;
    this.fitbitTypes.push({ ...sample });
  }

  // --- Pool occupancy sampling --------------------------------------------

  /**
   * Register a snapshot fn the profiler can poll for `{ busy, size }` and start
   * periodic sampling. Idempotent registration replaces any prior fn.
   */
  attachPoolSnapshot(fn: PoolSnapshotFn, intervalMs = 25): void {
    if (!this.enabled) return;
    this.poolSnapshot = fn;
    this.occLastSampleMs = nowMs();
    this.stopPoolSampling();
    this.poolTimer = setInterval(() => this.samplePool(), intervalMs);
    // Take one immediate sample so very short imports still register occupancy.
    this.samplePool();
  }

  private samplePool(): void {
    if (!this.enabled || !this.poolSnapshot) return;
    let snap: { busy: number; size: number };
    try {
      snap = this.poolSnapshot();
    } catch {
      return;
    }
    const now = nowMs();
    const dt = now - this.occLastSampleMs;
    this.occLastSampleMs = now;
    this.poolSize = Math.max(this.poolSize, snap.size);
    const fraction = snap.size > 0 ? snap.busy / snap.size : 0;
    this.occSamples += 1;
    this.occBusySum += fraction;
    this.occPeakBusy = Math.max(this.occPeakBusy, snap.busy);
    if (dt > 0) {
      this.occBusyTimeIntegral += fraction * dt;
      this.occObservedMs += dt;
    }
  }

  private stopPoolSampling(): void {
    if (this.poolTimer !== null) {
      clearInterval(this.poolTimer);
      this.poolTimer = null;
    }
  }

  // --- Finalisation --------------------------------------------------------

  /**
   * Finalise the session: stop sampling, compute aggregates, publish to
   * `globalThis.__IMPORT_PROFILE_RESULT__`, and return the profile. No-op (returns
   * null) when disabled.
   */
  finish(): ImportProfile | null {
    if (!this.enabled) return null;
    this.stopPoolSampling();
    const totalMs = nowMs() - this.startMs;

    const phases: Record<string, PhaseTotals> = {};
    const phasePercent: Record<string, number> = {};
    for (const [name, totals] of this.phases) {
      phases[name] = { totalMs: totals.totalMs, count: totals.count };
      phasePercent[name] = totalMs > 0 ? (totals.totalMs / totalMs) * 100 : 0;
    }

    const pool: PoolOccupancy | null =
      this.occSamples > 0
        ? {
            poolSize: this.poolSize,
            samples: this.occSamples,
            avgBusyFraction: this.occBusySum / this.occSamples,
            peakBusy: this.occPeakBusy,
            timeWeightedBusyFraction:
              this.occObservedMs > 0 ? this.occBusyTimeIntegral / this.occObservedMs : 0,
            observedMs: this.occObservedMs,
          }
        : null;

    const perDayParsedBytes = this.computePerDayBytes();

    const profile: ImportProfile = {
      kind: this.kind,
      totalMs,
      phases,
      phasePercent,
      pool,
      cpapDayGroups: this.dayGroups.map((d) => ({ ...d })),
      fitbitTypes: this.fitbitTypes.map((f) => ({ ...f })),
      perDayParsedBytes,
      hardwareConcurrency:
        typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
          ? navigator.hardwareConcurrency
          : 0,
    };

    try {
      (globalThis as Record<string, unknown>)[PROFILE_RESULT] = profile;
    } catch {
      // Non-fatal: a harness reading the return value still works.
    }

    this.enabled = false;
    return profile;
  }

  private computePerDayBytes(): ImportProfile['perDayParsedBytes'] {
    if (this.dayGroups.length === 0) return null;
    const bytes = this.dayGroups.map((d) => d.parsedBytes).sort((a, b) => a - b);
    const total = bytes.reduce((s, b) => s + b, 0);
    const max = bytes[bytes.length - 1] ?? 0;
    const mean = total / bytes.length;
    const p95Idx = Math.min(bytes.length - 1, Math.floor(0.95 * (bytes.length - 1)));
    const p95 = bytes[p95Idx] ?? max;
    return { max, mean, p95, total };
  }
}

/** The one shared profiler instance (gated; inert unless the switch is on). */
export const importProfiler = new ImportProfiler();

/** Re-export the result global key so harnesses/tests can reference it by name. */
export const IMPORT_PROFILE_RESULT_KEY = PROFILE_RESULT;
export const IMPORT_PROFILE_FLAG_KEY = PROFILE_FLAG;
