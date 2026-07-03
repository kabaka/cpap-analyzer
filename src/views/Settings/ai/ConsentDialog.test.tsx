import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@test/test-utils';
import { ConsentDialog } from './ConsentDialog';

describe('AI ConsentDialog (cloud-egress)', () => {
  it('shows the exact egress / retained contract copy, naming the backend', () => {
    render(<ConsentDialog open backendName="Claude" onCancel={vi.fn()} onEnable={vi.fn()} />);
    expect(screen.getByText('What leaves your device')).toBeInTheDocument();
    expect(screen.getByText('What never leaves your device')).toBeInTheDocument();
    // Egress: aggregate metric snapshot, date/range, units & thresholds.
    expect(screen.getByText(/compact summary of the metrics/i)).toBeInTheDocument();
    expect(screen.getByText(/calendar date or date range/i)).toBeInTheDocument();
    expect(screen.getByText(/units and thresholds/i)).toBeInTheDocument();
    // Retained: raw signals, identifiers, other nights.
    expect(screen.getByText(/Raw signals/i)).toBeInTheDocument();
    expect(screen.getByText(/no name, email, or machine serial number/i)).toBeInTheDocument();
    // Title carries the backend name.
    expect(screen.getByText('Send metric summaries to Claude?')).toBeInTheDocument();
  });

  it('gates Enable behind the acknowledgement checkbox', () => {
    const onEnable = vi.fn();
    render(<ConsentDialog open backendName="Claude" onCancel={vi.fn()} onEnable={onEnable} />);
    const enable = screen.getByRole('button', { name: 'Enable' });
    expect(enable).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(enable).toBeEnabled();
    fireEvent.click(enable);
    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it('Cancel reverts via onCancel without enabling', () => {
    const onCancel = vi.fn();
    const onEnable = vi.fn();
    render(<ConsentDialog open backendName="Claude" onCancel={onCancel} onEnable={onEnable} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onEnable).not.toHaveBeenCalled();
  });

  it('Escape requests close (reverts via onCancel)', () => {
    const onCancel = vi.fn();
    render(<ConsentDialog open backendName="Claude" onCancel={onCancel} onEnable={vi.fn()} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
