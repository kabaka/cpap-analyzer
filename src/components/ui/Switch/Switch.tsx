import * as SwitchPrimitive from '@radix-ui/react-switch';
import { useId } from 'react';
import styles from './Switch.module.css';

interface SwitchProps {
  label?: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, checked, onCheckedChange, disabled }: SwitchProps) {
  const id = useId();

  return (
    <div className={styles.wrapper}>
      {label && (
        <label htmlFor={id} className={styles.label} data-disabled={disabled ? '' : undefined}>
          {label}
        </label>
      )}
      <SwitchPrimitive.Root
        id={id}
        className={styles.root}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      >
        <SwitchPrimitive.Thumb className={styles.thumb} />
      </SwitchPrimitive.Root>
    </div>
  );
}
