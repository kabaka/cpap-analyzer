/**
 * Tests for the Explore → Machine Configurations view. Focused on the three
 * UX states the spec calls out: no-settings empty state, single-config note,
 * and the two-selection diff readout with confounding caveat present.
 *
 * The aggregates hook is mocked so the view can be exercised without the
 * IndexedDB stack; the heavy BoxPlot child is mocked too because its own
 * rendering is covered in its own suite and would otherwise pull d3 axes
 * into a JSDOM environment that doesn't lay them out usefully.
 *
 * @module views/Explore/Configurations/__tests__/Configurations.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';

import { render, screen } from '@/test/test-utils';
import type { NightlyAggregate } from '@/types';

vi.mock('@/hooks/useNightlyAggregates', () => ({
  useNightlyAggregates: vi.fn(),
}));

// The Machine Configurations view reads the global date range from the store
// (the per-view DateRangeSelector was dropped in the command-surface refresh),
// so no DateRangeSelector mock is needed.

// The BoxPlot child renders D3 axes that aren't meaningful in jsdom — replace
// with a marker so we can assert on whether it rendered without depending on
// its internals.
vi.mock('@/components/charts/d3', () => ({
  BoxPlot: ({ data }: { data: { label: string }[] }) => (
    <div data-testid="boxplot">{data.map((g) => g.label).join(' | ')}</div>
  ),
}));

import { Configurations } from '@/views/Explore/Configurations/Configurations';
import { useNightlyAggregates } from '@/hooks/useNightlyAggregates';

const mockUseNightlyAggregates = vi.mocked(useNightlyAggregates);

function makeAggregate(overrides: Partial<NightlyAggregate> = {}): NightlyAggregate {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    machineId: 'SN-123',
    date: overrides.date ?? '2025-06-15',
    ahi: 3.0,
    ahiObstructive: 1.5,
    ahiCentral: 0.5,
    ahiMixed: 0.0,
    ahiHypopnea: 1.0,
    ahiRera: 0.0,
    eventCount: 24,
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
    pressureMean: 10.0,
    pressureMedian: 9.8,
    pressureP95: 12.0,
    pressureMax: 14.0,
    epapMedian: null,
    ipapMedian: null,
    pressureSupport: null,
    leakMedian: 8.0,
    leakP95: 15.0,
    leakMax: 25.0,
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
    usageHours: 7.0,
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

function setAggregates(aggregates: NightlyAggregate[]): void {
  mockUseNightlyAggregates.mockReturnValue({
    aggregates,
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
}

/**
 * Build a run of consecutive nights with identical settings. Used to seed
 * config periods for the multi-config test.
 */
function makeRun(
  startDate: string,
  count: number,
  settings: {
    minPressure: number | null;
    maxPressure: number | null;
    eprLevel: number | null;
  },
  ahi = 3.0,
): NightlyAggregate[] {
  const out: NightlyAggregate[] = [];
  const base = new Date(`${startDate}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    out.push(
      makeAggregate({
        date,
        configuredMinPressure: settings.minPressure,
        configuredMaxPressure: settings.maxPressure,
        eprLevel: settings.eprLevel,
        ahi: ahi + (i % 3) * 0.1,
      }),
    );
  }
  return out;
}

describe('Configurations view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the no-settings empty state when no night carries machine settings', () => {
    // Data exists, but every night has null settings → all periods are
    // `unknown` and the view should surface the re-import prompt.
    setAggregates([
      makeAggregate({ date: '2025-06-01' }),
      makeAggregate({ date: '2025-06-02' }),
      makeAggregate({ date: '2025-06-03' }),
    ]);

    render(<Configurations />);

    expect(
      screen.getByRole('heading', { name: /machine settings unavailable/i, level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/re-import your data/i)).toBeInTheDocument();
  });

  it('shows the single-config note when every night shares one configuration', () => {
    setAggregates(makeRun('2025-06-01', 7, { minPressure: 6, maxPressure: 15, eprLevel: 2 }, 3.0));

    render(<Configurations />);

    expect(
      screen.getByRole('heading', { name: /share one configuration/i, level: 2 }),
    ).toBeInTheDocument();
    // The note should restate the settings tuple so the user knows what's
    // been recorded.
    expect(screen.getByText(/6\.0.{1,3}15\.0 cmH₂O/i)).toBeInTheDocument();
  });

  it('renders the diff readout and the confounding caveat when two configs are selected', async () => {
    // Two distinct, multi-night config periods so auto-selection picks both.
    const aggregates = [
      ...makeRun('2025-06-01', 8, { minPressure: 6, maxPressure: 12, eprLevel: 2 }, 4.0),
      ...makeRun('2025-06-09', 8, { minPressure: 6, maxPressure: 15, eprLevel: 2 }, 2.5),
    ];
    setAggregates(aggregates);

    render(<Configurations />);

    // Auto-selection happens in a microtask after the first render; flush it
    // inside `act` so the comparison section receives the selection update.
    await act(async () => {
      await Promise.resolve();
    });

    // Comparison section heading is always rendered when we have ≥ 1 real
    // config. With both auto-selected, the BoxPlot mock should render with
    // both group labels.
    expect(
      screen.getByRole('heading', { name: /outcome comparison/i, level: 2 }),
    ).toBeInTheDocument();
    const boxplot = screen.getByTestId('boxplot');
    expect(boxplot.textContent).toMatch(/12\.0/);
    expect(boxplot.textContent).toMatch(/15\.0/);

    // Diff readout: the headline shows the AHI delta and the badge appears
    // because n < 7 thresholds are documented as "n too small".
    expect(screen.getByText(/AHI Δ/)).toBeInTheDocument();

    // Confounding caveat sits under the comparison and is always present
    // when comparison renders.
    expect(screen.getByRole('note', { name: /confounding caveat/i })).toBeInTheDocument();
  });
});
