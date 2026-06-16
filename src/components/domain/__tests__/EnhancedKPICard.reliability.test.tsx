import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { EnhancedKPICard } from '@/components/domain/EnhancedKPICard';

const base = {
  title: 'AHI',
  value: '6.7',
  unit: 'events/hr',
  trend: 'stable' as const,
  trendPercent: 0,
  trendFavorable: true,
  // A single point keeps the recharts sparkline out of the DOM in jsdom.
  sparklineData: [6.7],
};

describe('EnhancedKPICard reliability integration', () => {
  it('shows a reliability chip for a soft low-tier metric', () => {
    render(
      <EnhancedKPICard {...base} reliability={{ tier: 'low', reason: 'Modeled inference.' }} />,
    );
    expect(screen.getByRole('status', { name: /Modeled/ })).toBeInTheDocument();
  });

  it('renders no chip for a high-tier metric with no flags', () => {
    render(<EnhancedKPICard {...base} reliability={{ tier: 'high' }} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Estimate')).not.toBeInTheDocument();
    expect(screen.queryByText('Modeled')).not.toBeInTheDocument();
  });

  it('renders no chip when the reliability prop is omitted', () => {
    render(<EnhancedKPICard {...base} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a data-quality flag chip even when the tier is high', () => {
    render(
      <EnhancedKPICard
        {...base}
        title="Leak Rate"
        reliability={{ tier: 'high', flags: ['high-leak'] }}
      />,
    );
    expect(screen.getByRole('status', { name: /Leak-affected/ })).toBeInTheDocument();
  });

  it('appends the reliability state to the card accessible name', () => {
    render(<EnhancedKPICard {...base} reliability={{ tier: 'moderate', reason: 'Estimate.' }} />);
    expect(
      screen.getByRole('article', { name: 'AHI: 6.7 events/hr, estimate' }),
    ).toBeInTheDocument();
  });
});
