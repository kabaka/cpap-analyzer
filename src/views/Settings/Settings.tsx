/**
 * Settings view.
 *
 * Provides full application configuration organized into tabbed sections:
 * General, Analysis, Integrations, Privacy & Storage, and About.
 *
 * @module views/Settings/Settings
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/useAppStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { Accordion, Button, Card, Dialog, Input, Select, Switch, Tabs } from '@/components/ui';
import { clearAllUserData } from '@/services/storage/clearAllUserData';
import { formatBytes } from '@/utils/formatBytes';
import { WeatherIntegrationPanel } from './weather/WeatherIntegrationPanel';
import styles from './Settings.module.css';

// ─── Option Constants ─────────────────────────────────────────────────────

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System (auto)' },
];

const DATE_FORMAT_OPTIONS = [
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (ISO)' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
];

const TIME_FORMAT_OPTIONS = [
  { value: '24h', label: '24-hour' },
  { value: '12h', label: '12-hour' },
];

const CLUSTERING_METHOD_OPTIONS = [
  { value: 'flg', label: 'FLG (Fast Local Grouping)' },
  { value: 'kmeans', label: 'K-Means' },
  { value: 'single-link', label: 'Single-Link' },
];

const LLM_PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

// ─── Section: General ─────────────────────────────────────────────────────

function GeneralSection() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const display = useSettingsStore((s) => s.display);
  const updateDisplay = useSettingsStore((s) => s.updateDisplay);

  return (
    <div className={styles.section}>
      <Card>
        <h3 className={styles.fieldGroupTitle}>Appearance</h3>
        <p className={styles.sectionDescription}>
          Choose how the application looks. System mode follows your operating system preference.
        </p>
        <div className={styles.fieldRow}>
          <Select
            label="Theme"
            options={THEME_OPTIONS}
            value={theme}
            onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}
          />
        </div>
      </Card>

      <Card>
        <h3 className={styles.fieldGroupTitle}>Date &amp; Time</h3>
        <p className={styles.sectionDescription}>
          Configure how dates and times are displayed throughout the application.
        </p>
        <div className={styles.fieldRow}>
          <Select
            label="Date format"
            options={DATE_FORMAT_OPTIONS}
            value={display.dateFormat}
            onValueChange={(v) =>
              updateDisplay({
                dateFormat: v as 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY',
              })
            }
          />
          <Select
            label="Time format"
            options={TIME_FORMAT_OPTIONS}
            value={display.timeFormat}
            onValueChange={(v) => updateDisplay({ timeFormat: v as '12h' | '24h' })}
          />
        </div>
      </Card>

      <Card>
        <h3 className={styles.fieldGroupTitle}>Charts</h3>
        <div className={styles.switchRow}>
          <div className={styles.switchInfo}>
            <span className={styles.switchLabel}>Chart animations</span>
            <span className={styles.switchDescription}>
              Enable smooth transitions and animations in charts. Disabling may improve performance
              on older devices.
            </span>
          </div>
          <Switch
            checked={display.chartAnimations}
            onCheckedChange={(checked) => updateDisplay({ chartAnimations: checked })}
          />
        </div>
      </Card>
    </div>
  );
}

// ─── Section: Analysis ────────────────────────────────────────────────────

function AnalysisSection() {
  const analysisParams = useSettingsStore((s) => s.analysisParams);
  const updateAnalysisParam = useSettingsStore((s) => s.updateAnalysisParam);

  return (
    <div className={styles.section}>
      <Card>
        <h3 className={styles.fieldGroupTitle}>AHI Thresholds</h3>
        <p className={styles.sectionDescription}>
          Apnea-Hypopnea Index severity thresholds (events/hour). Clinical defaults are mild ≥ 5,
          moderate ≥ 15, severe ≥ 30.
        </p>
        <div className={styles.fieldRowThree}>
          <Input
            label="Mild threshold"
            type="number"
            min={0}
            step={1}
            value={analysisParams.ahi.mildThreshold}
            onChange={(e) =>
              updateAnalysisParam('ahi', {
                mildThreshold: Number(e.target.value),
              })
            }
            hint="events/hr"
          />
          <Input
            label="Moderate threshold"
            type="number"
            min={0}
            step={1}
            value={analysisParams.ahi.moderateThreshold}
            onChange={(e) =>
              updateAnalysisParam('ahi', {
                moderateThreshold: Number(e.target.value),
              })
            }
            hint="events/hr"
          />
          <Input
            label="Severe threshold"
            type="number"
            min={0}
            step={1}
            value={analysisParams.ahi.severeThreshold}
            onChange={(e) =>
              updateAnalysisParam('ahi', {
                severeThreshold: Number(e.target.value),
              })
            }
            hint="events/hr"
          />
        </div>
      </Card>

      <Card>
        <h3 className={styles.fieldGroupTitle}>Clustering</h3>
        <p className={styles.sectionDescription}>
          Configure the clustering algorithm used for grouping similar therapy sessions.
        </p>
        <div className={styles.fieldRow}>
          <Select
            label="Clustering method"
            options={CLUSTERING_METHOD_OPTIONS}
            value={analysisParams.clustering.method}
            onValueChange={(v) =>
              updateAnalysisParam('clustering', {
                method: v as 'flg' | 'kmeans' | 'single-link',
              })
            }
          />
          <Input
            label="Minimum cluster size"
            type="number"
            min={2}
            step={1}
            value={analysisParams.clustering.minClusterSize}
            onChange={(e) =>
              updateAnalysisParam('clustering', {
                minClusterSize: Number(e.target.value),
              })
            }
            hint="sessions"
          />
        </div>
      </Card>

      <Card>
        <h3 className={styles.fieldGroupTitle}>Time Series</h3>
        <p className={styles.sectionDescription}>
          Parameters for trend analysis and rolling statistics over time.
        </p>
        <div className={styles.fieldRow}>
          <Input
            label="Rolling window"
            type="number"
            min={1}
            step={1}
            value={analysisParams.timeSeries.rollingWindow}
            onChange={(e) =>
              updateAnalysisParam('timeSeries', {
                rollingWindow: Number(e.target.value),
              })
            }
            hint="days"
          />
          <Input
            label="Trend confidence"
            type="number"
            min={0.5}
            max={0.999}
            step={0.01}
            value={analysisParams.timeSeries.trendConfidence}
            onChange={(e) =>
              updateAnalysisParam('timeSeries', {
                trendConfidence: Number(e.target.value),
              })
            }
            hint="0–1 (e.g. 0.95 = 95%)"
          />
        </div>
      </Card>
    </div>
  );
}

// ─── Section: Integrations ────────────────────────────────────────────────

function IntegrationsSection() {
  const integrations = useSettingsStore((s) => s.integrations);
  const updateIntegration = useSettingsStore((s) => s.updateIntegration);
  const navigate = useNavigate();

  const fitbitTriggerLabel = (() => {
    if (!integrations.fitbit.enabled) return 'Google Health (Fitbit) — Disabled';
    if (integrations.fitbit.recordCount > 0)
      return `Google Health (Fitbit) — ${integrations.fitbit.recordCount.toLocaleString()} records`;
    return 'Google Health (Fitbit) — Enabled';
  })();

  const accordionItems = [
    {
      value: 'fitbit',
      trigger: fitbitTriggerLabel,
      content: (
        <div className={styles.integrationPanel}>
          <div className={styles.switchRow}>
            <div className={styles.switchInfo}>
              <span className={styles.switchLabel}>Enable Google Health integration</span>
              <span className={styles.switchDescription}>
                Import sleep, heart rate, SpO&#8322;, HRV, activity, and more from your Google
                Health (Fitbit) data export. Data is processed locally — nothing is uploaded.
              </span>
            </div>
            <Switch
              checked={integrations.fitbit.enabled}
              onCheckedChange={(checked) => updateIntegration('fitbit', { enabled: checked })}
            />
          </div>
          {integrations.fitbit.enabled && (
            <div className={styles.integrationDetails}>
              <div className={styles.integrationStatus}>
                {integrations.fitbit.lastImportAt ? (
                  <>
                    <span className={styles.integrationStatValue}>
                      {integrations.fitbit.recordCount.toLocaleString()} records imported
                    </span>
                    <span className={styles.integrationStatLabel}>
                      Last imported:{' '}
                      {new Date(integrations.fitbit.lastImportAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </>
                ) : (
                  <span className={styles.integrationStatLabel}>No data imported yet</span>
                )}
              </div>
              <Button variant="primary" onClick={() => void navigate('/data/import')}>
                Import Data
              </Button>
            </div>
          )}
        </div>
      ),
    },
    {
      value: 'weather',
      trigger: (
        <span className={styles.integrationTrigger}>
          <span className={styles.integrationTriggerIcon} aria-hidden="true">
            🌐
          </span>
          <span>
            Weather &amp; Air Quality — {integrations.weather.enabled ? 'Enabled' : 'Disabled'}
          </span>
          {integrations.weather.enabled && (
            <span className={styles.onlinePill}>Connects online</span>
          )}
        </span>
      ),
      content: (
        <div className={styles.integrationPanel}>
          <WeatherIntegrationPanel />
        </div>
      ),
    },
    {
      value: 'llm',
      trigger: `LLM Assistant — ${integrations.llm.enabled ? 'Enabled' : 'Disabled'}`,
      content: (
        <div className={styles.integrationPanel}>
          <div className={styles.switchRow}>
            <div className={styles.switchInfo}>
              <span className={styles.switchLabel}>Enable LLM Assistant</span>
              <span className={styles.switchDescription}>
                Use AI to generate insights and explanations from your therapy data. Your data is
                sent to the selected provider&apos;s API.
              </span>
            </div>
            <Switch
              checked={integrations.llm.enabled}
              onCheckedChange={(checked) => updateIntegration('llm', { enabled: checked })}
            />
          </div>
          {integrations.llm.enabled && (
            <>
              <span className={styles.comingSoon}>
                Coming soon — Integration will be available in a future release
              </span>
              <Select
                label="Provider"
                options={LLM_PROVIDER_OPTIONS}
                value={integrations.llm.provider ?? ''}
                onValueChange={(v) =>
                  updateIntegration('llm', {
                    provider: v as 'openai' | 'anthropic',
                  })
                }
                placeholder="Select provider"
                disabled
              />
              <Input
                label="API key"
                type="password"
                placeholder="Enter API key"
                value={integrations.llm.apiKey ?? ''}
                onChange={(e) =>
                  updateIntegration('llm', {
                    apiKey: e.target.value || null,
                  })
                }
                disabled
                hint="Configuration will be available when integration launches"
              />
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={styles.section}>
      <p className={styles.sectionDescription}>
        Configure external service integrations. All integrations are disabled by default. When
        enabled, data may be sent to third-party services as described in each section.
      </p>
      <Accordion items={accordionItems} type="single" />
    </div>
  );
}

// ─── Section: Privacy & Storage ───────────────────────────────────────────

interface StorageEstimate {
  usage: number;
  quota: number;
}

function PrivacyStorageSection() {
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimate | null>(null);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchEstimate() {
      try {
        if (navigator.storage?.estimate) {
          const estimate = await navigator.storage.estimate();
          if (!cancelled) {
            setStorageEstimate({
              usage: estimate.usage ?? 0,
              quota: estimate.quota ?? 0,
            });
          }
        }
      } catch {
        // Storage API may not be available
      }
    }

    void fetchEstimate();
    return () => {
      cancelled = true;
    };
  }, [clearing]); // re-fetch after clearing

  const handleClearAllData = useCallback(async () => {
    setClearing(true);
    setClearError(null);
    try {
      // Single shared wipe of all durable + in-memory user data. Privacy-critical:
      // a failure here means data may remain, so it propagates rather than being
      // swallowed, keeping the dialog open with an error.
      await clearAllUserData();
      setShowClearDialog(false);
    } catch (err: unknown) {
      // Surface the failure — never silently report success on a deletion path.
      setClearError(err instanceof Error ? err.message : 'Failed to clear all data.');
    } finally {
      setClearing(false);
    }
  }, []);

  const usagePercent =
    storageEstimate && storageEstimate.quota > 0
      ? Math.min(100, (storageEstimate.usage / storageEstimate.quota) * 100)
      : 0;

  return (
    <div className={styles.section}>
      <Card>
        <h3 className={styles.fieldGroupTitle}>Storage Usage</h3>
        <p className={styles.sectionDescription}>
          Estimated browser storage used by imported CPAP data and analysis results.
        </p>

        {storageEstimate ? (
          <div className={styles.storageInfo}>
            <div className={styles.storageStats}>
              <div className={styles.storageStat}>
                <span className={styles.storageStatLabel}>Used</span>
                <span className={styles.storageStatValue}>
                  {formatBytes(storageEstimate.usage)}
                </span>
              </div>
              <div className={styles.storageStat}>
                <span className={styles.storageStatLabel}>Available</span>
                <span className={styles.storageStatValue}>
                  {formatBytes(storageEstimate.quota)}
                </span>
              </div>
            </div>
            <div className={styles.storageBar}>
              <div
                className={styles.storageBarFill}
                style={{ '--storage-fill': `${usagePercent}%` } as React.CSSProperties}
                aria-label={`Storage usage: ${usagePercent.toFixed(1)}%`}
              />
            </div>
          </div>
        ) : (
          <p className={`${styles.sectionDescription} ${styles.storageFallback}`}>
            Storage estimate unavailable in this browser.
          </p>
        )}
      </Card>

      <Card>
        <div className={styles.privacyNotice}>
          <h4 className={styles.privacyNoticeTitle}>Your data stays on your device</h4>
          <p className={styles.privacyNoticeText}>
            CPAP Analyzer processes all data locally in your browser. No therapy data is ever
            transmitted to external servers. Your data remains exclusively on this device unless you
            explicitly enable an integration that requires it.
          </p>
          <p className={styles.privacyNoticeText}>
            Data is stored in your browser&apos;s IndexedDB and Origin Private File System (OPFS).
            Clearing browser data or using the button below will permanently remove all imported
            sessions and analysis results.
          </p>
        </div>
      </Card>

      <Card>
        <div className={styles.dangerZone}>
          <h4 className={styles.dangerZoneTitle}>Danger Zone</h4>
          <p className={styles.dangerZoneDescription}>
            Permanently delete all imported CPAP data, analysis results, and reset all settings to
            defaults. This action cannot be undone.
          </p>
          <div>
            <Button
              variant="danger"
              onClick={() => {
                setClearError(null);
                setShowClearDialog(true);
              }}
              disabled={clearing}
              loading={clearing}
            >
              Clear All Data
            </Button>
          </div>
        </div>
      </Card>

      <Dialog
        open={showClearDialog}
        onOpenChange={setShowClearDialog}
        title="Clear All Data"
        description="This will permanently delete all imported CPAP sessions, analysis results, and reset settings to defaults."
      >
        <p className={styles.sectionDescription}>
          Are you sure you want to continue? This action <strong>cannot be undone</strong>.
        </p>
        {clearError && (
          <p className={styles.clearError} role="alert">
            {clearError}
          </p>
        )}
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={() => setShowClearDialog(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void handleClearAllData()} loading={clearing}>
            Yes, Delete Everything
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

// ─── Section: About ───────────────────────────────────────────────────────

function AboutSection() {
  return (
    <div className={styles.section}>
      <Card>
        <div className={styles.aboutInfo}>
          <div className={styles.aboutRow}>
            <span className={styles.aboutLabel}>Application</span>
            <span className={styles.aboutValue}>CPAP Analyzer</span>
          </div>
          <div className={styles.aboutRow}>
            <span className={styles.aboutLabel}>License</span>
            <span className={styles.aboutValue}>MIT</span>
          </div>
          <div className={styles.aboutRow}>
            <span className={styles.aboutLabel}>Architecture</span>
            <span className={styles.aboutValue}>Client-side only</span>
          </div>
          <div className={styles.aboutRow}>
            <span className={styles.aboutLabel}>Privacy</span>
            <span className={styles.aboutValue}>Zero telemetry / zero analytics</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────

export default function Settings() {
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);
  const [showResetDialog, setShowResetDialog] = useState(false);

  const handleReset = useCallback(() => {
    resetToDefaults();
    useAppStore.getState().setTheme('system');
    setShowResetDialog(false);
  }, [resetToDefaults]);

  const tabs = [
    { value: 'general', label: 'General', content: <GeneralSection /> },
    { value: 'analysis', label: 'Analysis', content: <AnalysisSection /> },
    { value: 'integrations', label: 'Integrations', content: <IntegrationsSection /> },
    { value: 'privacy', label: 'Privacy & Storage', content: <PrivacyStorageSection /> },
    { value: 'about', label: 'About', content: <AboutSection /> },
  ];

  return (
    <div className={styles.settings}>
      <div className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
      </div>

      <Tabs tabs={tabs} defaultValue="general" />

      <div className={styles.footerActions}>
        <Button variant="secondary" onClick={() => setShowResetDialog(true)}>
          Reset to Defaults
        </Button>
      </div>

      <Dialog
        open={showResetDialog}
        onOpenChange={setShowResetDialog}
        title="Reset Settings"
        description="This will reset all settings to their default values. Your imported data will not be affected."
      >
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={() => setShowResetDialog(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleReset}>
            Reset to Defaults
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
