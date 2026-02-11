import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentErrorBoundary } from '@/components/errors/ComponentErrorBoundary';

function ThrowError({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Component error');
  return <div>No error</div>;
}

describe('ComponentErrorBoundary', () => {
  it('should render children when no error', () => {
    render(
      <ComponentErrorBoundary>
        <ThrowError shouldThrow={false} />
      </ComponentErrorBoundary>,
    );

    expect(screen.getByText('No error')).toBeInTheDocument();
  });

  it('should catch error and render default fallback', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ComponentErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ComponentErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('should show "Retry" button when error occurs', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ComponentErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ComponentErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('should reset the boundary when "Retry" button is clicked', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // First render with a child that always throws
    const { rerender } = render(
      <ComponentErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ComponentErrorBoundary>,
    );

    // Error boundary caught it, showing error UI
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    // Rerender with non-throwing child (boundary state persists, still showing error UI)
    rerender(
      <ComponentErrorBoundary>
        <ThrowError shouldThrow={false} />
      </ComponentErrorBoundary>,
    );

    // Click Retry to reset the boundary — now child renders successfully
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText('No error')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('should render custom fallback when provided', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ComponentErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowError shouldThrow={true} />
      </ComponentErrorBoundary>,
    );

    expect(screen.getByText('Custom fallback')).toBeInTheDocument();
    // Should not show the default UI
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('should have role="alert" on the default fallback container', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ComponentErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ComponentErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });
});
