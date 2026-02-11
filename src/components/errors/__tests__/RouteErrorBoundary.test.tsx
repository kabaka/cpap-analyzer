import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RouteErrorBoundary } from '@/components/errors/RouteErrorBoundary';

function ThrowError({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Route error');
  return <div>No error</div>;
}

describe('RouteErrorBoundary', () => {
  it('should render children when no error', () => {
    render(
      <RouteErrorBoundary>
        <ThrowError shouldThrow={false} />
      </RouteErrorBoundary>,
    );

    expect(screen.getByText('No error')).toBeInTheDocument();
  });

  it('should catch error and render error message', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <RouteErrorBoundary>
        <ThrowError shouldThrow={true} />
      </RouteErrorBoundary>,
    );

    expect(screen.getByText('This view encountered an error')).toBeInTheDocument();
    expect(screen.getByText('Route error')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('should show "Go to Dashboard" and "Try Again" buttons', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <RouteErrorBoundary>
        <ThrowError shouldThrow={true} />
      </RouteErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Go to Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('should reset error state when "Try Again" is clicked', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // First render with a child that always throws
    const { rerender } = render(
      <RouteErrorBoundary>
        <ThrowError shouldThrow={true} />
      </RouteErrorBoundary>,
    );

    // Error boundary caught it, showing error UI
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();

    // Rerender with non-throwing child (boundary state persists, still showing error UI)
    rerender(
      <RouteErrorBoundary>
        <ThrowError shouldThrow={false} />
      </RouteErrorBoundary>,
    );

    // Click Try Again to reset the boundary — now child renders successfully
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(screen.getByText('No error')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('should have role="alert" on the error panel', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <RouteErrorBoundary>
        <ThrowError shouldThrow={true} />
      </RouteErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });
});
