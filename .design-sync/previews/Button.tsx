import { Button } from 'cpap-analyzer';

export const Variants = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
    <Button variant="primary">Import data</Button>
    <Button variant="secondary">Cancel</Button>
    <Button variant="ghost">Learn more</Button>
    <Button variant="danger">Delete session</Button>
  </div>
);

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Button size="sm">Small</Button>
    <Button size="md">Medium</Button>
    <Button size="lg">Large</Button>
  </div>
);

export const States = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Button loading>Analyzing…</Button>
    <Button disabled>Unavailable</Button>
  </div>
);
