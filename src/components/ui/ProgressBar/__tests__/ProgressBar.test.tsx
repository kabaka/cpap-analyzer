import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProgressBar } from '@/components/ui/ProgressBar/ProgressBar';

/**
 * ProgressBar is a determinate/indeterminate progress primitive shared across
 * surfaces. These tests pin its accessibility contract and the presentational
 * `size` / `tone` modifiers without coupling to exact CSS-module hash names
 * (we assert via the data attributes and class-token suffixes the component
 * applies through the CSS-module map).
 */
describe('ProgressBar', () => {
  const getBar = (container: HTMLElement) => container.querySelector('[role="progressbar"]');
  const getFill = (container: HTMLElement) => container.querySelector('[role="progressbar"] > div');

  describe('accessibility (determinate)', () => {
    it('exposes role=progressbar with min/max/now in caller units', () => {
      const { container } = render(
        <ProgressBar value={37} max={1825} label="Analyzing" valueText="37 of 1825" />,
      );
      const bar = getBar(container);
      expect(bar?.getAttribute('aria-valuemin')).toBe('0');
      expect(bar?.getAttribute('aria-valuemax')).toBe('1825');
      expect(bar?.getAttribute('aria-valuenow')).toBe('37');
      expect(bar?.getAttribute('aria-valuetext')).toBe('37 of 1825');
      expect(bar?.getAttribute('aria-label')).toBe('Analyzing');
    });

    it('clamps value into [0, max]', () => {
      const { container } = render(<ProgressBar value={5000} max={1000} label="x" />);
      expect(getBar(container)?.getAttribute('aria-valuenow')).toBe('1000');
    });

    it('prefers labelledBy over label when both could apply', () => {
      const { container } = render(<ProgressBar value={1} max={2} labelledBy="heading-id" />);
      const bar = getBar(container);
      expect(bar?.getAttribute('aria-labelledby')).toBe('heading-id');
      expect(bar?.getAttribute('aria-label')).toBeNull();
    });
  });

  describe('accessibility (indeterminate)', () => {
    it('omits aria-valuenow / aria-valuemax when indeterminate', () => {
      const { container } = render(<ProgressBar indeterminate label="Loading" />);
      const bar = getBar(container);
      expect(bar?.getAttribute('aria-valuenow')).toBeNull();
      expect(bar?.getAttribute('aria-valuemax')).toBeNull();
      expect(bar?.getAttribute('aria-valuemin')).toBe('0');
    });
  });

  describe('size modifier', () => {
    it('does not add the compact class at the default (md) size', () => {
      const { container } = render(<ProgressBar value={1} max={2} label="x" />);
      expect(getBar(container)?.className ?? '').not.toContain('barSm');
    });

    it('adds the compact class for size="sm"', () => {
      const { container } = render(<ProgressBar value={1} max={2} label="x" size="sm" />);
      expect(getBar(container)?.className ?? '').toContain('barSm');
    });
  });

  describe('tone modifier', () => {
    it('adds no tone class for the default primary tone', () => {
      const { container } = render(<ProgressBar value={1} max={2} label="x" />);
      const cls = getFill(container)?.className ?? '';
      expect(cls).not.toContain('tone-');
    });

    it.each(['success', 'warning', 'error'] as const)('adds tone-%s for tone="%s"', (tone) => {
      const { container } = render(<ProgressBar value={1} max={2} label="x" tone={tone} />);
      expect(getFill(container)?.className ?? '').toContain(`tone-${tone}`);
    });
  });

  describe('paused (non-colour) state', () => {
    it('applies the paused modifier so a stopped bar never reads as complete', () => {
      const { container } = render(<ProgressBar value={1} max={2} label="x" paused />);
      expect(getBar(container)?.className ?? '').toContain('paused');
    });
  });

  describe('wrapper className passthrough', () => {
    it('merges a caller-provided className onto the wrapper', () => {
      const { container } = render(
        <ProgressBar value={1} max={2} label="x" className="custom-wrap" />,
      );
      expect(container.firstElementChild?.className ?? '').toContain('custom-wrap');
    });
  });
});
