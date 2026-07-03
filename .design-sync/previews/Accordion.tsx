import { Accordion } from 'cpap-analyzer';

export const FAQ = () => (
  <div style={{ maxWidth: 520 }}>
    <Accordion
      type="single"
      defaultValue="ahi"
      items={[
        {
          value: 'ahi',
          trigger: 'What is AHI?',
          content:
            'The Apnea–Hypopnea Index is the number of apneas and hypopneas per hour of sleep. Under 5 is normal, 5–15 mild, 15–30 moderate, and above 30 severe.',
        },
        {
          value: 'leak',
          trigger: 'How is mask leak measured?',
          content:
            'Leak is the unintended air escaping from the mask seal, reported in L/min. The 95th-percentile leak is the value your leak stayed below for 95% of the night.',
        },
        {
          value: 'central',
          trigger: 'Central vs obstructive apneas?',
          content:
            'Obstructive apneas come from a blocked airway; central apneas occur when the brain briefly stops signaling the muscles to breathe.',
        },
      ]}
    />
  </div>
);

export const Multiple = () => (
  <div style={{ maxWidth: 520 }}>
    <Accordion
      type="multiple"
      defaultValue={['pressure', 'usage']}
      items={[
        {
          value: 'pressure',
          trigger: 'Pressure settings',
          content: 'APAP range 6–14 cmH₂O, EPR level 2, 95th-percentile pressure 10.8 cmH₂O.',
        },
        {
          value: 'usage',
          trigger: 'Usage details',
          content: 'Last night 7.4 h across a single session, mask on at 23:12.',
        },
        {
          value: 'events',
          trigger: 'Event breakdown',
          content: 'Obstructive 2.1/h · central 0.4/h · hypopnea 0.7/h.',
        },
      ]}
    />
  </div>
);
