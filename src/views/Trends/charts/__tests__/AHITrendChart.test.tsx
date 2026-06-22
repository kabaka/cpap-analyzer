import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import AHITrendChart from '@/views/Trends/charts/AHITrendChart';
import { SyncedChartProvider } from '@/views/Trends/context/SyncedChartContext';
import type { NightlyAggregate } from '@/types';
import { installCanvas2DStub } from './canvasStub';

// The chart was migrated from Recharts/SVG to Canvas2D. Under jsdom getContext
// is unimplemented; the renderer fails soft (HTML chrome still renders). Stub
// the 2D context so the suite output stays clean without masking real errors.
installCanvas2DStub();

function makeAggregate(overrides: Partial<NightlyAggregate> = {}): NightlyAggregate {
  return {
    id: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    machineId: 'SN-1',
    date: overrides.date ?? '2025-06-15',
    ahi: overrides.ahi ?? 3,
    ahiObstructive: 1.5,
    ahiCentral: 0.5,
    ahiMixed: 0,
    ahiHypopnea: 1,
    ahiRera: 0,
    eventCount: 20,
    eventsByType: {
      obstructive: 12,
      central: 4,
      mixed: 0,
      hypopnea: 8,
      rera: 0,
      flowLimitation: 0,
      largeLeak: 0,
      periodicBreathing: 0,
    },
    pressureMean: 10,
    pressureMedian: 9.8,
    pressureP95: 12,
    pressureMax: 14,
    epapMedian: null,
    ipapMedian: null,
    pressureSupport: null,
    leakMedian: 8,
    leakP95: 15,
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

function buildData(n: number): NightlyAggregate[] {
  return Array.from({ length: n }, (_, i) =>
    makeAggregate({
      date: `2025-06-${String(i + 1).padStart(2, '0')}`,
      ahi: 2 + (i % 5),
    }),
  );
}

function renderChart(data: NightlyAggregate[]) {
  return render(
    <SyncedChartProvider>
      <AHITrendChart data={data} height={200} settingsChanges={[]} />
    </SyncedChartProvider>,
  );
}

describe('AHITrendChart', () => {
  it('renders the rolling-median centre line and the band series', () => {
    const { container } = renderChart(buildData(14));

    // Post-migration the marks are painted to Canvas2D (no SVG series). The
    // chart renders its base + overlay canvas surfaces inside the figure.
    const canvases = container.querySelectorAll('canvas');
    expect(canvases.length).toBeGreaterThanOrEqual(1);

    // The semantic content the canvas conveys graphically stays intact in the
    // screen-reader data table: each night carries a rolling-median value and
    // the P25/P75 typical-range bounds. Once enough nights exist for the
    // rolling window, at least one row must show finite numbers (not just "—").
    const table = screen.getByRole('table');
    const bodyRows = within(table).getAllByRole('row').slice(1); // drop header
    expect(bodyRows.length).toBe(14);

    const numeric = /^\d+(\.\d+)?$/;
    const cellText = (row: HTMLElement): string[] =>
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent?.trim() ?? '');

    const rowsWithMedianAndBand = bodyRows.filter((row) => {
      // Columns: Date | median | P25 | P75 | this-night.
      const text = cellText(row);
      return (
        numeric.test(text[1] ?? '') && numeric.test(text[2] ?? '') && numeric.test(text[3] ?? '')
      );
    });
    expect(rowsWithMedianAndBand.length).toBeGreaterThan(0);

    // The band bounds are an ordered interval (P25 <= P75) wherever present.
    for (const row of rowsWithMedianAndBand) {
      const text = cellText(row);
      expect(Number(text[2])).toBeLessThanOrEqual(Number(text[3]));
    }
  });

  it('labels the band as a typical nightly range / percentile spread, NOT a 95% CI', () => {
    renderChart(buildData(14));

    // The visible footnote qualifies the band correctly.
    expect(screen.getByText(/typical nightly range \(25th–75th percentile/i)).toBeInTheDocument();
    expect(screen.getByText(/not a 95% confidence interval/i)).toBeInTheDocument();

    // The band is never presented AS a (positive) confidence interval — every
    // mention of "confidence interval" is a negation ("not a ...").
    const ciMentions = screen.queryAllByText(/confidence interval/i);
    for (const el of ciMentions) {
      expect(el.textContent ?? '').toMatch(/not a (95% )?confidence interval/i);
    }
  });

  it('exposes a screen-reader table with median + P25/P75 columns (no "confidence interval")', () => {
    renderChart(buildData(10));

    const table = screen.getByRole('table');
    expect(within(table).getByText(/Rolling median AHI/i)).toBeInTheDocument();
    // Column headers carry the P25/P75 framing (≥1 occurrence in the table).
    expect(within(table).getAllByText(/P25/i).length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/P75/i).length).toBeGreaterThan(0);

    const caption = table.querySelector('caption');
    expect(caption?.textContent ?? '').toMatch(/not a confidence interval/i);
  });

  it('names the band and median series for assistive tech', () => {
    renderChart(buildData(10));
    // accessibleSummary on the figure mentions the typical-nightly-range band.
    const figure = screen.getByRole('figure');
    expect(figure.getAttribute('aria-label')).toMatch(/typical-nightly-range band/i);
  });

  describe('edge cases', () => {
    it('renders nothing for empty data', () => {
      const { container } = renderChart([]);
      expect(container).toBeEmptyDOMElement();
    });

    it('renders without throwing for a short window (fewer nights than the band window)', () => {
      // 3 nights < 7-night window: bands grow from the leading edge, no crash.
      expect(() => renderChart(buildData(3))).not.toThrow();
      expect(screen.getByRole('figure')).toBeInTheDocument();
      expect(screen.getAllByText(/typical nightly range/i).length).toBeGreaterThan(0);
    });
  });
});
