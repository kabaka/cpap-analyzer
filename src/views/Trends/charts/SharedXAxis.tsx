/**
 * SharedXAxis — renders a standalone date axis at the bottom of the chart stack.
 *
 * @module views/Trends/charts/SharedXAxis
 */

import React from 'react';
import { ResponsiveContainer, XAxis, BarChart } from 'recharts';

interface SharedXAxisProps {
  data: { date: string }[];
}

const SharedXAxis = React.memo(function SharedXAxis({ data }: SharedXAxisProps) {
  if (data.length === 0) return null;

  return (
    <div style={{ width: '100%', height: 30 }}>
      <ResponsiveContainer width="100%" height={30}>
        <BarChart data={data} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'var(--color-chart-axis)' }}
            stroke="var(--color-chart-axis)"
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});

export default SharedXAxis;
