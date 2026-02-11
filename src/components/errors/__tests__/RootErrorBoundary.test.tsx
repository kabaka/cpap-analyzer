import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RootErrorBoundary } from '@/components/errors/RootErrorBoundary';

function ThrowError({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test error');
  return <div>No error</div>;
}

describe('RootErrorBoundary', () => {
  it('should render children when no error', () => {
    render(
      <RootErrorBoundary>
        <ThrowError shouldThrow={false} />
      </RootErrorBoundary>,
    );

    expect(screen.getByText('No error')).toBeInTheDocument();
  });

  it('should catch error and render "Something went wrong" message', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <RootErrorBoundary>
        <ThrowError shouldThrow={true} />
      </RootErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test error')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('should show "Reload Application" button when error occurs', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <RootErrorBoundary>
        <ThrowError shouldThrow={true} />
      </RootErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Reload Application' })).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('should have role="alert" on the error container', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <RootErrorBoundary>
        <ThrowError shouldThrow={true} />
      </RootErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });
});
