import { useState, useEffect } from 'react';
import { Dialog } from '@/components/ui';
import styles from './KeyboardShortcuts.module.css';

interface ShortcutGroup {
  readonly title: string;
  readonly shortcuts: readonly Shortcut[];
}

interface Shortcut {
  readonly keys: readonly string[];
  readonly description: string;
}

const shortcutGroups: readonly ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['G', 'D'], description: 'Go to Dashboard' },
      { keys: ['G', 'S'], description: 'Go to Sessions' },
      { keys: ['G', 'A'], description: 'Go to Analysis' },
      { keys: ['G', 'R'], description: 'Go to Reports' },
      { keys: ['G', 'H'], description: 'Go to Help' },
    ],
  },
  {
    title: 'Interface',
    shortcuts: [
      { keys: ['⌘K'], description: 'Open the command palette (Ctrl+K on Windows / Linux)' },
      { keys: ['['], description: 'Collapse / expand the navigation sidebar (desktop)' },
    ],
  },
  {
    title: 'Help',
    shortcuts: [
      { keys: ['?'], description: 'Open / close help panel' },
      { keys: ['Esc'], description: 'Close help panel or dialog' },
    ],
  },
  {
    title: 'Data & Views',
    shortcuts: [
      { keys: ['Ctrl', 'I'], description: 'Open import wizard' },
      { keys: ['Ctrl', 'E'], description: 'Export current view' },
    ],
  },
  {
    title: 'Chart Interaction',
    shortcuts: [
      { keys: ['←', '→'], description: 'Pan chart left / right' },
      { keys: ['+', '−'], description: 'Zoom in / out' },
      { keys: ['0'], description: 'Reset zoom' },
    ],
  },
];

interface KeyboardShortcutsProps {
  /** Controlled open state */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Keyboard shortcuts reference dialog.
 * Displays all application keyboard shortcuts organized by category.
 */
export function KeyboardShortcuts({ open: controlledOpen, onOpenChange }: KeyboardShortcutsProps) {
  const [internalOpen, setInternalOpen] = useState(false);

  const isOpen = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  // Allow opening via keyboard (only when no controlled state)
  useEffect(() => {
    if (controlledOpen !== undefined) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Shift+/ is the ? key on US keyboards
      if (event.key === '/' && event.shiftKey && !event.ctrlKey && !event.metaKey) {
        // Don't conflict with the HelpPanel ? handler — this one specifically handles Shift+/
        // The HelpPanel handles the `?` character key directly
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [controlledOpen]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={setOpen}
      title="Keyboard Shortcuts"
      description="Keyboard shortcuts available throughout CPAP Analyzer."
    >
      <div className={styles.container}>
        {shortcutGroups.map((group) => (
          <div key={group.title} className={styles.group}>
            <h4 className={styles.groupTitle}>{group.title}</h4>
            <dl className={styles.shortcutList}>
              {group.shortcuts.map((shortcut) => (
                <div key={shortcut.description} className={styles.shortcutRow}>
                  <dt className={styles.shortcutKeys}>
                    {shortcut.keys.map((key, i) => (
                      <span key={key}>
                        {i > 0 && <span className={styles.separator}>+</span>}
                        <kbd className={styles.key}>{key}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd className={styles.shortcutDescription}>{shortcut.description}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
