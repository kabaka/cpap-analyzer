import { Tooltip, TooltipProvider } from 'cpap-analyzer';

// Radix Tooltip shows its bubble on hover only (no `open` prop), and requires a
// TooltipProvider ancestor — composed here. The static card shows the trigger
// (a term with a help affordance); the bubble content lives in the props.
export const Trigger = () => (
  <TooltipProvider>
    <p style={{ maxWidth: 360, lineHeight: 1.7 }}>
      Last night your{' '}
      <Tooltip content="Apnea–Hypopnea Index: apneas + hypopneas per hour of sleep.">
        <span style={{ borderBottom: '1px dotted currentColor', cursor: 'help' }}>AHI</span>
      </Tooltip>{' '}
      was 3.2 — within the normal range.
    </p>
  </TooltipProvider>
);
