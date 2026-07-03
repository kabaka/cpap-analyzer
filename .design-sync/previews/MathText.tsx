import { MathText } from 'cpap-analyzer';

export const InlineMath = () => (
  <div style={{ maxWidth: 540, lineHeight: 1.7 }}>
    <MathText text="The apnea–hypopnea index is defined as $AHI = \frac{N_{apnea} + N_{hypopnea}}{T_{sleep}}$ and is reported in events per hour of sleep." />
  </div>
);

export const DisplayMath = () => (
  <div style={{ maxWidth: 540 }}>
    <MathText text="A leak-corrected minute ventilation estimate: $$\dot{V}_E = f \times V_T$$ where $f$ is respiratory rate and $V_T$ is tidal volume." />
  </div>
);
