/**
 * Dual-thumb range filter paired with numeric min/max inputs.
 *
 * Sliders alone are not accessible (hard to set precise values, awkward for
 * screen readers and keyboard users), so they are always paired with numeric
 * inputs per the design spec. When `disabled` is set (the underlying field has
 * no data), the control is greyed out with an explanatory chip.
 *
 * @module views/Explore/EventExplorer/RangeFilter
 */

import { useId } from 'react';
import { Slider } from '@/components/ui';
import type { NumericRange } from './queryEngine';
import styles from './RangeFilter.module.css';

export interface RangeFilterProps {
  label: string;
  /** Hard min/max the slider spans (data extent). */
  bounds: { min: number; max: number };
  value: NumericRange;
  onChange: (range: NumericRange) => void;
  unit?: string;
  step?: number;
  disabled?: boolean;
  /** Shown as an explanatory chip when disabled. */
  disabledReason?: string;
}

export function RangeFilter({
  label,
  bounds,
  value,
  onChange,
  unit,
  step = 1,
  disabled = false,
  disabledReason,
}: RangeFilterProps) {
  const id = useId();
  // Resolve current values to concrete numbers for the slider (which needs both).
  const lo = value.min ?? bounds.min;
  const hi = value.max ?? bounds.max;

  const handleSlider = (vals: number[]): void => {
    const [a, b] = vals;
    if (a === undefined || b === undefined) return;
    onChange({
      min: a <= bounds.min ? null : a,
      max: b >= bounds.max ? null : b,
    });
  };

  const handleMinInput = (raw: string): void => {
    if (raw === '') {
      onChange({ ...value, min: null });
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) onChange({ ...value, min: n });
  };

  const handleMaxInput = (raw: string): void => {
    if (raw === '') {
      onChange({ ...value, max: null });
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) onChange({ ...value, max: n });
  };

  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.legend}>
        {label}
        {unit ? <span className={styles.unit}> ({unit})</span> : null}
      </legend>

      {disabled && disabledReason ? (
        <p className={styles.disabledChip}>{disabledReason}</p>
      ) : (
        <>
          <Slider
            min={bounds.min}
            max={bounds.max}
            step={step}
            value={[lo, hi]}
            onValueChange={handleSlider}
            disabled={disabled}
          />
          <div className={styles.inputs}>
            <label className={styles.inputLabel} htmlFor={`${id}-min`}>
              <span className={styles.srOnly}>{label} minimum</span>
              <input
                id={`${id}-min`}
                type="number"
                inputMode="decimal"
                className={styles.numInput}
                placeholder={`${bounds.min}`}
                value={value.min ?? ''}
                step={step}
                onChange={(e) => handleMinInput(e.target.value)}
                aria-label={`${label} minimum`}
                aria-invalid={
                  value.min !== null && value.max !== null && value.min > value.max
                    ? true
                    : undefined
                }
              />
            </label>
            <span className={styles.dash} aria-hidden="true">
              –
            </span>
            <label className={styles.inputLabel} htmlFor={`${id}-max`}>
              <span className={styles.srOnly}>{label} maximum</span>
              <input
                id={`${id}-max`}
                type="number"
                inputMode="decimal"
                className={styles.numInput}
                placeholder={`${bounds.max}`}
                value={value.max ?? ''}
                step={step}
                onChange={(e) => handleMaxInput(e.target.value)}
                aria-label={`${label} maximum`}
                aria-invalid={
                  value.min !== null && value.max !== null && value.min > value.max
                    ? true
                    : undefined
                }
              />
            </label>
          </div>
          {value.min !== null && value.max !== null && value.min > value.max ? (
            <p className={styles.inlineError} role="alert">
              Min greater than max
            </p>
          ) : null}
        </>
      )}
    </fieldset>
  );
}
