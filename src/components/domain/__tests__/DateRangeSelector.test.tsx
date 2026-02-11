import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { DateRangeSelector } from '@/components/domain/DateRangeSelector';
import { useAppStore } from '@/stores/useAppStore';

describe('DateRangeSelector', () => {
  beforeEach(() => {
    // Reset store to default 30-day range
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    useAppStore.setState({ dateRange: { start, end } });
  });

  it('should render without crashing', () => {
    const { container } = render(<DateRangeSelector />);
    expect(container).toBeTruthy();
  });

  it('should render with a date range label', () => {
    render(<DateRangeSelector />);

    // The Select component has a label "Date range"
    expect(screen.getByText('Date range')).toBeInTheDocument();
  });
});
