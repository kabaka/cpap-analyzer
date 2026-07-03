import { Select } from 'cpap-analyzer';

const rangeOptions = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '1y', label: 'Last 12 months' },
];

const machineOptions = [
  { value: 'as11', label: 'AirSense 11 AutoSet' },
  { value: 'as10', label: 'AirSense 10 AutoSet' },
  { value: 'ac11', label: 'AirCurve 11 VAuto' },
];

export const Selected = () => <Select label="Date range" options={rangeOptions} value="30d" />;

export const Placeholder = () => (
  <Select label="Machine" options={machineOptions} placeholder="Select a device…" />
);

export const WithError = () => (
  <Select
    label="Machine"
    options={machineOptions}
    placeholder="Select a device…"
    error="A device must be selected to import"
  />
);

export const Disabled = () => (
  <Select label="Date range" options={rangeOptions} value="90d" disabled />
);
