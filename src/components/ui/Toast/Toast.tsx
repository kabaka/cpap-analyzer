import * as ToastPrimitive from '@radix-ui/react-toast';
import { useCallback, useState } from 'react';
import styles from './Toast.module.css';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastData {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastState {
  toasts: ToastData[];
  toast: (options: Omit<ToastData, 'id'>) => void;
  dismiss: (id: string) => void;
}

let toastCounter = 0;

// eslint-disable-next-line react-refresh/only-export-components -- hook intentionally colocated with its provider; fast-refresh is dev-only and these exports are stable
export function useToast(): ToastState {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const toast = useCallback((options: Omit<ToastData, 'id'>) => {
    const id = String(++toastCounter);
    setToasts((prev) => [...prev, { ...options, id }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, toast, dismiss };
}

interface ToastProviderProps {
  children: React.ReactNode;
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

export function ToastProvider({ children, toasts, onDismiss }: ToastProviderProps) {
  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {children}
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
      <ToastPrimitive.Viewport className={styles.viewport} />
    </ToastPrimitive.Provider>
  );
}

interface ToastItemProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast: t, onDismiss }: ToastItemProps) {
  const rootClassNames = [styles.root, t.variant ? styles[t.variant] : undefined]
    .filter(Boolean)
    .join(' ');

  return (
    <ToastPrimitive.Root
      className={rootClassNames}
      duration={t.duration ?? 5000}
      onOpenChange={(open) => {
        if (!open) onDismiss(t.id);
      }}
    >
      <div className={styles.body}>
        <ToastPrimitive.Title className={styles.title}>{t.title}</ToastPrimitive.Title>
        {t.description && (
          <ToastPrimitive.Description className={styles.description}>
            {t.description}
          </ToastPrimitive.Description>
        )}
      </div>
      <ToastPrimitive.Close className={styles.close} aria-label="Dismiss">
        <CloseIcon />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 4L12 12M12 4L4 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
