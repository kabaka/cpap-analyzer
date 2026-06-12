import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';

// Mock the two heavy child analyses: this view is purely compositional, so the
// child analytics are tested in their own suites. Here we verify the tab
// composition and URL deep-linking behaviour only.
vi.mock('../StatisticalAnalysis', () => ({
  StatisticalAnalysis: () => <div data-testid="statistical-analysis">Statistical Analysis</div>,
}));
vi.mock('../IntegrationAnalysis', () => ({
  default: () => <div data-testid="cross-source-analysis">Cross-Source Analysis</div>,
}));
vi.mock('../Correlations.module.css', () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { Correlations } from '@/views/Explore/Correlations';

/** Surfaces the current location so assertions can read the synced URL. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Correlations />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('Correlations', () => {
  it('renders the page heading and both tab triggers', () => {
    renderAt('/explore/correlations');

    expect(screen.getByRole('heading', { name: /^correlations$/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /statistical/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /cross-source/i })).toBeInTheDocument();
  });

  it('defaults to the Statistical tab when no tab query param is present', () => {
    renderAt('/explore/correlations');

    expect(screen.getByRole('tab', { name: /statistical/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('statistical-analysis')).toBeInTheDocument();
  });

  it('deep-links to the Cross-source tab via ?tab=cross-source', () => {
    renderAt('/explore/correlations?tab=cross-source');

    expect(screen.getByRole('tab', { name: /cross-source/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('cross-source-analysis')).toBeInTheDocument();
  });

  it('updates the URL query param when switching tabs', async () => {
    const user = userEvent.setup();
    renderAt('/explore/correlations');

    await user.click(screen.getByRole('tab', { name: /cross-source/i }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/explore/correlations?tab=cross-source',
    );

    // Switching back to the default tab clears the param for clean URLs.
    await user.click(screen.getByRole('tab', { name: /statistical/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/explore/correlations');
    expect(screen.getByTestId('location')).not.toHaveTextContent('tab=');
  });
});
