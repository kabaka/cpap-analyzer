import styles from './StatusBar.module.css';

export function StatusBar() {
  return (
    <footer className={styles.statusBar} role="contentinfo" aria-label="Application status">
      <span className={styles.sessionCount}>—</span>
      <span className={styles.storageUsage}>—</span>
    </footer>
  );
}
