import { Icon } from 'cpap-analyzer';

export const Gallery = () => (
  <div style={{ color: '#1a1a1a' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, maxWidth: 360 }}>
      <Icon name="dashboard" size="md" title="Dashboard" />
      <Icon name="sessions" size="md" title="Sessions" />
      <Icon name="trends" size="md" title="Trends" />
      <Icon name="explore" size="md" title="Explore" />
      <Icon name="reports" size="md" title="Reports" />
      <Icon name="data" size="md" title="Data" />
      <Icon name="settings" size="md" title="Settings" />
      <Icon name="help" size="md" title="Help" />
      <Icon name="calendar" size="md" title="Calendar" />
      <Icon name="clock" size="md" title="Clock" />
      <Icon name="storage" size="md" title="Storage" />
      <Icon name="menu" size="md" title="Menu" />
      <Icon name="theme-light" size="md" title="Light theme" />
      <Icon name="theme-dark" size="md" title="Dark theme" />
      <Icon name="theme-system" size="md" title="System theme" />
      <Icon name="brand" size="md" title="Brand" />
    </div>
  </div>
);

export const Sizes = () => (
  <div style={{ color: '#1a1a1a' }}>
    <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
      <Icon name="trends" size="sm" title="Trends small" />
      <Icon name="trends" size="md" title="Trends medium" />
      <Icon name="trends" size="lg" title="Trends large" />
    </div>
  </div>
);
