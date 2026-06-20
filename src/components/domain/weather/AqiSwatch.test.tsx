import { describe, it, expect } from 'vitest';
import { render, screen } from '@test/test-utils';
import { AqiSwatch } from './AqiSwatch';

describe('AqiSwatch', () => {
  it('renders word + number with a descriptive role=img label (US scale)', () => {
    render(<AqiSwatch value={78} scale="us" />);
    const img = screen.getByRole('img', { name: 'Air quality: Moderate, US AQI 78' });
    expect(img).toBeInTheDocument();
    // Word and value are both present as text.
    expect(img.textContent).toContain('Moderate');
    expect(img.textContent).toContain('78');
  });

  it('uses the European label word for the european scale', () => {
    render(<AqiSwatch value={45} scale="european" />);
    // EAQI 45 → "Moderate" band; label says European AQI.
    expect(
      screen.getByRole('img', { name: 'Air quality: Moderate, European AQI 45' }),
    ).toBeInTheDocument();
  });

  it('renders a hatch pattern for a non-Good rank (pattern is a non-color signal)', () => {
    const { container } = render(<AqiSwatch value={160} scale="us" />);
    // Rank 4 (Unhealthy) → hatch-dense → an SVG <pattern> is emitted.
    expect(container.querySelector('pattern')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'Air quality: Unhealthy, US AQI 160' }),
    ).toBeInTheDocument();
  });

  it('rank 1 (Good) is solid — no hatch pattern', () => {
    const { container } = render(<AqiSwatch value={20} scale="us" />);
    expect(container.querySelector('pattern')).toBeFalsy();
    expect(screen.getByRole('img', { name: 'Air quality: Good, US AQI 20' })).toBeInTheDocument();
  });

  it('renders no-data (em dash) for a null value, never a fabricated zero', () => {
    render(<AqiSwatch value={null} />);
    const img = screen.getByRole('img', { name: 'Air quality: no data' });
    expect(img.textContent).toContain('—');
    expect(img.textContent).not.toContain('0');
  });

  it('rounds the displayed value', () => {
    render(<AqiSwatch value={77.6} scale="us" />);
    expect(
      screen.getByRole('img', { name: 'Air quality: Moderate, US AQI 78' }),
    ).toBeInTheDocument();
  });
});
