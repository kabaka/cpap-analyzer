import { Switch } from 'cpap-analyzer';

export const States = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
    <Switch label="Exclude naps under 1 hour" checked />
    <Switch label="Show leak rate overlay" checked={false} />
  </div>
);

export const On = () => <Switch label="Enable weather correlation" checked />;

export const Off = () => <Switch label="Include unflagged sessions" checked={false} />;

export const Disabled = () => (
  <Switch label="Sync with Fitbit (not connected)" checked={false} disabled />
);
