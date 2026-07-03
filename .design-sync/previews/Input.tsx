import { Input } from 'cpap-analyzer';

export const Default = () => <Input label="Serial number" placeholder="e.g. 23211234567" />;

export const Filled = () => (
  <Input
    label="Usage hours"
    defaultValue="7.4"
    hint="Average nightly usage over the last 30 days"
  />
);

export const WithError = () => (
  <Input
    label="Serial number"
    defaultValue="XYZ-000"
    error="Not a recognized ResMed serial number"
  />
);

export const Disabled = () => (
  <Input label="Device model" defaultValue="AirSense 11 AutoSet" disabled />
);
