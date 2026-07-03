import { DropdownMenu, Button } from 'cpap-analyzer';

// Radix DropdownMenu opens on interaction (no `open`/`defaultOpen` prop), so
// the static card shows the closed trigger. The `items` array — labels, icons,
// separators, disabled — is documented in the props / prompt.
export const Trigger = () => (
  <DropdownMenu
    trigger={<Button variant="secondary">Session actions ⌄</Button>}
    items={[
      { label: 'Export as CSV' },
      { label: 'Re-analyze night' },
      { separator: true },
      { label: 'Delete session' },
    ]}
  />
);
