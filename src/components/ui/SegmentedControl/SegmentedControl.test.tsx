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

type Win = '7d' | '30d' | '90d';

const WINDOWS: SegmentedControlOption<Win>[] = [
  { value: '7d', label: '7D', ariaLabel: '7 days' },
  { value: '30d', label: '30D', ariaLabel: '30 days' },
  { value: '90d', label: '90D', ariaLabel: '90 days' },
];

/** Controlled harness for the command-surface `solid` + `sm` variant. */
function SolidHarness({
  onChange,
  tone,
}: {
  onChange?: (v: Win) => void;
  tone?: 'primary' | 'ai';
}) {
  const [value, setValue] = useState<Win>('30d');
  return (
    <SegmentedControl
      label="Time window"
      options={WINDOWS}
      value={value}
      variant="solid"
      size="sm"
      tone={tone}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('SegmentedControl — solid + sm variant', () => {
  it('renders the filled selected segment and preserves radiogroup semantics', () => {
    render(<SolidHarness />);

    // Radiogroup semantics are unchanged from the default variant.
    const group = screen.getByRole('radiogroup', { name: 'Time window' });
    expect(group.className).toContain('groupSolid');

    const selected = screen.getByRole('radio', { name: '30 days' });
    const unselected = screen.getByRole('radio', { name: '7 days' });

    // The filled cue: the selected segment (and only it) carries the solid-fill
    // class on top of the small segment base — a presence cue, not colour alone.
    expect(selected.className).toContain('segmentSm');
    expect(selected.className).toContain('selectedSolid');
    expect(unselected.className).toContain('segmentSm');
    expect(unselected.className).not.toContain('selectedSolid');

    // aria-checked + roving tabindex intact.
    expect(selected).toHaveAttribute('aria-checked', 'true');
    expect(selected).toHaveAttribute('tabindex', '0');
    expect(unselected).toHaveAttribute('aria-checked', 'false');
    expect(unselected).toHaveAttribute('tabindex', '-1');
  });

  it('keeps arrow-key roving selection in the solid variant', () => {
    const onChange = vi.fn();
    render(<SolidHarness onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole('radio', { name: '30 days' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('90d');
    expect(screen.getByRole('radio', { name: '90 days' }).className).toContain('selectedSolid');
  });

  it('applies the AI accent hook when tone="ai"', () => {
    render(<SolidHarness tone="ai" />);
    expect(screen.getByRole('radiogroup', { name: 'Time window' }).className).toContain('toneAi');
  });
});
