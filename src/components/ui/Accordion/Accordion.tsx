import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import styles from './Accordion.module.css';

interface AccordionItem {
  value: string;
  trigger: ReactNode;
  content: ReactNode;
}

type AccordionProps =
  | {
      items: AccordionItem[];
      type?: 'single';
      defaultValue?: string;
      className?: string;
    }
  | {
      items: AccordionItem[];
      type: 'multiple';
      defaultValue?: string[];
      className?: string;
    };

export function Accordion({ items, type, defaultValue, className }: AccordionProps) {
  if (type === 'multiple') {
    return (
      <AccordionPrimitive.Root
        type="multiple"
        defaultValue={defaultValue as string[] | undefined}
        className={className}
      >
        {items.map((item) => (
          <AccordionItemComponent key={item.value} value={item.value}>
            <AccordionTrigger>{item.trigger}</AccordionTrigger>
            <AccordionContent>{item.content}</AccordionContent>
          </AccordionItemComponent>
        ))}
      </AccordionPrimitive.Root>
    );
  }

  return (
    <AccordionPrimitive.Root
      type="single"
      defaultValue={defaultValue as string | undefined}
      collapsible
      className={className}
    >
      {items.map((item) => (
        <AccordionItemComponent key={item.value} value={item.value}>
          <AccordionTrigger>{item.trigger}</AccordionTrigger>
          <AccordionContent>{item.content}</AccordionContent>
        </AccordionItemComponent>
      ))}
    </AccordionPrimitive.Root>
  );
}

const AccordionItemComponent = forwardRef<HTMLDivElement, AccordionPrimitive.AccordionItemProps>(
  ({ children, ...props }, ref) => (
    <AccordionPrimitive.Item ref={ref} className={styles.root} {...props}>
      {children}
    </AccordionPrimitive.Item>
  ),
);
AccordionItemComponent.displayName = 'AccordionItem';

const AccordionTrigger = forwardRef<HTMLButtonElement, AccordionPrimitive.AccordionTriggerProps>(
  ({ children, ...props }, ref) => (
    <AccordionPrimitive.Header className={styles.header}>
      <AccordionPrimitive.Trigger ref={ref} className={styles.trigger} {...props}>
        {children}
        <ChevronDownIcon />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  ),
);
AccordionTrigger.displayName = 'AccordionTrigger';

const AccordionContent = forwardRef<HTMLDivElement, AccordionPrimitive.AccordionContentProps>(
  ({ children, ...props }, ref) => (
    <AccordionPrimitive.Content ref={ref} className={styles.content} {...props}>
      <div className={styles.contentInner}>{children}</div>
    </AccordionPrimitive.Content>
  ),
);
AccordionContent.displayName = 'AccordionContent';

function ChevronDownIcon() {
  return (
    <svg
      className={styles.chevron}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 6L8 10L12 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
