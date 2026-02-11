import { describe, it, expect } from 'vitest';
import { render, screen } from '@test/test-utils';
import { Skeleton } from '@/components/ui/Skeleton';

describe('Skeleton', () => {
  it('should render with correct variant class for "text"', () => {
    const { container } = render(<Skeleton variant="text" />);
    expect(container.firstElementChild?.className).toContain('text');
  });

  it('should render with correct variant class for "circle"', () => {
    const { container } = render(<Skeleton variant="circle" />);
    expect(container.firstElementChild?.className).toContain('circle');
  });

  it('should render with correct variant class for "rect"', () => {
    const { container } = render(<Skeleton variant="rect" />);
    expect(container.firstElementChild?.className).toContain('rect');
  });

  it('should default to "text" variant', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild?.className).toContain('text');
  });

  it('should apply custom width via style', () => {
    const { container } = render(<Skeleton width={200} />);
    const el = container.firstElementChild as HTMLElement;
    // The component uses useEffect to set style, so check after render
    expect(el.style.width).toBe('200px');
  });

  it('should apply custom height via style', () => {
    const { container } = render(<Skeleton height="3rem" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.height).toBe('3rem');
  });

  it('should have role="status" and aria-label for accessibility', () => {
    render(<Skeleton />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('aria-label', 'Loading');
  });
});
