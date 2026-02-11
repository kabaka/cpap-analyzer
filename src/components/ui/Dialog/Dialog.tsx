import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import styles from './Dialog.module.css';

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  trigger?: ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, children, trigger }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={styles.overlay} />
        <DialogPrimitive.Content className={styles.content}>
          <DialogPrimitive.Title className={styles.title}>{title}</DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description className={styles.description}>
              {description}
            </DialogPrimitive.Description>
          )}
          {children}
          <DialogPrimitive.Close className={styles.close} aria-label="Close">
            <CloseIcon />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 4L12 12M12 4L4 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
