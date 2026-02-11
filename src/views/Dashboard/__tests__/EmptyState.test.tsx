import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { EmptyState } from '@/views/Dashboard/EmptyState';

describe('EmptyState', () => {
  it('should render the welcome heading', () => {
    render(<EmptyState />);

    expect(screen.getByText('CPAP Analyzer')).toBeInTheDocument();
  });

  it('should render the subtitle description', () => {
    render(<EmptyState />);

    expect(screen.getByText(/comprehensive cpap therapy analysis/i)).toBeInTheDocument();
  });

  it('should render the privacy badge', () => {
    render(<EmptyState />);

    expect(screen.getByText(/all data processing happens locally/i)).toBeInTheDocument();
  });

  it('should render an Import Your Data button', () => {
    render(<EmptyState />);

    const importButton = screen.getByRole('button', { name: /import your data/i });
    expect(importButton).toBeInTheDocument();
  });

  it('should render a Learn More link', () => {
    render(<EmptyState />);

    const learnMore = screen.getByText('Learn More');
    expect(learnMore).toBeInTheDocument();
    expect(learnMore.closest('a')).toHaveAttribute('href', '/help');
  });
});
