/**
 * Precision regression test (consensus D9): AHI must render at 1 decimal place
 * in exported/reported headers — never the old `.toFixed(2)` false precision.
 *
 * Guards the three real offenders called out in D9:
 *   - ReportService.ts buildCSVFromAggregates  (Mean AHI header)
 *   - export.worker.ts generateCSV             (Mean/Median AHI header)
 *   - PressureOptimization.tsx                 (AHI at optimal pressure)
 *
 * The report path is exercised end-to-end via its public CSV builder. The
 * worker path now delegates to the SAME `formatMetric` helper, so we assert the
 * shared helper's behaviour directly (a 2-dp AHI is impossible by construction).
 *
 * @module services/reports/__tests__/ahiPrecision.regression
 */

import { describe, it, expect, vi } from 'vitest';
import type { NightlyAggregate } from '@/types';
import { formatMetric } from '@/analysis/uncertainty';

// jsPDF is irrelevant here but ReportService imports it at module load.
vi.mock('jspdf', () => ({ jsPDF: vi.fn() }));
vi.mock('@/services/storage/getDB', () => ({ getDB: vi.fn() }));
vi.mock('../pdf/charts', () => ({
  drawLineChart: vi.fn(),
  drawBarChart: vi.fn(),
  drawHorizontalBarChart: vi.fn(),
  drawStackedAreaChart: vi.fn(),
}));

import { buildCSVFromAggregates } from '../ReportService';

function makeAggregate(overrides: Partial<NightlyAggregate> = {}): NightlyAggregate {
  return {
    id: 'agg',
    sessionId: 'sess',
    machineId: 'm',
    date: '2024-01-01',
    ahi: 3.2,
    ahiObstructive: 1,
    ahiCentral: 0.5,
    ahiMixed: 0.2,
    ahiHypopnea: 1.3,
    ahiRera: 0.2,
    eventCount: 24,
    eventsByType: {
      obstructive: 7,
      central: 4,
      mixed: 2,
      hypopnea: 9,
      rera: 2,
      flowLimitation: 0,
      largeLeak: 0,
      periodicBreathing: 0,
    },
    pressureMean: 10,
    pressureMedian: 9.5,
    pressureP95: 13,
    pressureMax: 15,
    epapMedian: null,
    ipapMedian: null,
    pressureSupport: null,
    leakMedian: 4.5,
    leakP95: 12,
    leakMax: 25,
    leakDurationMinutes: 5,
    tidalVolumeMean: null,
    tidalVolumeMedian: null,
    minuteVentMean: null,
    respRateMean: null,
    respRateMedian: null,
    spo2Mean: null,
    spo2Median: null,
    spo2Min: null,
    spo2Below90Percent: null,
    oxygenDesaturationIndex: null,
    usageHours: 7,
    maskOnTimeMinutes: 420,
    complianceStatus: 'compliant',
    configuredMinPressure: null,
    configuredMaxPressure: null,
    eprLevel: null,
    notes: '',
    tags: [],
    ...overrides,
  };
}

const DATE_RANGE = { start: '2024-01-01', end: '2024-01-03' };

describe('AHI display-precision regression (D9)', () => {
  it('renders the report Mean AHI header at 1 decimal place', () => {
    // Mean of 3.2, 4.1, 2.8 = 3.3666… → "3.4" at 1 dp, NOT "3.37".
    const aggregates = [
      makeAggregate({ ahi: 3.2 }),
      makeAggregate({ id: 'a2', ahi: 4.1 }),
      makeAggregate({ id: 'a3', ahi: 2.8 }),
    ];
    const csv = buildCSVFromAggregates(aggregates, DATE_RANGE);

    expect(csv).toContain('# Mean AHI: 3.4');
    // The old false-precision 2-dp value must be gone.
    expect(csv).not.toContain('3.37');
    expect(csv).not.toMatch(/Mean AHI: \d+\.\d{2}/);
  });

  it('renders "insufficient data" for a null-rate night and pools the mean over valid nights only', () => {
    // Two valid nights with EQUAL usage (so pooled == unweighted): pooled mean
    // = (3.2*7 + 4.0*7)/(7+7) = (3.2 + 4.0)/2 = 3.6 → "3.6" at 1 dp.
    // The third night is a sub-floor mask-fit clip: every per-hour rate is null
    // (undefined), usage 0.02 h. It must NOT contribute to the mean and its rate
    // cells must render the literal "insufficient data" marker, not 0 or blank.
    const aggregates = [
      makeAggregate({ id: 'v1', date: '2024-01-01', ahi: 3.2, usageHours: 7 }),
      makeAggregate({ id: 'v2', date: '2024-01-02', ahi: 4.0, usageHours: 7 }),
      makeAggregate({
        id: 'nullnight',
        date: '2024-01-03',
        ahi: null,
        ahiObstructive: null,
        ahiCentral: null,
        ahiHypopnea: null,
        usageHours: 0.02,
      }),
    ];
    const csv = buildCSVFromAggregates(aggregates, DATE_RANGE);
    const lines = csv.split('\n');

    // Mean AHI header is the POOLED rate over the two valid nights only.
    expect(csv).toContain('# Mean AHI: 3.6');

    // The data row for the null night must carry the insufficient-data marker
    // for every nullable per-hour rate column (ahi/obstructive/central/hypopnea).
    const nullRow = lines.find((l) => !l.startsWith('#') && l.startsWith('2024-01-03'));
    expect(nullRow).toBeDefined();
    const cells = nullRow!.split(',');
    // Columns: date, ahi, ahiObstructive, ahiCentral, ahiHypopnea, ...
    expect(cells[1]).toBe('insufficient data');
    expect(cells[2]).toBe('insufficient data');
    expect(cells[3]).toBe('insufficient data');
    expect(cells[4]).toBe('insufficient data');
    // The null night must not have leaked a 0 into any rate column.
    expect(cells.slice(1, 5)).not.toContain('0');
    expect(cells.slice(1, 5)).not.toContain('0.0');
  });

  it('formatMetric("ahi") never emits more than one decimal (worker + view path)', () => {
    expect(formatMetric('ahi', 3.3666666)).toBe('3.4');
    expect(formatMetric('ahi', 4.97)).toBe('5.0');
    expect(formatMetric('ahi', 2.84)).toBe('2.8');
    // Trailing significant zero preserved; exactly one decimal, never two.
    expect(formatMetric('ahi', 5)).toBe('5.0');
    for (const v of [0, 1.23, 12.345, 6.66, 99.999]) {
      expect(formatMetric('ahi', v)).toMatch(/^\d+\.\d$/);
    }
  });
});
