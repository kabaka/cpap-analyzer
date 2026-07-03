import { Tabs } from 'cpap-analyzer';

export const Overview = () => (
  <div style={{ maxWidth: 520 }}>
    <Tabs
      defaultValue="overview"
      tabs={[
        {
          value: 'overview',
          label: 'Overview',
          content: (
            <div style={{ paddingTop: 12 }}>
              AHI 3.2 events/h · 7.4 h used · 95% leak 12 L/min. Therapy on track for Jul 2.
            </div>
          ),
        },
        {
          value: 'events',
          label: 'Events',
          content: (
            <div style={{ paddingTop: 12 }}>
              Obstructive 2.1/h · central 0.4/h · hypopnea 0.7/h across the night.
            </div>
          ),
        },
        {
          value: 'leak',
          label: 'Leak',
          content: (
            <div style={{ paddingTop: 12 }}>
              Median leak 4 L/min, 95th-percentile 12 L/min — well within the seal threshold.
            </div>
          ),
        },
      ]}
    />
  </div>
);

export const EventsActive = () => (
  <div style={{ maxWidth: 520 }}>
    <Tabs
      defaultValue="events"
      tabs={[
        {
          value: 'overview',
          label: 'Overview',
          content: <div style={{ paddingTop: 12 }}>Summary for the selected night.</div>,
        },
        {
          value: 'events',
          label: 'Events',
          content: (
            <div style={{ paddingTop: 12 }}>
              14 obstructive · 3 central · 5 hypopnea · longest apnea 22 s at 03:41.
            </div>
          ),
        },
      ]}
    />
  </div>
);
