import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ children, className, padding = true, ...props }, ref) => {
    const classNames = [styles.card, padding && styles.padded, className].filter(Boolean).join(' ');

    return (
      <div ref={ref} className={classNames} {...props}>
        {children}
      </div>
    );
  },
);

Card.displayName = 'Card';
