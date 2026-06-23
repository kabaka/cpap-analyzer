/**
 * Tests for the shared {@link ModelDownloadProgress} block — phase copy,
 * indeterminate ARIA, and the Cancel affordance.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ModelDownloadProgress } from '../ModelDownloadProgress';

describe('ModelDownloadProgress', () => {
  it('renders determinate downloading copy with the percent and a progressbar value', () => {
    render(
      <ModelDownloadProgress
        variant="drawer"
        phase="downloading"
        fraction={0.42}
        statusText="Fetching param 12/38"
        sizeLabel="~1.9 GB"
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Downloading model — 42%')).toBeInTheDocument();
    expect(screen.getByText(/one-time download/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is uploaded/i)).toBeInTheDocument();
    // The model's own status text is rendered (plain text).
    expect(screen.getByText(/Fetching param 12\/38/)).toBeInTheDocument();

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuetext', expect.stringContaining('42 percent'));
  });

  it('renders the warm-up (loading) copy distinct from downloading', () => {
    render(
      <ModelDownloadProgress
        variant="settings"
        phase="loading"
        fraction={null}
        statusText=""
        sizeLabel="~1.9 GB"
      />,
    );
    expect(screen.getByText('Preparing the model on your device…')).toBeInTheDocument();
    expect(screen.getByText(/warming up the model/i)).toBeInTheDocument();
  });

  it('is indeterminate (omits aria-valuenow) when fraction is null', () => {
    render(
      <ModelDownloadProgress
        variant="settings"
        phase="downloading"
        fraction={null}
        statusText=""
        sizeLabel="~1.9 GB"
      />,
    );
    expect(screen.getByText('Starting download…')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
  });

  it('shows the drawer heading only in the drawer variant', () => {
    const { rerender } = render(
      <ModelDownloadProgress
        variant="drawer"
        phase="downloading"
        fraction={0.1}
        statusText=""
        sizeLabel="~1.9 GB"
      />,
    );
    expect(screen.getByText('Preparing the on-device model')).toBeInTheDocument();

    rerender(
      <ModelDownloadProgress
        variant="settings"
        phase="downloading"
        fraction={0.1}
        statusText=""
        sizeLabel="~1.9 GB"
      />,
    );
    expect(screen.queryByText('Preparing the on-device model')).not.toBeInTheDocument();
  });

  it('calls onCancel when Cancel is activated', async () => {
    const onCancel = vi.fn();
    render(
      <ModelDownloadProgress
        variant="drawer"
        phase="downloading"
        fraction={0.5}
        statusText=""
        sizeLabel="~1.9 GB"
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('omits Cancel when no handler is provided', () => {
    render(
      <ModelDownloadProgress
        variant="settings"
        phase="downloading"
        fraction={0.5}
        statusText=""
        sizeLabel="~1.9 GB"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });
});
