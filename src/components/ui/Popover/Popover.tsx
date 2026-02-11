import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ReactNode } from 'react';
import styles from './Popover.module.css';

interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

export function Popover({ trigger, children, side = 'bottom', align = 'center' }: PopoverProps) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className={styles.content}
          side={side}
          align={align}
          sideOffset={4}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
