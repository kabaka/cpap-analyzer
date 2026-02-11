import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import styles from './DropdownMenu.module.css';

interface DropdownMenuItem {
  label: string;
  onClick?: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  separator?: boolean;
}

interface DropdownMenuProps {
  trigger: ReactNode;
  items: DropdownMenuItem[];
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

export function DropdownMenu({
  trigger,
  items,
  side = 'bottom',
  align = 'start',
}: DropdownMenuProps) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>{trigger}</DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          className={styles.content}
          side={side}
          align={align}
          sideOffset={4}
        >
          {items.map((item, index) => {
            if (item.separator) {
              return (
                <DropdownMenuPrimitive.Separator
                  key={`sep-${index}`}
                  className={styles.separator}
                />
              );
            }
            return (
              <DropdownMenuPrimitive.Item
                key={item.label}
                className={styles.item}
                disabled={item.disabled}
                onSelect={item.onClick}
              >
                {item.icon && <span className={styles.icon}>{item.icon}</span>}
                {item.label}
              </DropdownMenuPrimitive.Item>
            );
          })}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
