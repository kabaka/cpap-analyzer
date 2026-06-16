import { describe, it, expect } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/test-utils';
import { ReliabilityChip } from '@/components/domain/ReliabilityChip';

describe('ReliabilityChip', () => {
  it('renders nothing for a high tier with no flags (absence is the trust signal)', () => {
    const { container } = render(<ReliabilityChip tier="high" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an "Estimate" chip with a triangle icon for the moderate tier', () => {
    render(<ReliabilityChip tier="moderate" />);
    const chip = screen.getByRole('status', { name: 'Estimate' });
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent('Estimate');
    // Non-colour cue: a decorative icon shape accompanies the label.
    expect(chip.querySelector('svg')).not.toBeNull();
  });

  it('renders a "Modeled" chip with a hexagon icon for the low tier', () => {
    render(<ReliabilityChip tier="low" />);
    const chip = screen.getByRole('status', { name: 'Modeled' });
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent('Modeled');
    expect(chip.querySelector('svg')).not.toBeNull();
  });

  it('renders a data-quality flag chip (high tier shows only the flag, no tier chip)', () => {
    render(<ReliabilityChip tier="high" flags={['high-leak']} />);
    expect(screen.getByRole('status', { name: 'Leak-affected' })).toBeInTheDocument();
    expect(screen.queryByText('Estimate')).not.toBeInTheDocument();
    expect(screen.queryByText('Modeled')).not.toBeInTheDocument();
  });

  it('renders both a tier chip and a flag chip when they co-occur', () => {
    render(<ReliabilityChip tier="low" flags={['high-leak']} />);
    expect(screen.getByText('Modeled')).toBeInTheDocument();
    expect(screen.getByText('Leak-affected')).toBeInTheDocument();
  });

  it('folds the reason into the accessible name (status role, not alert)', () => {
    render(<ReliabilityChip tier="moderate" reason="Detected, undercounts vs PSG." />);
    const chip = screen.getByRole('status', {
      name: 'Estimate: Detected, undercounts vs PSG.',
    });
    expect(chip).toBeInTheDocument();
    // Never an alert — a soft metric is information, not an error.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('exposes the reason in a tooltip on keyboard focus', async () => {
    const user = userEvent.setup();
    render(<ReliabilityChip tier="low" reason="Modeled inference; discuss with clinician." />);

    const chip = screen.getByRole('status', { name: /Modeled/ });
    await user.tab();
    expect(chip).toHaveFocus();

    // Radix renders the tooltip content (possibly more than once across the
    // visible + a11y mirror) once the trigger is focused.
    const tips = await screen.findAllByText('Modeled inference; discuss with clinician.');
    expect(tips.length).toBeGreaterThan(0);
  });

  it('is keyboard-focusable as a button', async () => {
    const user = userEvent.setup();
    render(<ReliabilityChip tier="moderate" />);
    await user.tab();
    expect(screen.getByRole('status', { name: 'Estimate' })).toHaveFocus();
  });
});
