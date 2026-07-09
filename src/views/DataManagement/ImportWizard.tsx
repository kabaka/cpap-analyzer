/**
 * Full-page import wizard route (`/data/import`).
 *
 * Since the command-surface refresh the wizard is primarily a header-launched
 * MODAL ({@link import('@/components/import/ImportWizardModal').ImportWizardModal}).
 * This route is retained for deep-linking, the Dashboard empty-state CTA, the
 * dock's "Open import page" affordance, and the end-to-end import specs — all of
 * which drive the wizard as a full page. It hosts the SAME
 * {@link import('@/components/import/ImportWizardContent').ImportWizardContent}
 * engine as the modal (variant `"page"`), so there is exactly one implementation
 * of the wizard's logic and steps; only the surrounding chrome differs.
 *
 * @module views/DataManagement/ImportWizard
 */

import { ImportWizardContent } from '@/components/import/ImportWizardContent';
import styles from './ImportWizard.module.css';

export default function ImportWizard(): JSX.Element {
  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <ImportWizardContent variant="page" />
      </div>
    </div>
  );
}
