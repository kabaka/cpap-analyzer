import { MathEquation } from 'cpap-analyzer';

export const Inline = () => (
  <div style={{ maxWidth: 540, lineHeight: 1.7 }}>
    The apnea–hypopnea index is <MathEquation math="AHI = \frac{apneas + hypopneas}{hours}" />{' '}
    events per hour.
  </div>
);

export const DisplayBlock = () => (
  <div style={{ maxWidth: 540 }}>
    <MathEquation
      math="\text{ODI} = \frac{\text{desaturations} \geq 3\%}{\text{hours asleep}}"
      display
    />
  </div>
);

export const Ventilation = () => (
  <div style={{ maxWidth: 540 }}>
    <MathEquation math="\dot{V}_E = f \times V_T" display />
  </div>
);
