/**
 * Privacy-first backend radiogroup for AI Insights (UX §3.3, visual spec §2).
 *
 * A custom `role="radiogroup"` (NOT a `<select>`) so each option can carry an
 * inline privacy badge, a description, and a live availability status. The two
 * on-device backends are grouped under a green "Stays on your device" divider
 * (the default group); the two cloud backends under a blue "Sends a metric
 * snapshot online" divider. Cloud is never auto-selected.
 *
 * Accessibility (UX §8.1, visual spec §2.3):
 * - Roving tabindex: exactly one option is in the tab order; ↑/↓/←/→ move
 *   selection, Home/End jump to ends, Space/Enter selects.
 * - `aria-checked` is authoritative; the filled radio dot is the non-color cue.
 * - The 🟢/🔵 badge glyphs are `aria-hidden`; the badge *text* ("On-device ·
 *   Zero egress" / "Connects online") carries the signal (WCAG 1.4.1).
 * - Visible focus ring independent of the selected border.
 *
 * @module views/Settings/ai/BackendRadioGroup
 */

import { useCallback, useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { LLMBackendId } from '@/types/settings';
import { CLOUD_BACKENDS, LOCAL_BACKENDS } from './backends';
import type { BackendOption } from './backends';
import styles from './AiInsightsPanel.module.css';

/** Per-option live status line (availability / config), or `null` to omit. */
export type BackendStatusMap = Partial<Record<LLMBackendId, string | null>>;

/** Whether each option is selectable; defaults to enabled when omitted. */
export type BackendDisabledMap = Partial<Record<LLMBackendId, boolean>>;

export interface BackendRadioGroupProps {
  /** Currently selected backend, or `null` when none chosen yet. */
  readonly value: LLMBackendId | null;
  /** Fired when the user selects a backend. */
  readonly onChange: (backend: LLMBackendId) => void;
  /** Inline status line per backend (e.g. "Model not downloaded", "Key required"). */
  readonly status?: BackendStatusMap;
  /** Disabled (unsupported) options — kept visible with their status, never hidden. */
  readonly disabled?: BackendDisabledMap;
}

/** Flat, ordered list used for roving keyboard navigation across both groups. */
const ORDER: readonly LLMBackendId[] = [
  ...LOCAL_BACKENDS.map((b) => b.id),
  ...CLOUD_BACKENDS.map((b) => b.id),
];

export function BackendRadioGroup({
  value,
  onChange,
  status = {},
  disabled = {},
}: BackendRadioGroupProps): JSX.Element {
  const groupId = useId();
  const refs = useRef(new Map<LLMBackendId, HTMLDivElement>());

  const enabledOrder = ORDER.filter((id) => disabled[id] !== true);

  // The single roving tab stop: the selected option if it is enabled, else the
  // first enabled option, else the first option (so the group is always
  // reachable even if everything is unsupported).
  const tabStop: LLMBackendId | null =
    value !== null && disabled[value] !== true ? value : (enabledOrder[0] ?? ORDER[0] ?? null);

  const focusOption = useCallback((id: LLMBackendId) => {
    refs.current.get(id)?.focus();
  }, []);

  const moveSelection = useCallback(
    (current: LLMBackendId, delta: 1 | -1) => {
      if (enabledOrder.length === 0) return;
      const idx = enabledOrder.indexOf(current);
      // If the current option is disabled it won't be in enabledOrder; start from 0.
      const base = idx === -1 ? 0 : idx;
      const nextIdx = (base + delta + enabledOrder.length) % enabledOrder.length;
      const next = enabledOrder[nextIdx];
      if (next === undefined) return;
      onChange(next);
      focusOption(next);
    },
    [enabledOrder, onChange, focusOption],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, id: LLMBackendId) => {
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          event.preventDefault();
          moveSelection(id, 1);
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          event.preventDefault();
          moveSelection(id, -1);
          break;
        case 'Home': {
          event.preventDefault();
          const first = enabledOrder[0];
          if (first !== undefined) {
            onChange(first);
            focusOption(first);
          }
          break;
        }
        case 'End': {
          event.preventDefault();
          const last = enabledOrder[enabledOrder.length - 1];
          if (last !== undefined) {
            onChange(last);
            focusOption(last);
          }
          break;
        }
        case ' ':
        case 'Enter':
          event.preventDefault();
          if (disabled[id] !== true) onChange(id);
          break;
        default:
          break;
      }
    },
    [moveSelection, enabledOrder, onChange, focusOption, disabled],
  );

  const renderOption = (option: BackendOption) => {
    const checked = value === option.id;
    const isDisabled = disabled[option.id] === true;
    const statusText = status[option.id];
    const isLocal = option.egress === 'local';

    return (
      <div
        key={option.id}
        ref={(el) => {
          if (el) refs.current.set(option.id, el);
          else refs.current.delete(option.id);
        }}
        role="radio"
        aria-checked={checked}
        aria-disabled={isDisabled || undefined}
        aria-describedby={`${groupId}-${option.id}-desc`}
        tabIndex={tabStop === option.id ? 0 : -1}
        className={`${styles.option} ${checked ? styles.optionSelected : ''} ${
          isDisabled ? styles.optionDisabled : ''
        }`}
        onClick={() => {
          if (!isDisabled) onChange(option.id);
        }}
        onKeyDown={(e) => handleKeyDown(e, option.id)}
      >
        <span className={styles.radioDot} aria-hidden="true" data-checked={checked || undefined} />
        <span className={styles.optionBody}>
          <span className={styles.optionLabel}>{option.label}</span>
          <span id={`${groupId}-${option.id}-desc`} className={styles.optionDescription}>
            {option.description}
          </span>
          {statusText != null && statusText.length > 0 && (
            <span className={styles.optionStatus}>{statusText}</span>
          )}
        </span>
        <span
          className={`${styles.privacyBadge} ${isLocal ? styles.badgeLocal : styles.badgeCloud}`}
        >
          <span aria-hidden="true">{isLocal ? '🟢' : '🔵'}</span>
          {isLocal ? 'On-device · Zero egress' : 'Connects online'}
        </span>
      </div>
    );
  };

  return (
    <div role="radiogroup" aria-label="AI backend" className={styles.radioGroup}>
      <fieldset className={`${styles.group} ${styles.subgroupLocal}`}>
        <legend className={`${styles.groupLegend} ${styles.legendLocal}`}>
          <span aria-hidden="true">🟢</span> Stays on your device
          <span className={styles.legendSub}>nothing is sent anywhere.</span>
        </legend>
        {LOCAL_BACKENDS.map(renderOption)}
      </fieldset>

      <fieldset className={`${styles.group} ${styles.subgroupCloud}`}>
        <legend className={`${styles.groupLegend} ${styles.legendCloud}`}>
          <span aria-hidden="true">🔵</span> Sends a metric snapshot online
          <span className={styles.legendSub}>requires your consent and your own API key.</span>
        </legend>
        {CLOUD_BACKENDS.map(renderOption)}
      </fieldset>
    </div>
  );
}
