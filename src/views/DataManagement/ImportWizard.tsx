/**
 * Multi-step import wizard.
 *
 * Guides the user through data import from two sources:
 * - CPAP SD Card: Select files -> Scanning -> Importing -> Complete
 * - Google Health: Select source -> Preview (scan + choose data types) -> Importing -> Complete
 *
 * @module views/DataManagement/ImportWizard
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Badge } from '@/components/ui';
import { useImport } from '@/hooks/useImport';
import { useGoogleHealthImport } from '@/hooks/useGoogleHealthImport';
import type { ImportProgress, ImportError } from '@/services/import/types';
import type { GoogleHealthImportProgress } from '@/services/import/types';
import type { GoogleHealthScanResult, GoogleHealthDataTypeInfo } from '@/types/fitbit';
import { FITBIT_DATA_TIERS } from '@/types/fitbit';
import type { IntegrationImportRecord } from '@/types/storage';
import styles from './ImportWizard.module.css';

type WizardStep = 'select' | 'preview' | 'scanning' | 'importing' | 'complete';

/** The active import source the user chose. */
type ImportSource = 'cpap' | 'google-health' | null;

/** Check whether the File System Access API showDirectoryPicker is available. */
function hasDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** Format bytes into a human-readable string (KB, MB, GB). */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const value = bytes / Math.pow(k, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/** Format an ISO date string to a short locale date. */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function ImportWizard() {
  const navigate = useNavigate();

  // CPAP import hook
  const {
    startFileImport,
    startDirectoryImport,
    progress: cpapProgress,
    result: cpapResult,
    error: cpapError,
    reset: cpapReset,
  } = useImport();

  // Google Health import hook
  const {
    scan: ghScan,
    startImport: ghStartImport,
    scanResult: ghScanResult,
    progress: ghProgress,
    isActive: ghIsActive,
    result: ghResult,
    error: ghError,
    reset: ghReset,
  } = useGoogleHealthImport();

  const [step, setStep] = useState<WizardStep>('select');
  const [source, setSource] = useState<ImportSource>(null);
  const [dragOver, setDragOver] = useState(false);
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [ghScanning, setGhScanning] = useState(false);
  const [ghScanError, setGhScanError] = useState<string | null>(null);
  const [ghDirHandle, setGhDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [ghSelectedTypes, setGhSelectedTypes] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize selected types when scan completes
  useEffect(() => {
    if (ghScanResult) {
      setGhSelectedTypes(new Set(ghScanResult.dataTypes.map((dt) => dt.dataType)));
    }
  }, [ghScanResult]);

  // Sync wizard step from CPAP progress status
  useEffect(() => {
    if (source !== 'cpap') return;

    if (cpapProgress.status === 'scanning') {
      setStep('scanning');
    } else if (
      cpapProgress.status === 'parsing' ||
      cpapProgress.status === 'building' ||
      cpapProgress.status === 'storing'
    ) {
      setStep('importing');
    } else if (cpapProgress.status === 'complete' || cpapProgress.status === 'error') {
      setStep('complete');
    }
  }, [cpapProgress.status, source]);

  // Sync wizard step from Google Health progress status
  useEffect(() => {
    if (source !== 'google-health' || !ghProgress) return;

    if (
      ghProgress.status === 'parsing' ||
      ghProgress.status === 'storing' ||
      ghProgress.status === 'scanning'
    ) {
      setStep('importing');
    } else if (ghProgress.status === 'complete' || ghProgress.status === 'error') {
      setStep('complete');
    }
  }, [ghProgress, source]);

  // Also transition to complete if ghResult or ghError arrive
  useEffect(() => {
    if (source !== 'google-health') return;
    if (ghResult || ghError) {
      setStep('complete');
    }
  }, [ghResult, ghError, source]);

  // ── CPAP File Selection Handlers ──

  const handleBrowseFolder = useCallback(async () => {
    setSource('cpap');
    if (hasDirectoryPicker()) {
      try {
        const handle = await (
          window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
        ).showDirectoryPicker();
        await startDirectoryImport(handle);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setSource(null);
          return;
        }
        // eslint-disable-next-line no-console
        console.error('Failed to open directory picker:', err);
        setSource(null);
      }
    } else {
      fileInputRef.current?.click();
    }
  }, [startDirectoryImport]);

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        setSource('cpap');
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

      setSource('cpap');

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

  // ── Google Health Handlers ──

  const handleGoogleHealthSelect = useCallback(async () => {
    if (!hasDirectoryPicker()) return;

    try {
      const handle = await (
        window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
      ).showDirectoryPicker();

      setSource('google-health');
      setGhDirHandle(handle);
      setGhScanning(true);
      setGhScanError(null);
      setStep('preview');

      try {
        await ghScan(handle);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to scan directory';
        setGhScanError(msg);
      } finally {
        setGhScanning(false);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // eslint-disable-next-line no-console
      console.error('Failed to open directory picker:', err);
    }
  }, [ghScan]);

  const handleGhToggleType = useCallback((dataType: string) => {
    setGhSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(dataType)) {
        next.delete(dataType);
      } else {
        next.add(dataType);
      }
      return next;
    });
  }, []);

  const handleGhImport = useCallback(async () => {
    if (!ghDirHandle || !ghScanResult) return;
    await ghStartImport(ghDirHandle, ghScanResult, Array.from(ghSelectedTypes));
  }, [ghDirHandle, ghScanResult, ghSelectedTypes, ghStartImport]);

  // ── Common Handlers ──

  const handleReset = useCallback(() => {
    cpapReset();
    ghReset();
    setStep('select');
    setSource(null);
    setErrorsExpanded(false);
    setGhScanning(false);
    setGhScanError(null);
    setGhDirHandle(null);
    setGhSelectedTypes(new Set());
  }, [cpapReset, ghReset]);

  const handleViewDashboard = useCallback(() => {
    void navigate('/');
  }, [navigate]);

  const handleExploreCorrelations = useCallback(() => {
    void navigate('/analysis/integrations');
  }, [navigate]);

  // Determine which steps to show based on source
  const stepConfig = useMemo(() => {
    if (source === 'google-health') {
      return [
        { key: 'select' as WizardStep, label: 'Source' },
        { key: 'preview' as WizardStep, label: 'Preview' },
        { key: 'importing' as WizardStep, label: 'Import' },
        { key: 'complete' as WizardStep, label: 'Complete' },
      ];
    }
    return [
      { key: 'select' as WizardStep, label: 'Select' },
      { key: 'scanning' as WizardStep, label: 'Scan' },
      { key: 'importing' as WizardStep, label: 'Import' },
      { key: 'complete' as WizardStep, label: 'Complete' },
    ];
  }, [source]);

  return (
    <div className={styles.wizard}>
      <div className={styles.header}>
        <h1 className={styles.title}>Import Data</h1>
        <StepIndicator currentStep={step} steps={stepConfig} />
      </div>

      <div className={styles.content}>
        {step === 'select' && (
          <SourceSelectStep
            dragOver={dragOver}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onBrowseCpap={handleBrowseFolder}
            onSelectGoogleHealth={handleGoogleHealthSelect}
            fileInputRef={fileInputRef}
            onFileInput={handleFileInput}
          />
        )}

        {step === 'preview' && source === 'google-health' && (
          <GoogleHealthPreviewStep
            scanning={ghScanning}
            scanError={ghScanError}
            scanResult={ghScanResult}
            selectedTypes={ghSelectedTypes}
            onToggleType={handleGhToggleType}
            onImport={handleGhImport}
            onCancel={handleReset}
            isImporting={ghIsActive}
          />
        )}

        {step === 'scanning' && source === 'cpap' && <ScanningStep progress={cpapProgress} />}

        {step === 'importing' && source === 'cpap' && <CpapImportingStep progress={cpapProgress} />}

        {step === 'importing' && source === 'google-health' && ghProgress && (
          <GoogleHealthImportingStep progress={ghProgress} />
        )}

        {step === 'complete' && source === 'cpap' && (
          <CpapCompleteStep
            progress={cpapProgress}
            result={cpapResult}
            error={cpapError}
            errorsExpanded={errorsExpanded}
            onToggleErrors={() => setErrorsExpanded((v) => !v)}
            onViewDashboard={handleViewDashboard}
            onImportMore={handleReset}
          />
        )}

        {step === 'complete' && source === 'google-health' && (
          <GoogleHealthCompleteStep
            progress={ghProgress}
            result={ghResult}
            error={ghError}
            onViewDashboard={handleViewDashboard}
            onExploreCorrelations={handleExploreCorrelations}
            onImportMore={handleReset}
          />
        )}
      </div>
    </div>
  );
}

// ── Step Indicator ──

interface StepIndicatorProps {
  currentStep: WizardStep;
  steps: { key: WizardStep; label: string }[];
}

function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
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

// ── Source Select Step ──

interface SourceSelectStepProps {
  dragOver: boolean;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onBrowseCpap: () => void;
  onSelectGoogleHealth: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function SourceSelectStep({
  dragOver,
  onDrop,
  onDragOver,
  onDragLeave,
  onBrowseCpap,
  onSelectGoogleHealth,
  fileInputRef,
  onFileInput,
}: SourceSelectStepProps) {
  const directoryPickerAvailable = hasDirectoryPicker();

  return (
    <Card className={styles.selectCard}>
      <div className={styles.sourceSelectGrid}>
        {/* CPAP SD Card source */}
        <div
          className={`${styles.sourceCard} ${dragOver ? styles.dropZoneActive : ''}`}
          role="button"
          tabIndex={0}
          aria-label="Import from CPAP SD card"
          onClick={onBrowseCpap}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onBrowseCpap();
            }
          }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          <span className={styles.sourceCardIcon} aria-hidden="true">
            💾
          </span>
          <p className={styles.sourceCardTitle}>CPAP SD Card</p>
          <p className={styles.sourceCardDescription}>
            Import from your ResMed CPAP machine&apos;s SD card
          </p>
          <p className={styles.sourceCardFormat}>EDF+ data format</p>
        </div>

        {/* Google Health (Fitbit) source */}
        <div
          className={styles.sourceCard}
          role="button"
          tabIndex={directoryPickerAvailable ? 0 : -1}
          aria-label="Import from Google Health (Fitbit)"
          aria-disabled={!directoryPickerAvailable}
          onClick={directoryPickerAvailable ? onSelectGoogleHealth : undefined}
          onKeyDown={(e) => {
            if (directoryPickerAvailable && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              onSelectGoogleHealth();
            }
          }}
          style={!directoryPickerAvailable ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        >
          <span className={styles.sourceCardIcon} aria-hidden="true">
            ❤️
          </span>
          <p className={styles.sourceCardTitle}>Google Health (Fitbit)</p>
          <p className={styles.sourceCardDescription}>
            Import sleep, heart rate, SpO&#x2082;, and activity data from your Google Health
            (Fitbit) export
          </p>
          <p className={styles.sourceCardFormat}>Google Takeout format</p>
          {!directoryPickerAvailable && (
            <p className={styles.sourceCardFormat}>
              Requires a browser that supports the File System Access API
            </p>
          )}
        </div>
      </div>

      {/* Hidden file input for CPAP fallback */}
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
        <p className={styles.formatTitle}>Supported sources:</p>
        <ul className={styles.formatList}>
          <li>ResMed AirSense 10 / AirSense 11 (EDF+ from SD card DATALOG folder)</li>
          <li>Google Health / Fitbit (Google Takeout export)</li>
        </ul>
      </div>
    </Card>
  );
}

// ── Google Health Preview Step ──

interface GoogleHealthPreviewStepProps {
  scanning: boolean;
  scanError: string | null;
  scanResult: GoogleHealthScanResult | null;
  selectedTypes: Set<string>;
  onToggleType: (dataType: string) => void;
  onImport: () => void;
  onCancel: () => void;
  isImporting: boolean;
}

function GoogleHealthPreviewStep({
  scanning,
  scanError,
  scanResult,
  selectedTypes,
  onToggleType,
  onImport,
  onCancel,
  isImporting,
}: GoogleHealthPreviewStepProps) {
  // Group data types by tier
  const tierGroups = useMemo(() => {
    if (!scanResult) return [];

    const grouped = new Map<1 | 2 | 3 | 4, GoogleHealthDataTypeInfo[]>();
    for (const dt of scanResult.dataTypes) {
      const existing = grouped.get(dt.tier) ?? [];
      existing.push(dt);
      grouped.set(dt.tier, existing);
    }

    // Return sorted by tier number
    return Array.from(grouped.entries()).sort(([a], [b]) => a - b);
  }, [scanResult]);

  const selectedCount = selectedTypes.size;
  const totalRecords = useMemo(() => {
    if (!scanResult) return 0;
    return scanResult.dataTypes
      .filter((dt) => selectedTypes.has(dt.dataType))
      .reduce((sum, dt) => sum + dt.recordCount, 0);
  }, [scanResult, selectedTypes]);

  if (scanning) {
    return (
      <Card className={styles.previewCard}>
        <div className={styles.scanningOverlay}>
          <span className={styles.progressIcon} aria-hidden="true">
            🔍
          </span>
          <p className={styles.scanningOverlayTitle}>Scanning Google Health data...</p>
          <p className={styles.scanningOverlayDescription}>
            Discovering available data types in the selected folder.
          </p>
          <div className={styles.progressBarWrapper}>
            <div
              className={styles.progressBar}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={0}
              aria-label="Scanning Google Health data"
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

  if (scanError) {
    return (
      <Card className={styles.previewCard}>
        <div className={styles.scanningOverlay}>
          <span className={styles.progressIcon} aria-hidden="true">
            ❌
          </span>
          <p className={styles.scanningOverlayTitle}>Scan Failed</p>
          <p className={styles.errorMessage}>{scanError}</p>
          <Button variant="secondary" onClick={onCancel}>
            Go Back
          </Button>
        </div>
      </Card>
    );
  }

  if (!scanResult || scanResult.dataTypes.length === 0) {
    return (
      <Card className={styles.previewCard}>
        <div className={styles.scanningOverlay}>
          <span className={styles.progressIcon} aria-hidden="true">
            📭
          </span>
          <p className={styles.scanningOverlayTitle}>No Data Found</p>
          <p className={styles.scanningOverlayDescription}>
            No recognized Google Health / Fitbit data was found in the selected folder. Make sure
            you selected the &quot;Fitbit&quot; folder from your Google Takeout export.
          </p>
          <Button variant="secondary" onClick={onCancel}>
            Go Back
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className={styles.previewCard}>
      <div className={styles.previewHeader}>
        <h2 className={styles.previewTitle}>Review Data</h2>
        {scanResult.deviceInfo && (
          <Badge variant="info" size="sm">
            {scanResult.deviceInfo}
          </Badge>
        )}
      </div>

      {/* Summary bar */}
      <div className={styles.previewSummaryBar} aria-label="Data summary">
        <span className={styles.previewSummaryStat}>
          <span className={styles.previewSummaryStatValue}>{scanResult.totalFileCount}</span>
          &nbsp;files
        </span>
        <span className={styles.previewSummaryStat}>
          <span className={styles.previewSummaryStatValue}>
            {formatBytes(scanResult.estimatedSizeBytes)}
          </span>
        </span>
        {scanResult.dateRange && (
          <span className={styles.previewSummaryStat}>
            {formatDate(scanResult.dateRange.start)} &ndash; {formatDate(scanResult.dateRange.end)}
          </span>
        )}
      </div>

      {/* Tier groups */}
      {tierGroups.map(([tier, dataTypes]) => (
        <div
          key={tier}
          className={styles.previewTierGroup}
          role="group"
          aria-label={FITBIT_DATA_TIERS[tier]}
        >
          <h3 className={styles.previewTierHeader}>{FITBIT_DATA_TIERS[tier]}</h3>
          <div className={styles.previewDataTypeList}>
            {dataTypes.map((dt) => {
              const checkboxId = `gh-type-${dt.dataType}`;
              return (
                <label key={dt.dataType} htmlFor={checkboxId} className={styles.previewDataTypeRow}>
                  <input
                    id={checkboxId}
                    type="checkbox"
                    className={styles.previewCheckbox}
                    checked={selectedTypes.has(dt.dataType)}
                    onChange={() => onToggleType(dt.dataType)}
                    aria-label={`Include ${dt.label}`}
                  />
                  <span className={styles.previewDataTypeLabel}>{dt.label}</span>
                  <span className={styles.previewDataTypeMeta}>
                    <span>{dt.recordCount.toLocaleString()} records</span>
                    {dt.dateRange && (
                      <span>
                        {formatDate(dt.dateRange.start)} &ndash; {formatDate(dt.dateRange.end)}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {/* Actions */}
      <div className={styles.previewActions}>
        <span className={styles.previewSummaryStat}>
          {selectedCount} data types selected &middot; {totalRecords.toLocaleString()} records
        </span>
        <Button variant="secondary" onClick={onCancel} disabled={isImporting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={onImport}
          disabled={selectedCount === 0 || isImporting}
          aria-label={`Import ${selectedCount} selected data types`}
        >
          Import Selected
        </Button>
      </div>
    </Card>
  );
}

// ── Scanning Step (CPAP) ──

function ScanningStep({ progress }: { progress: ImportProgress }) {
  return (
    <Card className={styles.progressCard}>
      <div className={styles.progressContent}>
        <span className={styles.progressIcon} aria-hidden="true">
          🔍
        </span>
        <h2 className={styles.progressTitle}>Scanning files...</h2>
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

// ── CPAP Importing Step ──

function CpapImportingStep({ progress }: { progress: ImportProgress }) {
  let percent = 0;
  let stageLabel = '';

  if (progress.status === 'parsing') {
    percent =
      progress.totalFiles > 0
        ? Math.round((progress.filesProcessed / progress.totalFiles) * 100)
        : 0;
    stageLabel = `Parsing files: ${progress.filesProcessed} of ${progress.totalFiles}`;
  } else if (progress.status === 'building') {
    percent =
      progress.totalDayGroups > 0
        ? Math.round((progress.dayGroupsProcessed / progress.totalDayGroups) * 100)
        : 0;
    stageLabel = `Building sessions: day ${progress.dayGroupsProcessed} of ${progress.totalDayGroups}`;
  } else if (progress.status === 'storing') {
    percent =
      progress.totalSessionsToStore > 0
        ? Math.round((progress.sessionsStored / progress.totalSessionsToStore) * 100)
        : 0;
    stageLabel = `Storing sessions: ${progress.sessionsStored} of ${progress.totalSessionsToStore}`;
  }

  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fillRef.current) {
      fillRef.current.style.width = `${percent}%`;
    }
  }, [percent]);

  return (
    <Card className={styles.progressCard}>
      <div className={styles.progressContent}>
        <h2 className={styles.progressTitle}>Importing data...</h2>
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
          <span>{stageLabel}</span>
          <span>{percent}%</span>
        </div>
        {progress.currentStage && (
          <p className={styles.currentFile} aria-live="polite">
            {progress.currentStage}
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

// ── Google Health Importing Step ──

function GoogleHealthImportingStep({ progress }: { progress: GoogleHealthImportProgress }) {
  const percent =
    progress.dataTypesTotal > 0
      ? Math.round((progress.dataTypesProcessed / progress.dataTypesTotal) * 100)
      : 0;

  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fillRef.current) {
      fillRef.current.style.width = `${percent}%`;
    }
  }, [percent]);

  const stageLabel =
    progress.dataTypesTotal > 0
      ? `Data types: ${progress.dataTypesProcessed} of ${progress.dataTypesTotal}`
      : 'Preparing...';

  return (
    <Card className={styles.progressCard}>
      <div className={styles.progressContent}>
        <h2 className={styles.progressTitle}>Importing Google Health data...</h2>
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
          <span>{stageLabel}</span>
          <span>{percent}%</span>
        </div>
        {progress.currentDataType && (
          <p className={styles.currentFile} aria-live="polite">
            Processing: {progress.currentDataType}
          </p>
        )}
        <div className={styles.statsRow}>
          <span>{progress.recordsProcessed.toLocaleString()} records processed</span>
          {progress.recordsSkipped > 0 && (
            <Badge variant="info" size="sm">
              {progress.recordsSkipped.toLocaleString()} skipped (dedup)
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

// ── CPAP Complete Step ──

interface CpapCompleteStepProps {
  progress: ImportProgress;
  result: { sessionsImported: number; sessionsSkipped: number; errors: unknown[] } | null;
  error: string | null;
  errorsExpanded: boolean;
  onToggleErrors: () => void;
  onViewDashboard: () => void;
  onImportMore: () => void;
}

function CpapCompleteStep({
  progress,
  result,
  error,
  errorsExpanded,
  onToggleErrors,
  onViewDashboard,
  onImportMore,
}: CpapCompleteStepProps) {
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
            {progress.filesSkippedEmpty > 0 && (
              <div className={styles.summaryItem}>
                <span className={styles.summaryValue}>{progress.filesSkippedEmpty}</span>
                <span className={styles.summaryLabel}>Empty files skipped</span>
              </div>
            )}
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

// ── Google Health Complete Step ──

interface GoogleHealthCompleteStepProps {
  progress: GoogleHealthImportProgress | null;
  result: IntegrationImportRecord | null;
  error: string | null;
  onViewDashboard: () => void;
  onExploreCorrelations: () => void;
  onImportMore: () => void;
}

function GoogleHealthCompleteStep({
  progress,
  result,
  error,
  onViewDashboard,
  onExploreCorrelations,
  onImportMore,
}: GoogleHealthCompleteStepProps) {
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
              <span className={styles.summaryValue}>{result.recordsImported.toLocaleString()}</span>
              <span className={styles.summaryLabel}>Records imported</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryValue}>{result.recordsSkipped.toLocaleString()}</span>
              <span className={styles.summaryLabel}>Skipped (duplicates)</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryValue}>{result.dataTypes.length}</span>
              <span className={styles.summaryLabel}>Data types imported</span>
            </div>
            {result.errors.length > 0 && (
              <div className={styles.summaryItem}>
                <span className={styles.summaryValue}>{result.errors.length}</span>
                <span className={styles.summaryLabel}>Errors</span>
              </div>
            )}
          </div>
        )}

        {progress && progress.warnings.length > 0 && (
          <div className={styles.errorsSection}>
            <p className={styles.currentFile}>
              {progress.warnings.length} warning{progress.warnings.length !== 1 ? 's' : ''} during
              import
            </p>
          </div>
        )}

        <div className={styles.completeActions}>
          {!isFullError && (
            <>
              <Button variant="primary" onClick={onExploreCorrelations}>
                Explore Correlations
              </Button>
              <Button variant="secondary" onClick={onViewDashboard}>
                View Dashboard
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={onImportMore}>
            {isFullError ? 'Try Again' : 'Import More'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
