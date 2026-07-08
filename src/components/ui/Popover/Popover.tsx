import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ReactNode } from 'react';
import styles from './Popover.module.css';

interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Distance in px between the trigger and the content (default 4). */
  sideOffset?: number;
  /**
   * Controlled open state. Omit for the default uncontrolled behaviour (Radix
   * manages open/close internally). When provided you MUST also handle
   * {@link onOpenChange} — Radix drives Escape / outside-click / trigger toggles
   * through it.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Extra class merged onto the content panel (after the base `.content`). */
  contentClassName?: string;
  /**
   * Raise the content to `--z-overlay` so it paints ABOVE sticky page chrome
   * (e.g. the command-strip header at `--z-sticky`). Default keeps it at
   * `--z-dropdown`. Implemented as a same-file class so its z-index reliably
   * wins the equal-specificity cascade over `.content`.
   */
  elevated?: boolean;
}

export function Popover({
  trigger,
  children,
  side = 'bottom',
  align = 'center',
  sideOffset = 4,
  open,
  onOpenChange,
  contentClassName,
  elevated = false,
}: PopoverProps) {
  const className = [styles.content, elevated ? styles.contentElevated : null, contentClassName]
    .filter(Boolean)
    .join(' ');

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className={className}
          side={side}
          align={align}
          sideOffset={sideOffset}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
