import { Popover, Button } from 'cpap-analyzer';

// Radix Popover opens on interaction — there is no `open`/`defaultOpen` prop,
// so the static card shows the closed trigger (its entry point). The floating
// panel content is documented in the props / prompt.
export const Trigger = () => (
  <Popover trigger={<Button variant="secondary">Adjust AHI threshold ⌄</Button>}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200 }}>
      <strong>Events / hour</strong>
      <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
        Nights above this value are flagged.
      </p>
    </div>
  </Popover>
);
