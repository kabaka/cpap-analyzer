import { describe, it, expect } from 'vitest';
import { render, screen } from '@test/test-utils';
import { Card } from '@/components/ui/Card';

describe('Card', () => {
  it('should render children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(<Card className="custom-class">Content</Card>);
    const card = container.firstElementChild;
    expect(card?.className).toContain('custom-class');
  });

  it('should apply padded class by default', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstElementChild;
    expect(card?.className).toContain('padded');
  });

  it('should not apply padded class when padding is false', () => {
    const { container } = render(<Card padding={false}>Content</Card>);
    const card = container.firstElementChild;
    expect(card?.className).not.toContain('padded');
  });

  it('should render as a div element', () => {
    const { container } = render(<Card>Content</Card>);
    expect(container.firstElementChild?.tagName).toBe('DIV');
  });
});
