import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';

// Recharts' ResponsiveContainer measures its parent (0×0 in jsdom), which
// suppresses the inner SVG. Mock it to a fixed size so series actually render.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => (
      <div style={{ width: 800, height: 300 }}>
        <actual.ResponsiveContainer width={800} height={300}>
          {children}
        </actual.ResponsiveContainer>
      </div>
    ),
  };
});

import AHITrendChart from '@/views/Trends/charts/AHITrendChart';
import { SyncedChartProvider } from '@/views/Trends/context/SyncedChartContext';
import type { NightlyAggregate } from '@/types';

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

    // recharts sets a class per series; the median line and band area exist.
    const lines = container.querySelectorAll('.recharts-line');
    const areas = container.querySelectorAll('.recharts-area');
    // Two lines: faint raw nightly + headline rolling median.
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // One floating band area (the typical nightly range).
    expect(areas.length).toBeGreaterThanOrEqual(1);
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
