/**
 * Multi-step import wizard.
 *
 * Guides the user through: Select files → Scanning → Importing → Complete.
 *
 * @module views/DataManagement/ImportWizard
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Badge } from '@/components/ui';
import { useImport } from '@/hooks/useImport';
import type { ImportProgress, ImportError } from '@/services/import/types';
import styles from './ImportWizard.module.css';

type WizardStep = 'select' | 'scanning' | 'importing' | 'complete';

/** Check whether the File System Access API showDirectoryPicker is available. */
function hasDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export default function ImportWizard() {
  const navigate = useNavigate();
  const { startFileImport, startDirectoryImport, progress, result, error, reset } = useImport();
  const [step, setStep] = useState<WizardStep>('select');
  const [dragOver, setDragOver] = useState(false);
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync wizard step from progress status
  useEffect(() => {
    if (progress.status === 'scanning') {
      setStep('scanning');
    } else if (
      progress.status === 'parsing' ||
      progress.status === 'building' ||
      progress.status === 'storing'
    ) {
      setStep('importing');
    } else if (progress.status === 'complete') {
      setStep('complete');
    } else if (progress.status === 'error') {
      setStep('complete');
    }
  }, [progress.status]);

  // ── File Selection Handlers ──

  const handleBrowseFolder = useCallback(async () => {
    if (hasDirectoryPicker()) {
      try {
        const handle = await (
          window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
        ).showDirectoryPicker();
        await startDirectoryImport(handle);
      } catch (err) {
        // User cancelled the picker — not an error
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // Browser-level errors (e.g., SecurityError) — log but don't crash
        // eslint-disable-next-line no-console
        console.error('Failed to open directory picker:', err);
      }
    } else {
      // Fallback to directory input
      fileInputRef.current?.click();
    }
  }, [startDirectoryImport]);

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        await startFileImport(Array.from(files));
      }
    },
    [startFileImport],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);

      const items = e.dataTransfer.items;
      if (!items || items.length === 0) return;

      // Try to get a directory handle from the first item
      const firstItem = items[0];
      if (firstItem && 'getAsFileSystemHandle' in firstItem) {
        try {
          const handle = await (
            firstItem as DataTransferItem & {
              getAsFileSystemHandle: () => Promise<FileSystemHandle>;
            }
          ).getAsFileSystemHandle();
          if (handle && handle.kind === 'directory') {
            await startDirectoryImport(handle as FileSystemDirectoryHandle);
            return;
          }
        } catch {
          // Fall through to file-based import
        }
      }

      // Fall back to file list
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        await startFileImport(files);
      }
    },
    [startFileImport, startDirectoryImport],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleReset = useCallback(() => {
    reset();
    setStep('select');
    setErrorsExpanded(false);
  }, [reset]);

  const handleViewDashboard = useCallback(() => {
    void navigate('/');
  }, [navigate]);

  return (
    <div className={styles.wizard}>
      <div className={styles.header}>
        <h1 className={styles.title}>Import Data</h1>
        <StepIndicator currentStep={step} />
      </div>

      <div className={styles.content}>
        {step === 'select' && (
          <SelectStep
            dragOver={dragOver}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onBrowse={handleBrowseFolder}
            fileInputRef={fileInputRef}
            onFileInput={handleFileInput}
          />
        )}

        {step === 'scanning' && <ScanningStep progress={progress} />}

        {step === 'importing' && <ImportingStep progress={progress} />}

        {step === 'complete' && (
          <CompleteStep
            progress={progress}
            result={result}
            error={error}
            errorsExpanded={errorsExpanded}
            onToggleErrors={() => setErrorsExpanded((v) => !v)}
            onViewDashboard={handleViewDashboard}
            onImportMore={handleReset}
          />
        )}
      </div>
    </div>
  );
}

// ── Step Indicator ──

function StepIndicator({ currentStep }: { currentStep: WizardStep }) {
  const steps: { key: WizardStep; label: string }[] = [
    { key: 'select', label: 'Select' },
    { key: 'scanning', label: 'Scan' },
    { key: 'importing', label: 'Import' },
    { key: 'complete', label: 'Complete' },
  ];

  const currentIndex = steps.findIndex((s) => s.key === currentStep);

  return (
    <nav className={styles.stepIndicator} aria-label="Import progress steps">
      <ol className={styles.stepList}>
        {steps.map((s, i) => (
          <li
            key={s.key}
            className={`${styles.step} ${i === currentIndex ? styles.stepActive : ''} ${i < currentIndex ? styles.stepDone : ''}`}
            aria-current={i === currentIndex ? 'step' : undefined}
          >
            <span className={styles.stepNumber}>{i + 1}</span>
            <span className={styles.stepLabel}>{s.label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ── Select Step ──

interface SelectStepProps {
  dragOver: boolean;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onBrowse: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function SelectStep({
  dragOver,
  onDrop,
  onDragOver,
  onDragLeave,
  onBrowse,
  fileInputRef,
  onFileInput,
}: SelectStepProps) {
  return (
    <Card className={styles.selectCard}>
      <div
        className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ''}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        role="button"
        tabIndex={0}
        aria-label="Drop files here or click to browse"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onBrowse();
          }
        }}
      >
        <span className={styles.dropIcon} aria-hidden="true">
          📂
        </span>
        <p className={styles.dropTitle}>Drop your SD card folder here</p>
        <p className={styles.dropDescription}>
          Drag your CPAP machine&apos;s SD card folder, or click below to browse.
        </p>
        <Button variant="secondary" onClick={onBrowse} type="button">
          Browse Folders
        </Button>
      </div>

      {/* Hidden file input for fallback */}
      <input
        ref={fileInputRef}
        type="file"
        className={styles.hiddenInput}
        onChange={onFileInput}
        multiple
        {...({ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className={styles.supportedFormats}>
        <p className={styles.formatTitle}>Supported machines:</p>
        <ul className={styles.formatList}>
          <li>ResMed AirSense 10 / AirSense 11</li>
          <li>EDF+ data format from SD card DATALOG folder</li>
        </ul>
      </div>
    </Card>
  );
}

// ── Scanning Step ──

function ScanningStep({ progress }: { progress: ImportProgress }) {
  return (
    <Card className={styles.progressCard}>
      <div className={styles.progressContent}>
        <span className={styles.progressIcon} aria-hidden="true">
          🔍
        </span>
        <h2 className={styles.progressTitle}>Scanning files…</h2>
        <p className={styles.progressDescription}>Discovering EDF files in the selected folder.</p>
        <div className={styles.statsRow} aria-live="polite">
          <span>{progress.totalFiles} files found</span>
        </div>
        <div className={styles.progressBarWrapper}>
          <div
            className={styles.progressBar}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={0}
            aria-label="Scanning files"
          >
            <div
              className={`${styles.progressFill} ${styles.progressFillFull} ${styles.progressIndeterminate}`}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Importing Step ──

function ImportingStep({ progress }: { progress: ImportProgress }) {
  const percent =
    progress.totalFiles > 0 ? Math.round((progress.filesProcessed / progress.totalFiles) * 100) : 0;

  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fillRef.current) {
      fillRef.current.style.width = `${percent}%`;
    }
  }, [percent]);

  return (
    <Card className={styles.progressCard}>
      <div className={styles.progressContent}>
        <h2 className={styles.progressTitle}>Importing data…</h2>
        <div className={styles.progressBarWrapper}>
          <div
            className={styles.progressBar}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={`Import progress: ${percent}%`}
          >
            <div ref={fillRef} className={styles.progressFill} />
          </div>
        </div>
        <div className={styles.statsRow} aria-live="polite">
          <span>
            {progress.filesProcessed} / {progress.totalFiles} files
          </span>
          <span>{percent}%</span>
        </div>
        {progress.currentFileName && (
          <p className={styles.currentFile} aria-live="polite">
            Processing: <code>{progress.currentFileName}</code>
          </p>
        )}
        <div className={styles.statsRow}>
          <span>{progress.sessionsCreated} sessions created</span>
          {progress.warnings.length > 0 && (
            <Badge variant="warning" size="sm">
              {progress.warnings.length} warnings
            </Badge>
          )}
          {progress.errors.length > 0 && (
            <Badge variant="danger" size="sm">
              {progress.errors.length} errors
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Complete Step ──

interface CompleteStepProps {
  progress: ImportProgress;
  result: { sessionsImported: number; sessionsSkipped: number; errors: unknown[] } | null;
  error: string | null;
  errorsExpanded: boolean;
  onToggleErrors: () => void;
  onViewDashboard: () => void;
  onImportMore: () => void;
}

function CompleteStep({
  progress,
  result,
  error,
  errorsExpanded,
  onToggleErrors,
  onViewDashboard,
  onImportMore,
}: CompleteStepProps) {
  const hasErrors = progress.errors.length > 0 || error;
  const isFullError = error && !result;

  return (
    <Card className={styles.completeCard}>
      <div className={styles.completeContent}>
        {isFullError ? (
          <>
            <span className={styles.completeIcon} aria-hidden="true">
              ❌
            </span>
            <h2 className={styles.completeTitle}>Import Failed</h2>
            <p className={styles.errorMessage}>{error}</p>
          </>
        ) : (
          <>
            <span className={styles.completeIcon} aria-hidden="true">
              ✅
            </span>
            <h2 className={styles.completeTitle}>Import Complete</h2>
          </>
        )}

        {result && (
          <div className={styles.summaryGrid}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryValue}>{result.sessionsImported}</span>
              <span className={styles.summaryLabel}>Sessions imported</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryValue}>{result.sessionsSkipped}</span>
              <span className={styles.summaryLabel}>Skipped (duplicates)</span>
            </div>
            {progress.warnings.length > 0 && (
              <div className={styles.summaryItem}>
                <span className={styles.summaryValue}>{progress.warnings.length}</span>
                <span className={styles.summaryLabel}>Warnings</span>
              </div>
            )}
            {progress.errors.length > 0 && (
              <div className={styles.summaryItem}>
                <span className={styles.summaryValue}>{progress.errors.length}</span>
                <span className={styles.summaryLabel}>Errors</span>
              </div>
            )}
          </div>
        )}

        {hasErrors && progress.errors.length > 0 && (
          <div className={styles.errorsSection}>
            <button
              className={styles.errorsToggle}
              onClick={onToggleErrors}
              aria-expanded={errorsExpanded ? 'true' : 'false'}
            >
              {errorsExpanded ? '▾' : '▸'} {progress.errors.length} file errors
            </button>
            {errorsExpanded && (
              <ul className={styles.errorsList}>
                {progress.errors.map((err: ImportError, i: number) => (
                  <li key={i} className={styles.errorItem}>
                    <code className={styles.errorFileName}>{err.fileName}</code>
                    <span className={styles.errorText}>{err.error}</span>
                    {err.recoverable && (
                      <Badge variant="warning" size="sm">
                        recoverable
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className={styles.completeActions}>
          {!isFullError && (
            <Button variant="primary" onClick={onViewDashboard}>
              View Dashboard
            </Button>
          )}
          <Button variant="secondary" onClick={onImportMore}>
            {isFullError ? 'Try Again' : 'Import More'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
