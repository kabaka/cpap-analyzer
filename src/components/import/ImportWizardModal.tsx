/**
 * Header-launched import wizard modal (spec Part C "Import wizard / dock /
 * stages", prototype `importWizardEl`).
 *
 * A focus-trapped modal dialog mounted app-level (a sibling of the ⌘K palette and
 * the {@link import('./ImportStatusDock').ImportStatusDock}). It hosts the shared
 * {@link ImportWizardContent} — so the full CPAP/Google-Health richness, the
 * adopt-running-job behaviour, and the confirmed cancel are identical to the
 * `/data/import` route; only the chrome differs.
 *
 * Open state lives in `useAppStore.importWizardOpen` (ephemeral). The header
 * Import button and the Data-page buttons set it. Esc / backdrop / the close
 * button all "continue in background" — they close the modal WITHOUT cancelling
 * (the job keeps running on the controller and stays visible in the dock),
 * matching the prototype. Only the explicit "Cancel import" button (inside the
 * content) opens the confirmed-cancel dialog; while that dialog is up this modal
 * suspends its own Esc/backdrop dismissal so the dialog owns the interaction.
 *
 * The modal frame + a11y contract (role=dialog, aria-modal, focus trap, focus
 * restore, reduced-motion enter) mirror the command palette.
 *
 * @module components/import/ImportWizardModal
 */

import { Suspense, lazy, useCallback, useEffect, useId, useRef } from 'react';

import { useAppStore } from '@/stores/useAppStore';

import styles from './ImportWizardModal.module.css';

// Lazy so the wizard engine (import hooks + step components) is code-split OUT of
// the always-mounted shell and only fetched when the modal is first opened.
const ImportWizardContent = lazy(() => import('./ImportWizardContent'));

export function ImportWizardModal(): JSX.Element | null {
  const open = useAppStore((s) => s.importWizardOpen);
  const setOpen = useAppStore((s) => s.setImportWizardOpen);

  const panelRef = useRef<HTMLDivElement>(null);
  // The control that had focus when the modal opened; focus returns to it on
  // close (WCAG 2.4.3 — never strand focus on a dismissed dialog).
  const invokerRef = useRef<HTMLElement | null>(null);
  // Whether a nested blocking layer (the confirmed-cancel dialog) is open; while
  // it is, this modal suspends its own Esc/backdrop close.
  const blockingLayerRef = useRef(false);
  const titleId = useId();

  const close = useCallback(() => setOpen(false), [setOpen]);

  const onBlockingLayerChange = useCallback((blocking: boolean) => {
    blockingLayerRef.current = blocking;
  }, []);

  // Capture the invoker + move focus into the panel on open; restore focus on
  // close. Cleanup runs when `open` flips back to false (or on unmount).
  useEffect(() => {
    if (!open) return;
    invokerRef.current = document.activeElement as HTMLElement | null;
    const raf = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (first ?? panel).focus();
    });
    return () => {
      window.cancelAnimationFrame(raf);
      invokerRef.current?.focus?.();
    };
  }, [open]);

  // Escape closes (continue in background); Tab is trapped within the panel.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // Let the confirmed-cancel dialog own Escape while it is open.
        if (blockingLayerRef.current) return;
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
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === firstEl) {
        event.preventDefault();
        lastEl?.focus();
      } else if (!event.shiftKey && active === lastEl) {
        event.preventDefault();
        firstEl?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  const onBackdropClick = useCallback(() => {
    // While the confirmed-cancel dialog is up it owns dismissal (and its own
    // overlay covers this one anyway).
    if (blockingLayerRef.current) return;
    close();
  }, [close]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onBackdropClick}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.panel}
        // Focusable container: the wizard body is lazy-loaded, so on first open
        // there is no inner focusable yet — focus lands here (still inside the
        // dialog) and Tab moves into the content once it mounts.
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <Suspense fallback={<div className={styles.loading}>Loading&hellip;</div>}>
          <ImportWizardContent
            variant="modal"
            onClose={close}
            onBlockingLayerChange={onBlockingLayerChange}
            titleId={titleId}
          />
        </Suspense>
      </div>
    </div>
  );
}

export default ImportWizardModal;
