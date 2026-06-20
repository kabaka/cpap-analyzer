import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@test/test-utils';
import { SegmentedControl, type SegmentedControlOption } from './SegmentedControl';

type Unit = 'C' | 'F' | 'K';

const OPTIONS: SegmentedControlOption<Unit>[] = [
  { value: 'C', label: '°C', ariaLabel: 'Celsius' },
  { value: 'F', label: '°F', ariaLabel: 'Fahrenheit' },
  { value: 'K', label: 'K', ariaLabel: 'Kelvin' },
];

/** Controlled harness so selection updates reflect in aria-checked. */
function Harness({ onChange }: { onChange?: (v: Unit) => void }) {
  const [value, setValue] = useState<Unit>('C');
  return (
    <SegmentedControl
      label="Temperature unit"
      options={OPTIONS}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('SegmentedControl', () => {
  it('renders a radiogroup with radio segments and full aria-labels', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Temperature unit' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Celsius' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Fahrenheit' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Kelvin' })).toBeInTheDocument();
  });

  it('marks the selected segment with aria-checked and roving tabindex', () => {
    render(<Harness />);
    const celsius = screen.getByRole('radio', { name: 'Celsius' });
    const fahrenheit = screen.getByRole('radio', { name: 'Fahrenheit' });
    expect(celsius).toHaveAttribute('aria-checked', 'true');
    expect(celsius).toHaveAttribute('tabindex', '0');
    expect(fahrenheit).toHaveAttribute('aria-checked', 'false');
    expect(fahrenheit).toHaveAttribute('tabindex', '-1');
  });

  it('moves selection with ArrowRight and wraps at the end', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const celsius = screen.getByRole('radio', { name: 'Celsius' });

    fireEvent.keyDown(celsius, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('F');
    expect(screen.getByRole('radio', { name: 'Fahrenheit' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Fahrenheit' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('K');

    // Wrap from last back to first.
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Kelvin' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('C');
  });

  it('moves selection with ArrowLeft and wraps to the end', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const celsius = screen.getByRole('radio', { name: 'Celsius' });
    fireEvent.keyDown(celsius, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('K');
  });

  it('jumps to ends with Home and End', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const celsius = screen.getByRole('radio', { name: 'Celsius' });
    fireEvent.keyDown(celsius, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('K');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Kelvin' }), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('C');
  });

  it('selects on click', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Fahrenheit' }));
    expect(onChange).toHaveBeenLastCalledWith('F');
  });

  it('does not respond when disabled', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl label="Unit" options={OPTIONS} value="C" onChange={onChange} disabled />,
    );
    const celsius = screen.getByRole('radio', { name: 'Celsius' });
    expect(celsius).toBeDisabled();
    fireEvent.keyDown(celsius, { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
