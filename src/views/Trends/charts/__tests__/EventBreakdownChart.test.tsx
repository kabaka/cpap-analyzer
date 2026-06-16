import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

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

import EventBreakdownChart from '@/views/Trends/charts/EventBreakdownChart';
import { SyncedChartProvider } from '@/views/Trends/context/SyncedChartContext';
import type { NightlyAggregate } from '@/types';

function makeAggregate(overrides: Partial<NightlyAggregate> = {}): NightlyAggregate {
  const central = overrides.eventsByType?.central ?? 4;
  return {
    id: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    machineId: 'SN-1',
    date: overrides.date ?? '2025-06-15',
    ahi: 3,
    ahiObstructive: 1.5,
    ahiCentral: overrides.ahiCentral ?? central / 7,
    ahiMixed: 0,
    ahiHypopnea: 1,
    ahiRera: 0,
    eventCount: 20,
    eventsByType: {
      obstructive: 12,
      central,
      mixed: 0,
      hypopnea: 8,
      rera: 0,
      flowLimitation: 0,
      largeLeak: 0,
      periodicBreathing: 0,
      ...overrides.eventsByType,
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

/** Build nights with the given per-night central INDEX (events/h), usage 7h. */
function nightsWithCentralIndex(indices: number[]): NightlyAggregate[] {
  return indices.map((idx, i) =>
    makeAggregate({
      date: `2025-06-${String(i + 1).padStart(2, '0')}`,
      ahiCentral: idx,
      usageHours: 7,
      eventsByType: { central: Math.round(idx * 7) } as NightlyAggregate['eventsByType'],
    }),
  );
}

function renderChart(data: NightlyAggregate[]) {
  return render(
    <SyncedChartProvider>
      <EventBreakdownChart data={data} height={200} settingsChanges={[]} />
    </SyncedChartProvider>,
  );
}

describe('EventBreakdownChart', () => {
  it('shows the low-reliability "modeled inference" caveat for central/RERA', () => {
    renderChart(nightsWithCentralIndex([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));
    expect(screen.getByText(/modeled inferences/i)).toBeInTheDocument();
    expect(screen.getByText(/directional, not exact/i)).toBeInTheDocument();
  });

  it('surfaces a persistent "discuss with your clinician" prompt when central is rising', () => {
    // earlier half benign (~0.5/h), later half elevated (~4/h) → rising
    renderChart(nightsWithCentralIndex([0.5, 0.5, 0.5, 4, 4, 4]));
    const prompt = screen.getByTestId('central-clinician-prompt');
    expect(prompt).toBeInTheDocument();
    expect(prompt).toHaveTextContent(/discussing with your clinician/i);
    // role=status so assistive tech announces it.
    expect(prompt).toHaveAttribute('role', 'status');
  });

  it('keeps the clinician prompt present EVEN THOUGH the split carries a low-reliability caveat', () => {
    // SAFETY: the reliability caveat must not silence/bury the rising-trend prompt.
    renderChart(nightsWithCentralIndex([0.5, 0.5, 0.5, 4, 4, 4]));
    // Both affordances co-exist: caveat (precision) AND prompt (visibility).
    expect(screen.getByText(/modeled inferences/i)).toBeInTheDocument();
    expect(screen.getByTestId('central-clinician-prompt')).toBeInTheDocument();
  });

  it('uses non-diagnostic, non-therapy-specific framing in the prompt', () => {
    renderChart(nightsWithCentralIndex([0.5, 0.5, 0.5, 4, 4, 4]));
    const prompt = screen.getByTestId('central-clinician-prompt');
    const text = prompt.textContent ?? '';
    // No diagnosis, no therapy prescription.
    expect(text).not.toMatch(/\bASV\b/i);
    expect(text).not.toMatch(/you (have|need)\b/i);
    expect(text).not.toMatch(/diagnos/i);
  });

  it('does NOT show the prompt for a stable central trend', () => {
    renderChart(nightsWithCentralIndex([1, 1, 1, 1, 1, 1]));
    expect(screen.queryByTestId('central-clinician-prompt')).toBeNull();
    // The caveat is still shown (precision claim is independent of the trend).
    expect(screen.getByText(/modeled inferences/i)).toBeInTheDocument();
  });

  describe('edge cases', () => {
    it('renders nothing for empty data', () => {
      const { container } = renderChart([]);
      expect(container).toBeEmptyDOMElement();
    });

    it('does not show the prompt for a short window (too few nights to claim a trend)', () => {
      renderChart(nightsWithCentralIndex([0.5, 5]));
      expect(screen.queryByTestId('central-clinician-prompt')).toBeNull();
    });
  });
});
