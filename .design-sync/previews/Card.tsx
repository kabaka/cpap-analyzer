import { Card } from 'cpap-analyzer';

export const Basic = () => (
  <Card>
    <h3 style={{ margin: '0 0 8px' }}>Last night · Jul 2</h3>
    <p style={{ margin: 0 }}>AHI 3.2 events/h · 7.4 h used · leak 12 L/min</p>
  </Card>
);

export const MetricSummary = () => (
  <Card>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 240 }}>
      <div style={{ fontSize: 13, opacity: 0.7 }}>30-night average</div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>AHI</span>
        <strong>3.6 /h</strong>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Median usage</span>
        <strong>7.1 h</strong>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>95% leak</span>
        <strong>14 L/min</strong>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Pressure (95%)</span>
        <strong>10.8 cmH₂O</strong>
      </div>
    </div>
  </Card>
);

export const NoPadding = () => (
  <Card padding={false}>
    <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(128,128,128,0.25)' }}>
      <strong>Compliance</strong>
    </div>
    <div style={{ padding: '12px 16px' }}>28 of 30 nights ≥ 4 h (93%)</div>
  </Card>
);
