/**
 * Accessible segmented control for short binary/ternary enum choices
 * (e.g. °C / °F, hPa / inHg, km/h · mph · m/s, Daily / Daily+Hourly).
 *
 * Implements the WAI-ARIA radiogroup pattern:
 * - `role="radiogroup"` wrapper, `role="radio"` segments, `aria-checked`.
 * - Roving tabindex: only the selected (or first) segment is in the tab order;
 *   Arrow keys move selection between segments (wrapping), Home/End jump to the
 *   ends, Space/Enter re-selects the focused segment.
 * - Per-segment `aria-label` (the full, spelled-out unit name) so screen-reader
 *   users hear "Celsius", not "C".
 *
 * Two visual variants, both keeping a NON-COLOUR selected cue (WCAG 1.4.1):
 * - `underline` (default): 2px `--color-primary` bottom border + elevated
 *   surface. The original look; unchanged.
 * - `solid` (command surface): the selected segment is the ONLY one with a
 *   filled background — a presence/absence cue, not a hue cue. Pairs with the
 *   `sm` size for the dense header window/list toggles. The `tone` prop swaps
 *   the fill accent to `--color-ai` for AI affordances (e.g. the backend
 *   toggle) via the `--seg-accent` custom property.
 *
 * Generic over the option value type so callers keep their literal-union typing.
 *
 * @module components/ui/SegmentedControl
 */

import { useCallback, useId, useRef } from 'react';
import styles from './SegmentedControl.module.css';

/** A single selectable segment. */
export interface SegmentedControlOption<V extends string> {
  /** The option value (returned to {@link SegmentedControlProps.onChange}). */
  readonly value: V;
  /** Short visible label (e.g. "°C"). */
  readonly label: string;
  /**
   * Full accessible name for screen readers (e.g. "Celsius"). Falls back to
   * {@link label} when omitted.
   */
  readonly ariaLabel?: string;
}

export interface SegmentedControlProps<V extends string> {
  /** Accessible name for the whole group (e.g. "Temperature unit"). */
  readonly label: string;
  /** The available segments (2–4 recommended). */
  readonly options: ReadonlyArray<SegmentedControlOption<V>>;
  /** The currently selected value. */
  readonly value: V;
  /** Called with the new value when the selection changes. */
  readonly onChange: (value: V) => void;
  /** Disable the whole control. */
  readonly disabled?: boolean;
  /**
   * Visual variant. `underline` (default) is the original elevated-surface +
   * 2px bottom-border look; `solid` fills the selected segment (command
   * surface). Both keep a non-colour selected cue.
   */
  readonly variant?: 'underline' | 'solid';
  /** Segment sizing. `md` (default) or the dense `sm` used by command-surface chrome. */
  readonly size?: 'md' | 'sm';
  /**
   * Accent for the `solid` selected fill. `primary` (default) uses
   * `--color-primary`; `ai` uses `--color-ai` for AI affordances. No effect on
   * the `underline` variant.
   */
  readonly tone?: 'primary' | 'ai';
  /** Optional class for the radiogroup wrapper. */
  readonly className?: string;
}

export function SegmentedControl<V extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  variant = 'underline',
  size = 'md',
  tone = 'primary',
  className,
}: SegmentedControlProps<V>): JSX.Element {
  const groupId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  // `selectedIndex` is -1 when `value` matches no option — a deliberate
  // "no selection" state (e.g. the header window toggle when a Custom range is
  // active, so no preset segment should read as selected). A radiogroup with no
  // checked radio is valid ARIA. When nothing is selected the FIRST segment
  // becomes the keyboard tab-stop so the group stays reachable.
  const selectedIndex = options.findIndex((o) => o.value === value);
  const hasSelection = selectedIndex >= 0;

  const focusAndSelect = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option) return;
      refs.current[index]?.focus();
      if (option.value !== value) {
        onChange(option.value);
      }
    },
    [options, onChange, value],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (disabled) return;
      const last = options.length - 1;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown': {
          event.preventDefault();
          focusAndSelect(index === last ? 0 : index + 1);
          break;
        }
        case 'ArrowLeft':
        case 'ArrowUp': {
          event.preventDefault();
          focusAndSelect(index === 0 ? last : index - 1);
          break;
        }
        case 'Home': {
          event.preventDefault();
          focusAndSelect(0);
          break;
        }
        case 'End': {
          event.preventDefault();
          focusAndSelect(last);
          break;
        }
        case ' ':
        case 'Enter': {
          event.preventDefault();
          focusAndSelect(index);
          break;
        }
        default:
          break;
      }
    },
    [disabled, options, focusAndSelect],
  );

  const solid = variant === 'solid';
  const segmentClass = size === 'sm' ? styles.segmentSm : styles.segment;
  const selectedClass = solid ? styles.selectedSolid : styles.selected;

  const wrapperClass = [
    solid ? styles.groupSolid : styles.group,
    tone === 'ai' ? styles.toneAi : null,
    disabled ? styles.disabled : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={wrapperClass}
    >
      {options.map((option, index) => {
        const checked = index === selectedIndex;
        // Roving tabindex: the selected segment is the tab-stop; when nothing is
        // selected the first segment holds it so the group is still tabbable.
        const isTabStop = hasSelection ? checked : index === 0;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            id={`${groupId}-${option.value}`}
            aria-checked={checked}
            aria-label={option.ariaLabel ?? option.label}
            tabIndex={disabled ? -1 : isTabStop ? 0 : -1}
            disabled={disabled}
            className={`${segmentClass} ${checked ? selectedClass : ''}`}
            onClick={() => focusAndSelect(index)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
