/**
 * ⌘K command palette — SHELL STUB.
 *
 * This wave ships the palette *frame* and its a11y contract: a focus-trapped
 * modal dialog (spec B5) with the 52px search input row, an (empty) results
 * listbox, a footer hint bar, Esc/backdrop close, and focus restoration to the
 * invoking control. The RESULTS are intentionally not implemented here — the
 * palette agent fills the `TODO(palette)` seam next (sections, fuzzy filter,
 * ↑/↓ cursor, ↵ activate, match highlight, empty state).
 *
 * Open state lives in `useAppStore.commandPaletteOpen` (ephemeral). The global
 * ⌘K/Ctrl+K shortcut and the header trigger toggle it; this component owns the
 * surface, focus management, and dismissal.
 *
 * @module components/CommandPalette
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/ui';
import { useAppStore } from '@/stores/useAppStore';
import styles from './CommandPalette.module.css';

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);

  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The control that had focus when the palette opened; focus returns to it on
  // close (WCAG 2.4.3 focus order — never strand focus on the dismissed dialog).
  const invokerRef = useRef<HTMLElement | null>(null);
  const listId = useId();

  const close = useCallback(() => setOpen(false), [setOpen]);

  // Capture the invoker + move focus to the input on open; restore focus on
  // close. The cleanup runs when `open` flips back to false (or on unmount).
  useEffect(() => {
    if (!open) return;
    invokerRef.current = document.activeElement as HTMLElement | null;
    const raf = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(raf);
      invokerRef.current?.focus?.();
      setQuery('');
    };
  }, [open]);

  // Escape closes; Tab is trapped within the panel.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  if (!open) return null;

  return (
    // Backdrop: clicking outside the panel dismisses (mousedown target is the
    // overlay itself, not a descendant of the panel).
    <div className={styles.overlay} onClick={close}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className={styles.panel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.inputRow}>
          <Icon name="search" size="sm" className={styles.searchIcon} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-label="Search sections, sessions, actions"
            placeholder="Search sections, sessions, actions…"
            className={styles.input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <span className={styles.keyChip}>Esc</span>
        </div>

        <ul id={listId} role="listbox" aria-label="Command results" className={styles.results}>
          {/* TODO(palette): results — sections (SECTIONS / SESSIONS / ACTIONS /
              RECENT), fuzzy filtering over `query`, ↑/↓ roving cursor with
              aria-activedescendant, ↵ activation, match highlight, and the
              empty state. The frame, focus trap and dismissal are done. */}
        </ul>

        <div className={styles.footer} aria-hidden="true">
          <span className={styles.hint}>
            <span className={styles.keyChip}>↑↓</span> Navigate
          </span>
          <span className={styles.hint}>
            <span className={styles.keyChip}>↵</span> Open
          </span>
          <span className={styles.hint}>
            <span className={styles.keyChip}>Esc</span> Close
          </span>
        </div>
      </div>
    </div>
  );
}
