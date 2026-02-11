import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { KPICard } from '@/components/domain/KPICard';

describe('KPICard', () => {
  it('should render title, value, and unit', () => {
    render(<KPICard title="AHI" value="5.2" unit="events/hr" />);

    expect(screen.getByText('AHI')).toBeInTheDocument();
    expect(screen.getByText('5.2')).toBeInTheDocument();
    expect(screen.getByText('events/hr')).toBeInTheDocument();
  });

  it('should show severity badge when severity prop is provided', () => {
    render(<KPICard title="AHI" value="5.2" unit="events/hr" severity="mild" />);

    expect(screen.getByText('mild')).toBeInTheDocument();
  });

  it('should not show severity badge when severity is omitted', () => {
    render(<KPICard title="AHI" value="5.2" unit="events/hr" />);

    expect(screen.queryByText('normal')).not.toBeInTheDocument();
    expect(screen.queryByText('mild')).not.toBeInTheDocument();
    expect(screen.queryByText('moderate')).not.toBeInTheDocument();
    expect(screen.queryByText('severe')).not.toBeInTheDocument();
  });

  it('should show trend arrow when trend prop is provided', () => {
    render(<KPICard title="AHI" value="5.2" unit="events/hr" trend="down" />);

    expect(screen.getByLabelText('Trend: down')).toBeInTheDocument();
    expect(screen.getByText('↓')).toBeInTheDocument();
  });

  it('should show up trend arrow', () => {
    render(<KPICard title="AHI" value="5.2" unit="events/hr" trend="up" />);

    expect(screen.getByLabelText('Trend: up')).toBeInTheDocument();
    expect(screen.getByText('↑')).toBeInTheDocument();
  });

  it('should show stable trend arrow', () => {
    render(<KPICard title="AHI" value="5.2" unit="events/hr" trend="stable" />);

    expect(screen.getByLabelText('Trend: stable')).toBeInTheDocument();
    expect(screen.getByText('→')).toBeInTheDocument();
  });

  it('should show loading skeleton when loading=true', () => {
    render(<KPICard title="AHI" value="5.2" unit="events/hr" loading={true} />);

    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    // Value and unit should not be visible while loading
    expect(screen.queryByText('5.2')).not.toBeInTheDocument();
    expect(screen.queryByText('events/hr')).not.toBeInTheDocument();
  });

  it('should not show trend arrow when loading', () => {
    render(<KPICard title="AHI" value="5.2" unit="events/hr" trend="up" loading={true} />);

    expect(screen.queryByLabelText('Trend: up')).not.toBeInTheDocument();
  });
});
