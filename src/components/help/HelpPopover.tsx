import { glossaryMap } from '@/content/help';
import { Popover } from '@/components/ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './HelpPopover.module.css';

interface HelpPopoverProps {
  /** Glossary term identifier */
  termId: string;
  /** The trigger element (typically a clinical term in text) */
  children: ReactNode;
  /** Popover placement */
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * Info popover for clinical terms.
 * Shows a paragraph-length explanation with a "Learn more" link to the glossary.
 */
export function HelpPopover({ termId, children, side = 'bottom' }: HelpPopoverProps) {
  const navigate = useNavigate();
  const entry = glossaryMap.get(termId);

  if (!entry) {
    return <>{children}</>;
  }

  const handleLearnMore = () => {
    navigate(`/help/glossary#${entry.id}`);
  };

  const trigger = (
    <button type="button" className={styles.trigger} aria-label={`Learn about ${entry.term}`}>
      {children}
      <InfoIcon />
    </button>
  );

  return (
    <Popover trigger={trigger} side={side}>
      <div className={styles.popoverContent}>
        <h4 className={styles.term}>{entry.term}</h4>
        <p className={styles.explanation}>{entry.standard}</p>
        <button type="button" className={styles.learnMore} onClick={handleLearnMore}>
          Learn more →
        </button>
      </div>
    </Popover>
  );
}

function InfoIcon() {
  return (
    <svg
      className={styles.infoIcon}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.25" />
      <path d="M7 6.5V10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="7" cy="4.5" r="0.75" fill="currentColor" />
    </svg>
  );
}
