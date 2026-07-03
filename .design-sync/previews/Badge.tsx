import { Badge } from 'cpap-analyzer';

export const Variants = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
    <Badge variant="default">Normal</Badge>
    <Badge variant="success">Mild</Badge>
    <Badge variant="warning">Elevated leak</Badge>
    <Badge variant="danger">Severe</Badge>
    <Badge variant="info">Info</Badge>
  </div>
);

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
    <Badge variant="warning" size="sm">
      AHI 8.3
    </Badge>
    <Badge variant="warning" size="md">
      AHI 8.3
    </Badge>
  </div>
);
