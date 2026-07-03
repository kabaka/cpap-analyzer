import { describe, it, expect } from 'vitest';
import { render, screen } from '@test/test-utils';
import { TrendIndicator } from './TrendIndicator';

describe('TrendIndicator', () => {
  it('renders a neutral steady label for unchanged', () => {
    render(<TrendIndicator direction="unchanged" polarity="neutral" />);
    expect(screen.getByLabelText('Steady')).toBeInTheDocument();
  });

  it('neutral polarity uses plain Rising/Falling wording (no judgment)', () => {
    const { rerender } = render(<TrendIndicator direction="up" polarity="neutral" />);
    const up = screen.getByLabelText('Rising');
    expect(up).toBeInTheDocument();
    expect(up.getAttribute('aria-label')).not.toMatch(/favorable|unfavorable/i);

    rerender(<TrendIndicator direction="down" polarity="neutral" />);
    expect(screen.getByLabelText('Falling')).toBeInTheDocument();
  });

  it('favorable-low (AQI): falling is favorable (green-down), rising unfavorable', () => {
    const { rerender } = render(<TrendIndicator direction="down" polarity="favorable-low" />);
    expect(screen.getByLabelText('Falling (favorable)')).toBeInTheDocument();

    rerender(<TrendIndicator direction="up" polarity="favorable-low" />);
    expect(screen.getByLabelText('Rising (unfavorable)')).toBeInTheDocument();
  });

  it('favorable-high (default): rising is favorable', () => {
    const { rerender } = render(<TrendIndicator direction="up" />);
    expect(screen.getByLabelText('Rising (favorable)')).toBeInTheDocument();

    rerender(<TrendIndicator direction="down" />);
    expect(screen.getByLabelText('Falling (unfavorable)')).toBeInTheDocument();
  });

  it('back-compat: explicit favorable override drives the tone', () => {
    // direction up with favorable=false → unfavorable, regardless of default polarity.
    render(<TrendIndicator direction="up" favorable={false} />);
    expect(screen.getByLabelText('Rising (unfavorable)')).toBeInTheDocument();
  });

  it('renders the correct arrow glyph for each direction', () => {
    const { rerender } = render(<TrendIndicator direction="up" polarity="neutral" />);
    expect(screen.getByLabelText('Rising').textContent).toBe('↑');
    rerender(<TrendIndicator direction="down" polarity="neutral" />);
    expect(screen.getByLabelText('Falling').textContent).toBe('↓');
  });
});
