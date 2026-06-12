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
  /**
   * Controlled active tab value. When provided (together with
   * {@link TabsProps.onValueChange}), the component is controlled and
   * {@link TabsProps.defaultValue} is ignored. Useful for syncing the active
   * tab with external state such as a URL query parameter.
   */
  value?: string;
  /** Called with the new tab value when the active tab changes. */
  onValueChange?: (value: string) => void;
}

export function Tabs({ tabs, defaultValue, className, value, onValueChange }: TabsProps) {
  const defaultTab = defaultValue ?? tabs[0]?.value;

  return (
    <TabsPrimitive.Root
      defaultValue={value === undefined ? defaultTab : undefined}
      value={value}
      onValueChange={onValueChange}
      className={className}
    >
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
