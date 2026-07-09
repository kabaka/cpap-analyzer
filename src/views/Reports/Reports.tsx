/**
 * Reports view — generate, configure, and download CPAP reports.
 *
 * Provides template selection, date range configuration, section
 * customization, and export actions (PDF, CSV, encrypted archive).
 *
 * @module views/Reports/Reports
 */

import { useCallback, useId, useMemo, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { Button, Input } from '@/components/ui';
import {
  generatePDF,
  generateCSV,
  generateEncryptedArchive,
  downloadBlob,
  REPORT_TEMPLATES,
  PHYSICIAN_SUMMARY_SECTIONS,
  FULL_ANALYSIS_SECTIONS,
  CUSTOM_DEFAULT_SECTIONS,
} from '@/services/reports';
import type { ReportContentSelection, ReportSections, ReportTemplate } from '@/services/reports';
import { formatDate } from '@/utils/formatDate';
import styles from './Reports.module.css';

// ── Section labels ───────────────────────────────────────────────

const SECTION_LABELS: Record<keyof ReportSections, string> = {
  summaryStatistics: 'Summary Statistics',
  sessionDetails: 'Session Details',
  ahiTrend: 'AHI Trend',
  leakAnalysis: 'Leak Analysis',
  pressureMetrics: 'Pressure Metrics',
  eventBreakdown: 'Event Breakdown',
  complianceReport: 'Compliance Report',
  usagePatterns: 'Usage Patterns',
};

const SECTION_KEYS = Object.keys(SECTION_LABELS) as (keyof ReportSections)[];

// ── Helpers ──────────────────────────────────────────────────────

function getDefaultSections(template: ReportTemplate): ReportSections {
  switch (template) {
    case 'physician-summary':
      return { ...PHYSICIAN_SUMMARY_SECTIONS };
    case 'full-analysis':
      return { ...FULL_ANALYSIS_SECTIONS };
    case 'custom':
      return { ...CUSTOM_DEFAULT_SECTIONS };
  }
}

type StatusKind = 'idle' | 'loading' | 'success' | 'error';

interface StatusState {
  kind: StatusKind;
  message: string;
}

// ── Component ────────────────────────────────────────────────────

export default function Reports() {
  const globalDateRange = useAppStore((s) => s.dateRange);
  // Bind native date-picker chrome to the active theme (spec Part D).
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const idPrefix = useId();

  // Template selection
  const [template, setTemplate] = useState<ReportTemplate>('physician-summary');

  // Date range — Reports keeps its own export range, seeded from the global window.
  const [startDate, setStartDate] = useState(() => formatDate(globalDateRange.start));
  const [endDate, setEndDate] = useState(() => formatDate(globalDateRange.end));

  // Sections
  const [sections, setSections] = useState<ReportSections>(() =>
    getDefaultSections('physician-summary'),
  );

  // Encryption
  const [password, setPassword] = useState('');

  // Status
  const [status, setStatus] = useState<StatusState>({ kind: 'idle', message: '' });

  // Computed date range for the service
  const dateRange = useMemo(() => ({ start: startDate, end: endDate }), [startDate, endDate]);

  // Template change handler
  const handleTemplateChange = useCallback((newTemplate: ReportTemplate) => {
    setTemplate(newTemplate);
    setSections(getDefaultSections(newTemplate));
  }, []);

  // Section toggle handler
  const handleSectionToggle = useCallback((key: keyof ReportSections) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Content selection object
  const contentSelection: ReportContentSelection = useMemo(
    () => ({
      template,
      dateRange,
      sections,
      format: 'pdf',
    }),
    [template, dateRange, sections],
  );

  // PDF generation
  const handleGeneratePDF = useCallback(async () => {
    setStatus({ kind: 'loading', message: 'Generating PDF report…' });
    try {
      const result = await generatePDF(contentSelection);
      downloadBlob(result.blob, result.filename);
      setStatus({ kind: 'success', message: `PDF report downloaded: ${result.filename}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate PDF';
      setStatus({ kind: 'error', message });
    }
  }, [contentSelection]);

  // CSV generation
  const handleGenerateCSV = useCallback(async () => {
    setStatus({ kind: 'loading', message: 'Generating CSV export…' });
    try {
      const result = await generateCSV(dateRange);
      downloadBlob(result.blob, result.filename);
      setStatus({ kind: 'success', message: `CSV exported: ${result.filename}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate CSV';
      setStatus({ kind: 'error', message });
    }
  }, [dateRange]);

  // Encrypted export
  const handleGenerateEncrypted = useCallback(async () => {
    if (!password) {
      setStatus({ kind: 'error', message: 'Please enter a password for encryption.' });
      return;
    }
    if (password.length < 8) {
      setStatus({ kind: 'error', message: 'Password must be at least 8 characters.' });
      return;
    }
    setStatus({ kind: 'loading', message: 'Encrypting data…' });
    try {
      const result = await generateEncryptedArchive(dateRange, { password });
      downloadBlob(result.blob, result.filename);
      setStatus({
        kind: 'success',
        message: `Encrypted archive downloaded: ${result.filename}`,
      });
      setPassword('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to encrypt data';
      setStatus({ kind: 'error', message });
    }
  }, [dateRange, password]);

  const isLoading = status.kind === 'loading';

  return (
    <div className={styles.reports}>
      {/* The shell command strip shows the "REPORTS" section title, so the page
          keeps a single visually-hidden <h1> for the a11y tree + e2e selectors. */}
      <h1 className={styles.srOnly}>Reports</h1>
      <p className={styles.subtitle}>
        Generate and download reports from your CPAP therapy data. All processing happens in your
        browser — no data leaves your device.
      </p>

      {/* Template Picker */}
      <section className={styles.panel} aria-labelledby={`${idPrefix}-templates`}>
        <h2 id={`${idPrefix}-templates`} className={styles.panelHeading}>
          Choose a Template
        </h2>
        <div className={styles.templateGrid} role="radiogroup" aria-label="Report templates">
          {REPORT_TEMPLATES.map((t) => {
            const isSelected = template === t.id;
            return (
              <div
                key={t.id}
                className={`${styles.templateCard} ${isSelected ? styles.templateCardSelected : ''}`}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                onClick={() => handleTemplateChange(t.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleTemplateChange(t.id);
                  }
                }}
              >
                {isSelected && <span className={styles.selectedBadge}>Selected</span>}
                <h3 className={styles.templateName}>{t.name}</h3>
                <p className={styles.templateDescription}>{t.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Date Range */}
      <section className={styles.panel} aria-labelledby={`${idPrefix}-daterange`}>
        <h2 id={`${idPrefix}-daterange`} className={styles.panelHeading}>
          Date Range
        </h2>
        <div className={styles.dateRangeRow}>
          <div className={styles.dateField}>
            <label htmlFor={`${idPrefix}-start`} className={styles.dateLabel}>
              Start Date
            </label>
            <input
              id={`${idPrefix}-start`}
              type="date"
              className={styles.dateInput}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ colorScheme: resolvedTheme }}
            />
          </div>
          <div className={styles.dateField}>
            <label htmlFor={`${idPrefix}-end`} className={styles.dateLabel}>
              End Date
            </label>
            <input
              id={`${idPrefix}-end`}
              type="date"
              className={styles.dateInput}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ colorScheme: resolvedTheme }}
            />
          </div>
        </div>
      </section>

      {/* Section Configuration (only for custom template) */}
      {template === 'custom' && (
        <section className={styles.panel} aria-labelledby={`${idPrefix}-sections`}>
          <h2 id={`${idPrefix}-sections`} className={styles.panelHeading}>
            Report Sections
          </h2>
          <div className={styles.sectionsGrid}>
            {SECTION_KEYS.map((key) => (
              <div key={key} className={styles.checkboxItem}>
                <input
                  id={`${idPrefix}-section-${key}`}
                  type="checkbox"
                  className={styles.checkbox}
                  checked={sections[key]}
                  onChange={() => handleSectionToggle(key)}
                />
                <label htmlFor={`${idPrefix}-section-${key}`} className={styles.checkboxLabel}>
                  {SECTION_LABELS[key]}
                </label>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Download actions */}
      <section className={styles.panel} aria-labelledby={`${idPrefix}-actions`}>
        <h2 id={`${idPrefix}-actions`} className={styles.panelHeading}>
          Download
        </h2>
        <div className={styles.actionsRow}>
          <Button onClick={handleGeneratePDF} loading={isLoading} disabled={isLoading}>
            Download PDF Report
          </Button>
          <Button
            variant="secondary"
            onClick={handleGenerateCSV}
            loading={isLoading}
            disabled={isLoading}
          >
            Export CSV Data
          </Button>
        </div>
      </section>

      {/* Encrypted Export */}
      <section className={styles.panel} aria-labelledby={`${idPrefix}-encrypt`}>
        <h2 id={`${idPrefix}-encrypt`} className={styles.panelHeading}>
          Encrypted Export
        </h2>
        <p className={styles.panelDescription}>
          Export your data as an AES-256-GCM encrypted archive. You will need the password to
          decrypt it later.
        </p>
        <div className={styles.encryptionRow}>
          <div className={styles.passwordInput}>
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              hint="Used to derive the encryption key via PBKDF2."
            />
          </div>
          <Button
            variant="secondary"
            onClick={handleGenerateEncrypted}
            loading={isLoading}
            disabled={isLoading}
          >
            Download Encrypted Archive
          </Button>
        </div>
      </section>

      {/* Status message */}
      {status.kind !== 'idle' && (
        <p
          className={`${styles.statusMessage} ${
            status.kind === 'success'
              ? styles.statusSuccess
              : status.kind === 'error'
                ? styles.statusError
                : styles.statusLoading
          }`}
          role="status"
          aria-live="polite"
        >
          {status.message}
        </p>
      )}
    </div>
  );
}
