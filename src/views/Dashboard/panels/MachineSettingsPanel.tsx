/**
 * Machine Settings panel — displays current machine configuration.
 *
 * @module views/Dashboard/panels/MachineSettingsPanel
 */

import React from 'react';
import { Card } from '@/components/ui';
import type { MachineSettings } from '@/types';
import styles from './MachineSettingsPanel.module.css';

interface MachineSettingsPanelProps {
  settings: MachineSettings | null;
  settingsChangeDate: string | null;
  loading: boolean;
}

function formatRampTime(rampTime: number | null): string {
  if (rampTime === null) return '—';
  if (rampTime === 0) return 'Auto';
  if (rampTime < 0) return 'Off';
  return `${rampTime} min`;
}

function formatBoolean(val: boolean | null): string {
  if (val === null) return '—';
  return val ? 'On' : 'Off';
}

function formatPressureRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return '—';
  if (min !== null && max !== null) return `${min.toFixed(1)}–${max.toFixed(1)} cmH₂O`;
  if (min !== null) return `${min.toFixed(1)} cmH₂O`;
  return `${(max ?? 0).toFixed(1)} cmH₂O`;
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const MachineSettingsPanel = React.memo(function MachineSettingsPanel({
  settings,
  settingsChangeDate,
  loading,
}: MachineSettingsPanelProps) {
  if (loading) {
    return (
      <Card className={styles.card}>
        <h3 className={styles.title}>Machine Settings</h3>
        <div className={styles.skeletonList}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={styles.skeletonRow} />
          ))}
        </div>
      </Card>
    );
  }

  if (!settings) {
    return (
      <Card className={styles.card}>
        <h3 className={styles.title}>Machine Settings</h3>
        <p className={styles.empty}>
          No machine settings data available. Settings are read from the STR.edf file on your SD
          card.
        </p>
      </Card>
    );
  }

  const rows: Array<{ label: string; value: string }> = [];

  if (settings.therapyMode !== null) {
    rows.push({ label: 'Therapy Mode', value: settings.therapyMode });
  }
  rows.push({
    label: 'Pressure Range',
    value: formatPressureRange(settings.minPressure, settings.maxPressure),
  });
  if (settings.eprLevel !== null) {
    const eprStr = settings.eprType
      ? `Level ${settings.eprLevel} (${settings.eprType})`
      : `Level ${settings.eprLevel}`;
    rows.push({ label: 'EPR', value: eprStr });
  }
  if (settings.rampTime !== null) {
    const rampStr =
      settings.rampPressure !== null
        ? `${formatRampTime(settings.rampTime)} @ ${settings.rampPressure.toFixed(1)} cmH₂O`
        : formatRampTime(settings.rampTime);
    rows.push({ label: 'Ramp', value: rampStr });
  }
  if (settings.maskType !== null) {
    rows.push({ label: 'Mask Type', value: settings.maskType });
  }
  if (settings.humidifierLevel !== null) {
    rows.push({ label: 'Humidifier', value: `Level ${settings.humidifierLevel}/8` });
  }
  if (settings.climateControl !== null) {
    rows.push({ label: 'Climate Control', value: formatBoolean(settings.climateControl) });
  }
  if (settings.smartStart !== null) {
    rows.push({ label: 'SmartStart', value: formatBoolean(settings.smartStart) });
  }

  return (
    <Card className={styles.card}>
      <h3 className={styles.title}>Machine Settings</h3>
      <dl className={styles.settingsList}>
        {rows.map((row) => (
          <div key={row.label} className={styles.settingsRow}>
            <dt className={styles.settingsLabel}>{row.label}</dt>
            <dd className={styles.settingsValue}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {settingsChangeDate && (
        <div className={styles.changeNotice} role="status">
          <span className={styles.changeIcon} aria-hidden="true">
            ⚠
          </span>
          Settings changed {formatShortDate(settingsChangeDate)}
        </div>
      )}
    </Card>
  );
});

export default MachineSettingsPanel;
