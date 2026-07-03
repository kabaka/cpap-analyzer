import { Slider } from 'cpap-analyzer';

export const Single = () => (
  <div style={{ width: 320 }}>
    <Slider label="AHI threshold (events/h)" min={0} max={30} step={1} value={[5]} />
  </div>
);

export const PressureRange = () => (
  <div style={{ width: 320 }}>
    <Slider label="Pressure range (cmH₂O)" min={4} max={20} step={0.5} value={[6, 14]} />
  </div>
);

export const Disabled = () => (
  <div style={{ width: 320 }}>
    <Slider label="Leak rate limit (L/min)" min={0} max={60} step={5} value={[24]} disabled />
  </div>
);
