/**
 * Dashboard empty state — displayed when no sessions have been imported.
 *
 * Welcomes the user and guides them to import their CPAP data.
 *
 * @module views/Dashboard/EmptyState
 */

import { Link, useNavigate } from 'react-router-dom';
import { useCallback } from 'react';
import { Button } from '@/components/ui';
import styles from './EmptyState.module.css';

export function EmptyState() {
  const navigate = useNavigate();

  const handleImport = useCallback(() => {
    void navigate('/data/import');
  }, [navigate]);

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.logoSection}>
          <span className={styles.logoIcon} aria-hidden="true">
            📊
          </span>
          <h1 className={styles.title}>CPAP Analyzer</h1>
        </div>

        <p className={styles.subtitle}>
          Comprehensive CPAP therapy analysis that runs entirely in your browser.
        </p>

        <div className={styles.privacyBadge}>
          <span className={styles.lockIcon} aria-hidden="true">
            🔒
          </span>
          <span className={styles.privacyText}>
            All data processing happens locally. Nothing leaves your device.
          </span>
        </div>

        <div className={styles.actions}>
          <Button variant="primary" size="lg" onClick={handleImport}>
            Import Your Data
          </Button>
          <Link to="/help" className={styles.learnMore}>
            Learn More
          </Link>
        </div>
      </div>
    </div>
  );
}
