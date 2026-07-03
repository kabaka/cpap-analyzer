/**
 * Weather sync orchestrator.
 *
 * Mirrors the GoogleHealth import pipeline shape
 * (`src/services/import/googlehealth/GoogleHealthImportService.ts`):
 *   scope (dates needing weather) → fetch (Open-Meteo, rate-limit aware) →
 *   parse → dedupe (by `source_dataType_date`) → batched IndexedDB store →
 *   write an `integration_import_history` record.
 *
 * Framework-agnostic (no React). The IndexedDB service and the Open-Meteo
 * client are injected for testability. Progress is emitted in an import-style
 * shape ({@link WeatherSyncProgress}); the operation is cancellable.
 *
 * ## Two-civil-date nights
 *
 * A recording that crosses local midnight spans two civil dates. Each night
 * descriptor ({@link WeatherSyncNight}) therefore lists ALL civil dates it
 * touches; the service fetches every distinct civil date's hourly data so the
 * overnight aggregation (`@/analysis/weather/aggregation`) can merge them. The
 * hourly fetch is deduplicated across nights so a shared date is only requested
 * once per sync.
 *
 * ## What leaves the device
 *
 * Only the rounded coordinates (enforced inside {@link OpenMeteoClient}), the
 * calendar dates, the requested variable names, and a timezone. No identifiers.
 *
 * @module services/weather/WeatherSyncService
 */

import {
  aggregateAirQualityNight,
  mergeHourlySamples,
  toAirQualityDaily,
  type OvernightWindow,
} from '@/analysis/weather/aggregation';
import type { IndexedDBService } from '@/services/storage/IndexedDBService';
import type {
  IntegrationDailySummary,
  IntegrationImportRecord,
  IntegrationSource,
  IntegrationTimeseries,
} from '@/types/storage';
import type { ImportError as StorageImportError } from '@/types/storage';
import type {
  AirQualityHourly,
  AirQualityHourlySample,
  WeatherDataType,
  WeatherLocation,
} from '@/types/weather';
import {
  OpenMeteoClient,
  WeatherFetchError,
  type WeatherFetchErrorReason,
} from './OpenMeteoClient';
import { parseAirQualityResponse, parseWeatherResponse, type ParsedDateRecord } from './parsers';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Integration source identifier for weather data. */
const SOURCE: IntegrationSource = 'weather';

/** Records stored per IndexedDB batch transaction. */
const BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Public input / progress types
// ---------------------------------------------------------------------------

/**
 * A single night that needs weather, supplied by the caller (e.g. derived from
 * a CPAP session). Carries the canonical overnight window so air-quality daily
 * aggregates can be computed without re-loading the session here.
 */
export interface WeatherSyncNight {
  /** Primary local date of the night, `YYYY-MM-DD` (the session's `date`). */
  readonly date: string;
  /**
   * All civil dates this night's recording touches, `YYYY-MM-DD`, ascending.
   * For a midnight-spanning night this is two dates; otherwise one. MUST include
   * {@link date}.
   */
  readonly civilDates: readonly string[];
  /** The session's `[start, end)` local wall-clock window for overnight stats. */
  readonly window: OvernightWindow;
}

/** Options controlling a weather sync run. */
export interface WeatherSyncOptions {
  /** Nights to sync. */
  readonly nights: readonly WeatherSyncNight[];
  /** The (already-rounded) location stamp written onto every record. */
  readonly location: WeatherLocation;
  /** IANA timezone, or `'auto'`. */
  readonly timezone: string;
  /** Reference "today" in the same calendar frame, `YYYY-MM-DD`. */
  readonly today: string;
  /** Fetch core weather. @default true */
  readonly fetchCore?: boolean;
  /** Fetch air quality. @default true */
  readonly fetchAirQuality?: boolean;
  /** Also store hourly series (vs daily summaries only). @default true */
  readonly storeHourly?: boolean;
  /** Skip dates already stored for the same data type. @default true */
  readonly skipDuplicates?: boolean;
  /** Progress callback. */
  readonly onProgress?: (progress: WeatherSyncProgress) => void;
  /** Cancellation signal; abort stops further fetching/storing. */
  readonly signal?: AbortSignal;
}

/** Observable state of an in-progress weather sync (import-progress shape). */
export interface WeatherSyncProgress {
  readonly status:
    | 'idle'
    | 'scanning'
    | 'fetching'
    | 'storing'
    | 'complete'
    | 'error'
    | 'cancelled';
  /** Current sub-stage description for user feedback. */
  readonly currentStage: string;
  /** Local date currently being fetched (`YYYY-MM-DD`), or ''. */
  readonly currentDate: string;
  /** Total distinct civil dates to fetch. */
  readonly datesTotal: number;
  /** Civil dates fetched so far. */
  readonly datesProcessed: number;
  /** Records stored so far (daily + hourly). */
  readonly recordsStored: number;
  /** Records skipped as duplicates. */
  readonly recordsSkipped: number;
  /** `true` while paused due to a provider rate limit (HTTP 429). */
  readonly rateLimited: boolean;
  readonly errors: readonly WeatherSyncError[];
  readonly warnings: readonly string[];
  readonly startTime: number;
}

/** A single error encountered during a weather sync. */
export interface WeatherSyncError {
  /** The local date the error relates to, or '' for sync-level errors. */
  readonly date: string;
  readonly error: string;
  /** Discriminated fetch reason when the error came from the network layer. */
  readonly reason?: WeatherFetchErrorReason;
  readonly recoverable: boolean;
}

// ---------------------------------------------------------------------------
// Internal accumulators
// ---------------------------------------------------------------------------

interface PendingRecords {
  readonly daily: IntegrationDailySummary[];
  readonly hourly: IntegrationTimeseries[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class WeatherSyncService {
  constructor(
    private readonly db: IndexedDBService,
    private readonly client: OpenMeteoClient = new OpenMeteoClient(),
  ) {}

  /**
   * Run a weather sync over the supplied nights. Returns the
   * `integration_import_history` record describing the run.
   */
  async sync(options: WeatherSyncOptions): Promise<IntegrationImportRecord> {
    const fetchCore = options.fetchCore ?? true;
    const fetchAirQuality = options.fetchAirQuality ?? true;
    const storeHourly = options.storeHourly ?? true;
    const skipDuplicates = options.skipDuplicates ?? true;
    const startTime = Date.now();

    const progress: WeatherSyncProgress = {
      status: 'scanning',
      currentStage: 'Determining dates to sync…',
      currentDate: '',
      datesTotal: 0,
      datesProcessed: 0,
      recordsStored: 0,
      recordsSkipped: 0,
      rateLimited: false,
      errors: [],
      warnings: [],
      startTime,
    };
    const errors: WeatherSyncError[] = [];
    const warnings: string[] = [];

    const emit = (patch: Partial<WeatherSyncProgress>): void => {
      Object.assign(progress, patch);
      options.onProgress?.({ ...progress, errors: [...errors], warnings: [...warnings] });
    };

    // --- Scope: distinct civil dates across all nights, plus per-night maps ---
    const civilDates = this.collectCivilDates(options.nights);
    emit({ datesTotal: civilDates.length });

    if (civilDates.length === 0) {
      emit({ status: 'complete', currentStage: 'Nothing to sync', datesProcessed: 0 });
      return this.writeImportRecord(options, startTime, 0, 0, errors, []);
    }

    // Per-civil-date fetched hourly air-quality samples, so we can compute the
    // overnight AQ daily aggregate per night after fetching.
    const aqHourlyByDate = new Map<string, readonly AirQualityHourlySample[]>();
    const dataTypesTouched = new Set<WeatherDataType>();

    let recordsStored = 0;
    let recordsSkipped = 0;

    emit({ status: 'fetching', currentStage: 'Fetching weather…' });

    // --- Fetch + parse + store, one civil date at a time -------------------
    for (let i = 0; i < civilDates.length; i++) {
      if (this.isAborted(options.signal)) {
        emit({ status: 'cancelled', currentStage: 'Sync cancelled' });
        return this.writeImportRecord(options, startTime, recordsStored, recordsSkipped, errors, [
          ...dataTypesTouched,
        ]);
      }

      const date = civilDates[i] as string;
      emit({ currentDate: date, currentStage: `Fetching ${date}…`, datesProcessed: i });

      const pending: PendingRecords = { daily: [], hourly: [] };

      // Core weather.
      if (fetchCore) {
        try {
          const response = await this.client.fetchWeather({
            latitude: options.location.latitude ?? NaN,
            longitude: options.location.longitude ?? NaN,
            dates: [date],
            today: options.today,
            timezone: options.timezone,
          });
          const parsed = parseWeatherResponse(response, options.location);
          for (const rec of parsed.daily) {
            pending.daily.push(this.toDailyRecord('weather_daily', rec));
            dataTypesTouched.add('weather_daily');
          }
          if (storeHourly) {
            for (const rec of parsed.hourly) {
              pending.hourly.push(this.toTimeseriesRecord('weather_hourly', rec));
              dataTypesTouched.add('weather_hourly');
            }
          }
        } catch (err) {
          const synced = this.handleFetchError(err, date, errors);
          emit({ rateLimited: synced.rateLimited });
        }
      }

      // Air quality (hourly), plus locally-derived overnight daily aggregate.
      if (fetchAirQuality) {
        try {
          const response = await this.client.fetchAirQuality({
            latitude: options.location.latitude ?? NaN,
            longitude: options.location.longitude ?? NaN,
            dates: [date],
            today: options.today,
            timezone: options.timezone,
          });
          const parsed = parseAirQualityResponse(response, options.location);
          for (const rec of parsed.hourly) {
            aqHourlyByDate.set(rec.date, rec.data.samples);
            if (storeHourly) {
              pending.hourly.push(this.toTimeseriesRecord('air_quality_hourly', rec));
              dataTypesTouched.add('air_quality_hourly');
            }
          }
        } catch (err) {
          const synced = this.handleFetchError(err, date, errors);
          emit({ rateLimited: synced.rateLimited });
        }
      }

      // Persist this date's records (deduped, batched).
      emit({ status: 'storing', currentStage: `Storing ${date}…` });
      const outcome = await this.storePending(pending, skipDuplicates, errors);
      recordsStored += outcome.stored;
      recordsSkipped += outcome.skipped;
      emit({
        status: 'fetching',
        recordsStored,
        recordsSkipped,
        datesProcessed: i + 1,
      });
    }

    // --- Derive + store per-night overnight air-quality daily aggregates ----
    if (fetchAirQuality && aqHourlyByDate.size > 0) {
      emit({ status: 'storing', currentStage: 'Computing overnight air quality…' });
      const aqDaily = this.buildAirQualityDailyRecords(
        options.nights,
        aqHourlyByDate,
        options.location,
      );
      if (aqDaily.length > 0) {
        dataTypesTouched.add('air_quality_daily');
        const outcome = await this.storeDailyBatchDeduped(aqDaily, skipDuplicates, errors);
        recordsStored += outcome.stored;
        recordsSkipped += outcome.skipped;
        emit({ recordsStored, recordsSkipped });
      }
    }

    const status: WeatherSyncProgress['status'] =
      errors.length > 0 && recordsStored === 0 ? 'error' : 'complete';
    emit({
      status,
      currentStage: status === 'error' ? 'Sync failed' : 'Sync complete',
      currentDate: '',
      rateLimited: false,
    });

    return this.writeImportRecord(options, startTime, recordsStored, recordsSkipped, errors, [
      ...dataTypesTouched,
    ]);
  }

  // -----------------------------------------------------------------------
  // Scope
  // -----------------------------------------------------------------------

  /** Collect the distinct, ascending civil dates across all nights. */
  private collectCivilDates(nights: readonly WeatherSyncNight[]): string[] {
    const set = new Set<string>();
    for (const night of nights) {
      for (const d of night.civilDates) set.add(d);
      // Defensive: ensure the primary date is included even if civilDates omits it.
      set.add(night.date);
    }
    return [...set].sort();
  }

  // -----------------------------------------------------------------------
  // Record construction
  // -----------------------------------------------------------------------

  private toDailyRecord(
    dataType: WeatherDataType,
    rec: ParsedDateRecord<unknown>,
  ): IntegrationDailySummary {
    return {
      id: crypto.randomUUID(),
      source: SOURCE,
      dataType: dataType as IntegrationDailySummary['dataType'],
      date: rec.date,
      data: rec.data as IntegrationDailySummary['data'],
      importedAt: new Date().toISOString(),
    };
  }

  private toTimeseriesRecord(
    dataType: WeatherDataType,
    rec: ParsedDateRecord<unknown>,
  ): IntegrationTimeseries {
    return {
      id: crypto.randomUUID(),
      source: SOURCE,
      dataType: dataType as IntegrationTimeseries['dataType'],
      date: rec.date,
      data: rec.data as IntegrationTimeseries['data'],
      importedAt: new Date().toISOString(),
    };
  }

  /**
   * Build one `air_quality_daily` record per night from the fetched hourly AQ
   * samples, using the night's canonical overnight window. Two-civil-date
   * nights merge both dates' samples before aggregating.
   */
  private buildAirQualityDailyRecords(
    nights: readonly WeatherSyncNight[],
    aqHourlyByDate: Map<string, readonly AirQualityHourlySample[]>,
    location: WeatherLocation,
  ): IntegrationDailySummary[] {
    const out: IntegrationDailySummary[] = [];
    const seen = new Set<string>();
    for (const night of nights) {
      if (seen.has(night.date)) continue;
      seen.add(night.date);

      const sampleSets = night.civilDates.map((d) => aqHourlyByDate.get(d));
      const merged = mergeHourlySamples<AirQualityHourlySample>(...sampleSets);
      if (merged.length === 0) continue;

      const aggregate = aggregateAirQualityNight(merged, night.window);
      const daily = toAirQualityDaily(aggregate, location);
      out.push({
        id: crypto.randomUUID(),
        source: SOURCE,
        dataType: 'air_quality_daily' as IntegrationDailySummary['dataType'],
        date: night.date,
        data: daily as unknown as IntegrationDailySummary['data'],
        importedAt: new Date().toISOString(),
      });
    }
    return out;
  }

  // -----------------------------------------------------------------------
  // Storage (dedupe + batch)
  // -----------------------------------------------------------------------

  private async storePending(
    pending: PendingRecords,
    skipDuplicates: boolean,
    errors: WeatherSyncError[],
  ): Promise<{ stored: number; skipped: number }> {
    const dailyOutcome = await this.storeDailyBatchDeduped(pending.daily, skipDuplicates, errors);
    const hourlyOutcome = await this.storeTimeseriesBatchDeduped(
      pending.hourly,
      skipDuplicates,
      errors,
    );
    return {
      stored: dailyOutcome.stored + hourlyOutcome.stored,
      skipped: dailyOutcome.skipped + hourlyOutcome.skipped,
    };
  }

  private async storeDailyBatchDeduped(
    records: readonly IntegrationDailySummary[],
    skipDuplicates: boolean,
    errors: WeatherSyncError[],
  ): Promise<{ stored: number; skipped: number }> {
    let stored = 0;
    let skipped = 0;
    let batch: IntegrationDailySummary[] = [];

    for (const record of records) {
      if (skipDuplicates && (await this.dailyExists(record))) {
        skipped++;
        continue;
      }
      batch.push(record);
      if (batch.length >= BATCH_SIZE) {
        const outcome = await this.flushDaily(batch, errors);
        stored += outcome.stored;
        skipped += outcome.skipped;
        batch = [];
      }
    }
    if (batch.length > 0) {
      const outcome = await this.flushDaily(batch, errors);
      stored += outcome.stored;
      skipped += outcome.skipped;
    }
    return { stored, skipped };
  }

  private async storeTimeseriesBatchDeduped(
    records: readonly IntegrationTimeseries[],
    skipDuplicates: boolean,
    errors: WeatherSyncError[],
  ): Promise<{ stored: number; skipped: number }> {
    let stored = 0;
    let skipped = 0;
    let batch: IntegrationTimeseries[] = [];

    for (const record of records) {
      if (skipDuplicates && (await this.timeseriesExists(record))) {
        skipped++;
        continue;
      }
      batch.push(record);
      if (batch.length >= BATCH_SIZE) {
        const outcome = await this.flushTimeseries(batch, errors);
        stored += outcome.stored;
        skipped += outcome.skipped;
        batch = [];
      }
    }
    if (batch.length > 0) {
      const outcome = await this.flushTimeseries(batch, errors);
      stored += outcome.stored;
      skipped += outcome.skipped;
    }
    return { stored, skipped };
  }

  private async dailyExists(record: IntegrationDailySummary): Promise<boolean> {
    try {
      const existing = await this.db.getIntegrationDailySummaryByKey(
        record.source,
        record.dataType,
        record.date,
      );
      return existing !== null;
    } catch {
      return false;
    }
  }

  private async timeseriesExists(record: IntegrationTimeseries): Promise<boolean> {
    try {
      const existing = await this.db.getIntegrationTimeseriesByKey(
        record.source,
        record.dataType,
        record.date,
      );
      return existing !== null;
    } catch {
      return false;
    }
  }

  private async flushDaily(
    batch: readonly IntegrationDailySummary[],
    errors: WeatherSyncError[],
  ): Promise<{ stored: number; skipped: number }> {
    try {
      await this.db.bulkAddIntegrationDailySummaries(batch);
      return { stored: batch.length, skipped: 0 };
    } catch {
      let stored = 0;
      let skipped = 0;
      for (const record of batch) {
        try {
          await this.db.addIntegrationDailySummary(record);
          stored++;
        } catch (innerErr) {
          const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
          if (this.isConstraintError(msg)) {
            skipped++;
          } else {
            errors.push({
              date: record.date,
              error: `Storage failed: ${msg}`,
              recoverable: true,
            });
          }
        }
      }
      return { stored, skipped };
    }
  }

  private async flushTimeseries(
    batch: readonly IntegrationTimeseries[],
    errors: WeatherSyncError[],
  ): Promise<{ stored: number; skipped: number }> {
    try {
      await this.db.bulkAddIntegrationTimeseries(batch);
      return { stored: batch.length, skipped: 0 };
    } catch {
      let stored = 0;
      let skipped = 0;
      for (const record of batch) {
        try {
          await this.db.addIntegrationTimeseries(record);
          stored++;
        } catch (innerErr) {
          const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
          if (this.isConstraintError(msg)) {
            skipped++;
          } else {
            errors.push({
              date: record.date,
              error: `Storage failed: ${msg}`,
              recoverable: true,
            });
          }
        }
      }
      return { stored, skipped };
    }
  }

  private isConstraintError(message: string): boolean {
    return message.includes('Constraint') || message.includes('duplicate');
  }

  // -----------------------------------------------------------------------
  // Errors & cancellation
  // -----------------------------------------------------------------------

  /** Record a fetch error; report whether it was a rate-limit pause. */
  private handleFetchError(
    err: unknown,
    date: string,
    errors: WeatherSyncError[],
  ): { rateLimited: boolean } {
    if (err instanceof WeatherFetchError) {
      errors.push({
        date,
        error: err.message,
        reason: err.reason,
        recoverable: err.reason !== 'http',
      });
      return { rateLimited: err.reason === 'rate-limited' };
    }
    errors.push({
      date,
      error: err instanceof Error ? err.message : String(err),
      recoverable: true,
    });
    return { rateLimited: false };
  }

  private isAborted(signal?: AbortSignal): boolean {
    return signal?.aborted === true;
  }

  // -----------------------------------------------------------------------
  // Import record
  // -----------------------------------------------------------------------

  private async writeImportRecord(
    options: WeatherSyncOptions,
    startTime: number,
    stored: number,
    skipped: number,
    errors: readonly WeatherSyncError[],
    dataTypes: readonly string[],
  ): Promise<IntegrationImportRecord> {
    const dates = this.collectCivilDates(options.nights);
    const record: IntegrationImportRecord = {
      id: crypto.randomUUID(),
      source: SOURCE,
      importedAt: new Date().toISOString(),
      dateRangeStart: dates[0] ?? '',
      dateRangeEnd: dates[dates.length - 1] ?? '',
      dataTypes,
      recordsImported: stored,
      recordsSkipped: skipped,
      recordsErrored: errors.length,
      errors: errors.map(
        (e): StorageImportError => ({
          fileName: e.date,
          error: e.error,
          timestamp: new Date().toISOString(),
        }),
      ),
      durationSeconds: Math.round(((Date.now() - startTime) / 1000) * 100) / 100,
      fileHashes: [],
    };
    try {
      await this.db.addIntegrationImportRecord(record);
    } catch {
      // Best-effort: if we cannot record the run, still return the summary.
    }
    return record;
  }
}

/** Re-export so consumers importing types do not also need to import the AQ type. */
export type { AirQualityHourly };
