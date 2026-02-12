import { useState, useEffect, useCallback, useRef } from 'react';
import type { GuidedTourDefinition, TourStep } from '@/content/help';
import styles from './GuidedTour.module.css';

interface GuidedTourProps {
  /** The tour definition to run */
  tour: GuidedTourDefinition;
  /** Called when the tour completes or is dismissed */
  onComplete: () => void;
}

interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Step-by-step overlay tour with highlights.
 * Renders a transparent overlay with a cutout around the target element.
 */
export function GuidedTour({ tour, onComplete }: GuidedTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [highlightRect, setHighlightRect] = useState<HighlightRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const step = tour.steps[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === tour.steps.length - 1;

  // Find and highlight the target element
  const updateHighlight = useCallback((tourStep: TourStep) => {
    const el = document.querySelector(tourStep.targetSelector);
    if (el) {
      const rect = el.getBoundingClientRect();
      const padding = 8;
      setHighlightRect({
        top: rect.top - padding + window.scrollY,
        left: rect.left - padding + window.scrollX,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      });
    } else {
      setHighlightRect(null);
    }
  }, []);

  useEffect(() => {
    if (step) {
      updateHighlight(step);
    }
  }, [step, updateHighlight]);

  // Update highlight on scroll/resize
  useEffect(() => {
    const handleUpdate = () => {
      if (step) updateHighlight(step);
    };

    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, true);
    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate, true);
    };
  }, [step, updateHighlight]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onComplete();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (isLastStep) {
          onComplete();
        } else {
          setCurrentStep((s) => s + 1);
        }
      } else if (e.key === 'ArrowLeft' && !isFirstStep) {
        setCurrentStep((s) => s - 1);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFirstStep, isLastStep, onComplete]);

  if (!step) return null;

  const tooltipStyle = getTooltipPosition(highlightRect, step.position);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={tour.title}>
      {/* SVG overlay with cutout */}
      <svg className={styles.svgOverlay} aria-hidden="true">
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {highlightRect && (
              <rect
                x={highlightRect.left}
                y={highlightRect.top}
                width={highlightRect.width}
                height={highlightRect.height}
                rx="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.5)"
          mask="url(#tour-mask)"
        />
      </svg>

      {/* Highlight border */}
      {highlightRect && (
        <div
          className={styles.highlight}
          style={{
            top: highlightRect.top,
            left: highlightRect.left,
            width: highlightRect.width,
            height: highlightRect.height,
          }}
          aria-hidden="true"
        />
      )}

      {/* Tooltip */}
      <div ref={tooltipRef} className={styles.tooltip} style={tooltipStyle}>
        <div className={styles.tooltipHeader}>
          <span className={styles.stepCounter}>
            {currentStep + 1} of {tour.steps.length}
          </span>
          <button
            type="button"
            className={styles.skipButton}
            onClick={onComplete}
            aria-label="Skip tour"
          >
            Skip
          </button>
        </div>
        <h3 className={styles.tooltipTitle}>{step.title}</h3>
        <p className={styles.tooltipDescription}>{step.description}</p>
        <div className={styles.tooltipActions}>
          {!isFirstStep && (
            <button
              type="button"
              className={styles.backButton}
              onClick={() => setCurrentStep((s) => s - 1)}
            >
              Back
            </button>
          )}
          <button
            type="button"
            className={styles.nextButton}
            onClick={() => {
              if (isLastStep) {
                onComplete();
              } else {
                setCurrentStep((s) => s + 1);
              }
            }}
          >
            {isLastStep ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

function getTooltipPosition(
  rect: HighlightRect | null,
  position: TourStep['position'],
): React.CSSProperties {
  if (!rect) {
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }

  const tooltipOffset = 16;

  switch (position) {
    case 'right':
      return {
        top: rect.top,
        left: rect.left + rect.width + tooltipOffset,
      };
    case 'left':
      return {
        top: rect.top,
        right: window.innerWidth - rect.left + tooltipOffset,
      };
    case 'bottom':
      return {
        top: rect.top + rect.height + tooltipOffset,
        left: rect.left,
      };
    case 'top':
      return {
        bottom: window.innerHeight - rect.top + tooltipOffset,
        left: rect.left,
      };
  }
}
