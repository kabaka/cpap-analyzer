import * as SelectPrimitive from '@radix-ui/react-select';
import { useId } from 'react';
import styles from './Select.module.css';

interface SelectOption {
  value: string;
  label: string;
}

/** A labelled group of options, rendered as a Radix `Group` with a heading. */
interface SelectOptionGroup {
  /** Group heading shown above its options (e.g. "Weather & Environment"). */
  label: string;
  options: SelectOption[];
}

interface SelectProps {
  label?: string;
  /**
   * Flat list of options. Mutually exclusive with {@link SelectProps.groups};
   * when both are provided, `groups` takes precedence.
   */
  options?: SelectOption[];
  /**
   * Grouped options, each with its own heading. Used for the cross-source
   * "Compare against" selector (Wearable / Weather & Environment optgroups).
   */
  groups?: SelectOptionGroup[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
}

export function Select({
  label,
  options,
  groups,
  value,
  onValueChange,
  placeholder = 'Select…',
  error,
  disabled,
}: SelectProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;

  const triggerClassNames = [styles.trigger, error && styles.triggerError]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.wrapper}>
      {label && (
        <label className={styles.label} id={`${id}-label`}>
          {label}
        </label>
      )}
      <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectPrimitive.Trigger
          className={triggerClassNames}
          aria-labelledby={label ? `${id}-label` : undefined}
          aria-describedby={errorId}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon className={styles.icon}>
            <ChevronDownIcon />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Content className={styles.content} position="popper" sideOffset={4}>
            <SelectPrimitive.Viewport className={styles.viewport}>
              {groups
                ? groups.map((group) => (
                    <SelectPrimitive.Group key={group.label}>
                      <SelectPrimitive.Label className={styles.groupLabel}>
                        {group.label}
                      </SelectPrimitive.Label>
                      {group.options.map((option) => renderItem(option))}
                    </SelectPrimitive.Group>
                  ))
                : (options ?? []).map((option) => renderItem(option))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {error && (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function renderItem(option: SelectOption) {
  return (
    <SelectPrimitive.Item key={option.value} value={option.value} className={styles.item}>
      <SelectPrimitive.ItemIndicator className={styles.itemIndicator}>
        <CheckIcon />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 6L8 10L12 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8L6.5 11.5L13 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
