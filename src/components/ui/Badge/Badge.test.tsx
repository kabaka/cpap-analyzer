import { describe, it, expect } from 'vitest';
import { render, screen } from '@test/test-utils';
import { Badge } from '@/components/ui/Badge';

describe('Badge', () => {
  it('should render children text', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('should apply variant class', () => {
    const { container } = render(<Badge variant="success">Good</Badge>);
    const badge = container.firstElementChild;
    expect(badge?.className).toContain('success');
  });

  it('should apply default variant class when no variant specified', () => {
    const { container } = render(<Badge>Default</Badge>);
    const badge = container.firstElementChild;
    expect(badge?.className).toContain('default');
  });

  it('should apply size class', () => {
    const { container } = render(<Badge size="sm">Small</Badge>);
    const badge = container.firstElementChild;
    expect(badge?.className).toContain('sm');
  });

  it('should render as a span element', () => {
    const { container } = render(<Badge>Tag</Badge>);
    expect(container.firstElementChild?.tagName).toBe('SPAN');
  });
});
