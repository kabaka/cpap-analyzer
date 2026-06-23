/**
 * Multi-step import wizard.
 *
 * Guides the user through data import from two sources:
 * - CPAP SD Card: Select files -> Scanning/Importing (stage list) -> Complete
 * - Google Health: Select source -> Preview (scan + choose data types) ->
 *   Importing (stage list) -> Complete
 *
 * Since the import-redesign the live progress is driven by the unified, global
 * {@link ImportJobProgress} held in {@link useImportStore} (the controller is the
 * single writer). That means:
 * - The importing/complete views render {@link ImportStageList} /
 *   {@link ImportSummary} from the active job — and the SAME job is mirrored in
 *   the persistent {@link ImportStatusDock}.
 * - On mount, an import already running in the background (started elsewhere and
 *   navigated back to) is reflected immediately; a terminal-but-undismissed job
 *   shows its summary.
 * - Starting a second import of the same kind while one runs is rejected by the
 *   controller; we surface that rather than dropping it silently.
 *
 * @module views/DataManagement/ImportWizard
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from 'zustand';

import { Button, Card, Badge, Icon } from '@/components/ui';
import { ImportStageList, ImportSummary, type SummaryStat } from '@/components/import';
import { useImport } from '@/hooks/useImport';
import { useGoogleHealthImport } from '@/hooks/useGoogleHealthImport';
import { importController } from '@/services/import/ImportController';
import { useImportStore, selectLatestJobOfKind } from '@/stores/useImportStore';
import type { ImportJobProgress } from '@/services/import/types';
import type { GoogleHealthScanResult, GoogleHealthDataTypeInfo } from '@/types/fitbit';
import { FITBIT_DATA_TIERS } from '@/types/fitbit';
import type { ImportRecord, IntegrationImportRecord } from '@/types/storage';
import styles from './ImportWizard.module.css';

type WizardStep = 'select' | 'preview' | 'importing' | 'complete';

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

/** Whether a job status is terminal (complete / error / cancelled). */
function isTerminalStatus(status: ImportJobProgress['status']): boolean {
  return status === 'complete' || status === 'error' || status === 'cancelled';
}

export default function ImportWizard() {
  const navigate = useNavigate();

  // CPAP import hook
  const {
    startFileImport,
    startDirectoryImport,
    result: cpapResult,
    error: cpapError,
    reset: cpapReset,
  } = useImport();

  // Google Health import hook
  const {
    scan: ghScan,
    startImport: ghStartImport,
    scanResult: ghScanResult,
    isActive: ghIsActive,
    result: ghResult,
    error: ghError,
    reset: ghReset,
  } = useGoogleHealthImport();

  // Unified, global job progress (the single source of truth driving the views
  // AND the persistent dock). Selecting by kind keeps the wizard in sync with a
  // job started in the background.
  const cpapEntry = useStore(useImportStore, (s) => selectLatestJobOfKind(s, 'cpap'));
  const fitbitEntry = useStore(useImportStore, (s) => selectLatestJobOfKind(s, 'fitbit'));

  const [step, setStep] = useState<WizardStep>('select');
  const [source, setSource] = useState<ImportSource>(null);
  const [dragOver, setDragOver] = useState(false);
  const [ghScanning, setGhScanning] = useState(false);
  const [ghScanError, setGhScanError] = useState<string | null>(null);
  const [ghDirHandle, setGhDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [ghSelectedTypes, setGhSelectedTypes] = useState<Set<string>>(new Set());
  const [busyNotice, setBusyNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The job progress relevant to the chosen source.
  const activeJobProgress: ImportJobProgress | null = useMemo(() => {
    if (source === 'cpap') return cpapEntry?.progress ?? null;
    if (source === 'google-health') return fitbitEntry?.progress ?? null;
    return null;
  }, [source, cpapEntry, fitbitEntry]);

  // On first mount, if a job of either kind is already active or terminal but
  // not yet dismissed, adopt its source and jump to the right step. Runs once.
  const adoptedRef = useRef(false);
  useEffect(() => {
    if (adoptedRef.current) return;
    adoptedRef.current = true;
    const cpap = cpapEntry?.progress;
    const fitbit = fitbitEntry?.progress;
    const cpapLive =
      cpap &&
      (cpap.status === 'scanning' || cpap.status === 'running' || isTerminalStatus(cpap.status));
    const fitbitLive =
      fitbit &&
      (fitbit.status === 'scanning' ||
        fitbit.status === 'running' ||
        isTerminalStatus(fitbit.status));
    // Prefer the freshest live job.
    const pick =
      cpapLive && fitbitLive
        ? cpap.startedAtMs >= fitbit.startedAtMs
          ? 'cpap'
          : 'google-health'
        : cpapLive
          ? 'cpap'
          : fitbitLive
            ? 'google-health'
            : null;
    if (!pick) return;
    const progress = pick === 'cpap' ? cpap : fitbit;
    if (!progress) return;
    setSource(pick);
    setStep(isTerminalStatus(progress.status) ? 'complete' : 'importing');
  }, [cpapEntry, fitbitEntry]);

  // Initialize selected types when scan completes
  useEffect(() => {
    if (ghScanResult) {
      setGhSelectedTypes(new Set(ghScanResult.dataTypes.map((dt) => dt.dataType)));
    }
  }, [ghScanResult]);

  // Sync wizard step from the unified job status for the chosen source.
  useEffect(() => {
    if (!activeJobProgress) return;
    const s = activeJobProgress.status;
    if (s === 'scanning' || s === 'running') {
      setStep('importing');
    } else if (isTerminalStatus(s)) {
      setStep('complete');
    }
  }, [activeJobProgress]);

  // ── CPAP File Selection Handlers ──

  const handleBrowseFolder = useCallback(async () => {
    setBusyNotice(null);
    if (importController.isActive('cpap')) {
      setSource('cpap');
      setBusyNotice('A CPAP import is already running. Showing its progress.');
      return;
    }
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
        if (importController.isActive('cpap')) {
          setSource('cpap');
          setBusyNotice('A CPAP import is already running. Showing its progress.');
          return;
        }
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

      if (importController.isActive('cpap')) {
        setSource('cpap');
        setBusyNotice('A CPAP import is already running. Showing its progress.');
        return;
      }

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
    setBusyNotice(null);

    if (importController.isActive('fitbit')) {
      setSource('google-health');
      setBusyNotice('A Fitbit import is already running. Showing its progress.');
      return;
    }

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
      setGhScanError('Failed to open directory picker.');
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
    setBusyNotice(null);
    setGhScanning(false);
    setGhScanError(null);
    setGhDirHandle(null);
    setGhSelectedTypes(new Set());
  }, [cpapReset, ghReset]);

  const handleViewDashboard = useCallback(() => {
    void navigate('/');
  }, [navigate]);

  const handleContinueInBackground = useCallback(() => {
    // The job keeps running on the controller; just leave the page. The dock
    // surfaces its progress everywhere.
    void navigate('/');
  }, [navigate]);

  const handleExploreCorrelations = useCallback(() => {
    void navigate('/explore/correlations?tab=cross-source');
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
            busyNotice={busyNotice}
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

        {step === 'importing' && activeJobProgress && (
          <JobImportingStep
            progress={activeJobProgress}
            onContinueInBackground={handleContinueInBackground}
          />
        )}

        {step === 'complete' && source === 'cpap' && activeJobProgress && (
          <CpapCompleteStep
            progress={activeJobProgress}
            result={cpapResult}
            error={cpapError}
            onViewDashboard={handleViewDashboard}
            onImportMore={handleReset}
          />
        )}

        {step === 'complete' && source === 'google-health' && activeJobProgress && (
          <GoogleHealthCompleteStep
            progress={activeJobProgress}
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
  busyNotice: string | null;
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
  busyNotice,
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
      {busyNotice && (
        <p className={styles.busyNotice} role="status">
          {busyNotice}
        </p>
      )}
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
          <Icon name="storage" size="lg" className={styles.sourceCardIcon} />
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
          <Icon name="data" size="lg" className={styles.sourceCardIcon} />
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
          <span className={styles.scanIcon} aria-hidden="true">
            <Icon name="spinner" size="lg" className={styles.scanSpinner} />
          </span>
          <p className={styles.scanningOverlayTitle}>Scanning Google Health data…</p>
          <p className={styles.scanningOverlayDescription}>
            Discovering available data types in the selected folder.
          </p>
        </div>
      </Card>
    );
  }

  if (scanError) {
    return (
      <Card className={styles.previewCard}>
        <div className={styles.scanningOverlay}>
          <span className={styles.scanIcon} style={{ color: 'var(--color-stage-error)' }}>
            <Icon name="x-circle" size="lg" title="Scan failed" />
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
          <span className={styles.scanIcon} style={{ color: 'var(--color-stage-pending)' }}>
            <Icon name="circle-dashed" size="lg" title="No data found" />
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

// ── Unified Importing Step (CPAP + Google Health) ──

interface JobImportingStepProps {
  progress: ImportJobProgress;
  onContinueInBackground: () => void;
}

function JobImportingStep({ progress, onContinueInBackground }: JobImportingStepProps) {
  const jobId = progress.jobId;
  const handleCancel = useCallback(() => {
    importController.cancel(jobId);
  }, [jobId]);

  return (
    <Card className={styles.progressCard}>
      <div className={styles.importingContent}>
        <h2 className={styles.progressTitle}>Importing data…</h2>
        <ImportStageList progress={progress} />
        <div className={styles.importingActions}>
          <Button variant="secondary" onClick={onContinueInBackground}>
            Continue in background
          </Button>
          <Button variant="danger" onClick={handleCancel}>
            Cancel import
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ── CPAP Complete Step ──

interface CpapCompleteStepProps {
  progress: ImportJobProgress;
  result: ImportRecord | null;
  error: string | null;
  onViewDashboard: () => void;
  onImportMore: () => void;
}

function CpapCompleteStep({
  progress,
  result,
  error,
  onViewDashboard,
  onImportMore,
}: CpapCompleteStepProps) {
  const isFullError = error !== null && !result;

  const stats: SummaryStat[] = result
    ? [
        { label: 'Sessions imported', value: result.sessionsImported.toLocaleString() },
        { label: 'Skipped (duplicates)', value: result.sessionsSkipped.toLocaleString() },
      ]
    : [];

  return (
    <Card className={styles.completeCard}>
      <ImportSummary progress={progress} stats={stats} fatalError={isFullError ? error : null}>
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
      </ImportSummary>
    </Card>
  );
}

// ── Google Health Complete Step ──

interface GoogleHealthCompleteStepProps {
  progress: ImportJobProgress;
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
  const isFullError = error !== null && !result;

  const stats: SummaryStat[] = result
    ? [
        { label: 'Records imported', value: result.recordsImported.toLocaleString() },
        { label: 'Skipped (duplicates)', value: result.recordsSkipped.toLocaleString() },
        { label: 'Data types imported', value: result.dataTypes.length.toLocaleString() },
      ]
    : [];

  return (
    <Card className={styles.completeCard}>
      <ImportSummary progress={progress} stats={stats} fatalError={isFullError ? error : null}>
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
      </ImportSummary>
    </Card>
  );
}
