/**
 * App-level toast bridge for the import UI.
 *
 * The base {@link useToast} primitive is component-local state: whoever calls it
 * owns the queue, and {@link ToastProvider} renders that queue's items. To let a
 * RootLayout-level surface (the import dock) raise toasts that any descendant can
 * also trigger, this module hoists a SINGLE `useToast` instance into a context
 * and renders one {@link ToastProvider} around the subtree.
 *
 * `useImportToast()` returns a stable `toast(...)` dispatcher; if no provider is
 * mounted (e.g. an isolated unit test) it degrades to a no-op so callers never
 * crash.
 *
 * @module components/import/ImportToastContext
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { ToastProvider, useToast } from '@/components/ui';

/** A toast request (mirrors the base primitive's options). */
export interface ToastRequest {
  readonly title: string;
  readonly description?: string;
  readonly variant?: 'success' | 'error' | 'warning' | 'info';
  readonly duration?: number;
}

/** The context value: a single stable dispatcher. */
interface ImportToastContextValue {
  readonly toast: (request: ToastRequest) => void;
}

const noopToast: ImportToastContextValue = { toast: () => undefined };

const ImportToastContext = createContext<ImportToastContextValue>(noopToast);

/**
 * Mounts a single toast queue + viewport around `children` and provides a stable
 * dispatcher via context.
 */
export function ImportToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const { toasts, toast, dismiss } = useToast();
  const value = useMemo<ImportToastContextValue>(() => ({ toast }), [toast]);

  return (
    <ImportToastContext.Provider value={value}>
      <ToastProvider toasts={toasts} onDismiss={dismiss}>
        {children}
      </ToastProvider>
    </ImportToastContext.Provider>
  );
}

/** Access the app-level toast dispatcher (no-op when no provider is mounted). */
export function useImportToast(): (request: ToastRequest) => void {
  return useContext(ImportToastContext).toast;
}
