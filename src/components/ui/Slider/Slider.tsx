import * as SliderPrimitive from '@radix-ui/react-slider';
import { useId } from 'react';
import styles from './Slider.module.css';

interface SliderProps {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  value?: number[];
  onValueChange?: (value: number[]) => void;
  disabled?: boolean;
}

export function Slider({
  label,
  min = 0,
  max = 100,
  step = 1,
  value,
  onValueChange,
  disabled,
}: SliderProps) {
  const id = useId();

  return (
    <div className={styles.wrapper}>
      {label && (
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      )}
      <SliderPrimitive.Root
        id={id}
        className={styles.root}
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <SliderPrimitive.Track className={styles.track}>
          <SliderPrimitive.Range className={styles.range} />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className={styles.thumb} />
      </SliderPrimitive.Root>
    </div>
  );
}
