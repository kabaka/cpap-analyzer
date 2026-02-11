import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import styles from './Tabs.module.css';

interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  tabs: TabItem[];
  defaultValue?: string;
  className?: string;
}

export function Tabs({ tabs, defaultValue, className }: TabsProps) {
  const defaultTab = defaultValue ?? tabs[0]?.value;

  return (
    <TabsPrimitive.Root defaultValue={defaultTab} className={className}>
      <TabsPrimitive.List className={styles.list}>
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger key={tab.value} value={tab.value} className={styles.trigger}>
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((tab) => (
        <TabsPrimitive.Content key={tab.value} value={tab.value} className={styles.content}>
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
