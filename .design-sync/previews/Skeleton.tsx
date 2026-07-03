import { Skeleton } from 'cpap-analyzer';

export const Variants = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 260 }}>
    <Skeleton variant="text" width="80%" />
    <Skeleton variant="rect" width={260} height={72} />
    <Skeleton variant="circle" width={48} height={48} />
  </div>
);

export const LoadingCard = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 280 }}>
    <Skeleton variant="circle" width={48} height={48} />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
      <Skeleton variant="text" width="70%" height={14} />
      <Skeleton variant="text" width="45%" height={14} />
    </div>
  </div>
);

export const ChartPlaceholder = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 300 }}>
    <Skeleton variant="text" width="40%" height={16} />
    <Skeleton variant="rect" width={300} height={140} />
  </div>
);
