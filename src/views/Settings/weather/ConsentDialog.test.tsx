import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@test/test-utils';
import { ConsentDialog } from './ConsentDialog';

describe('ConsentDialog', () => {
  it('shows the egress / retained privacy contract copy', () => {
    render(<ConsentDialog open onCancel={vi.fn()} onEnable={vi.fn()} />);
    expect(screen.getByText('What leaves your device')).toBeInTheDocument();
    expect(screen.getByText('What never leaves your device')).toBeInTheDocument();
    // Accurate egress copy: rounded coordinates, calendar dates, typed city only.
    expect(screen.getByText(/rounded to about 1.1 km/i)).toBeInTheDocument();
    expect(screen.getByText(/calendar dates/i)).toBeInTheDocument();
    expect(screen.getByText(/city name you type/i)).toBeInTheDocument();
    // Retained: therapy data, identifier, precise GPS never leave.
    expect(screen.getByText(/therapy or health data/i)).toBeInTheDocument();
    expect(screen.getByText(/precise GPS/i)).toBeInTheDocument();
  });

  it('gates the Enable button behind the acknowledgement checkbox', () => {
    const onEnable = vi.fn();
    render(<ConsentDialog open onCancel={vi.fn()} onEnable={onEnable} />);

    const enable = screen.getByRole('button', { name: 'Enable' });
    expect(enable).toBeDisabled();

    // Acknowledge → Enable becomes available.
    fireEvent.click(screen.getByRole('checkbox'));
    expect(enable).toBeEnabled();

    fireEvent.click(enable);
    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it('Cancel fires onCancel (revert path) without enabling', () => {
    const onCancel = vi.fn();
    const onEnable = vi.fn();
    render(<ConsentDialog open onCancel={onCancel} onEnable={onEnable} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onEnable).not.toHaveBeenCalled();
  });

  it('Escape requests close (which reverts via onCancel)', () => {
    const onCancel = vi.fn();
    render(<ConsentDialog open onCancel={onCancel} onEnable={vi.fn()} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
