import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { useCallback } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { Icon, type IconName } from '@/components/ui';
import styles from './ThemeMenu.module.css';

type Theme = 'light' | 'dark' | 'system';

const THEME_LABEL: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const THEME_ICON: Record<Theme, IconName> = {
  light: 'theme-light',
  dark: 'theme-dark',
  system: 'theme-system',
};

const OPTIONS: readonly Theme[] = ['light', 'dark', 'system'];

/**
 * Header theme control: a labelled dropdown menu with radio-style options.
 *
 * The trigger is a borderless icon button showing the currently resolved theme
 * glyph (sun/moon) with an accessible name reflecting the active *setting*
 * (e.g. "Theme: System"). The menu offers Light / Dark / System as
 * `menuitemradio` items with `aria-checked` mirroring the store. The System
 * item annotates what it currently resolves to.
 *
 * Built on the Radix dropdown-menu primitives directly (rather than the generic
 * `DropdownMenu` wrapper) because the wrapper renders plain menu items and this
 * control requires single-select radio semantics for accessibility.
 */
export function ThemeMenu() {
  const theme = useAppStore((s) => s.theme);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const setTheme = useAppStore((s) => s.setTheme);

  const handleValueChange = useCallback(
    (value: string) => {
      if (value === 'light' || value === 'dark' || value === 'system') {
        setTheme(value);
      }
    },
    [setTheme],
  );

  const triggerIcon: IconName = resolvedTheme === 'dark' ? 'theme-dark' : 'theme-light';

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          className={styles.trigger}
          aria-label={`Theme: ${THEME_LABEL[theme]}`}
        >
          <Icon name={triggerIcon} size="md" />
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          className={styles.content}
          side="bottom"
          align="end"
          sideOffset={4}
        >
          <DropdownMenuPrimitive.RadioGroup value={theme} onValueChange={handleValueChange}>
            {OPTIONS.map((option) => (
              <DropdownMenuPrimitive.RadioItem key={option} className={styles.item} value={option}>
                <span className={styles.itemIcon}>
                  <Icon name={THEME_ICON[option]} size="sm" />
                </span>
                <span className={styles.itemLabel}>
                  {THEME_LABEL[option]}
                  {option === 'system' && (
                    <span className={styles.itemHint}>
                      {' '}
                      ({resolvedTheme === 'dark' ? 'Dark' : 'Light'})
                    </span>
                  )}
                </span>
                <DropdownMenuPrimitive.ItemIndicator className={styles.indicator} aria-hidden>
                  <span className={styles.dot} />
                </DropdownMenuPrimitive.ItemIndicator>
              </DropdownMenuPrimitive.RadioItem>
            ))}
          </DropdownMenuPrimitive.RadioGroup>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
