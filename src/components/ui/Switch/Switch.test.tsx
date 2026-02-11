import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@test/test-utils';
import { Switch } from '@/components/ui/Switch';

describe('Switch', () => {
  it('should render with label', () => {
    render(<Switch label="Enable notifications" />);
    expect(screen.getByText('Enable notifications')).toBeInTheDocument();
  });

  it('should render a switch role element', () => {
    render(<Switch label="Toggle" />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('should toggle on click', () => {
    const handleChange = vi.fn();
    render(<Switch label="Toggle" checked={false} onCheckedChange={handleChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it('should respect disabled state', () => {
    const handleChange = vi.fn();
    render(<Switch label="Disabled" disabled onCheckedChange={handleChange} />);
    const switchEl = screen.getByRole('switch');
    expect(switchEl).toBeDisabled();
    fireEvent.click(switchEl);
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('should reflect checked state', () => {
    render(<Switch label="On" checked={true} />);
    const switchEl = screen.getByRole('switch');
    expect(switchEl).toHaveAttribute('data-state', 'checked');
  });
});
