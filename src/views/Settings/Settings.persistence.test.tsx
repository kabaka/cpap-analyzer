import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@test/test-utils';
import userEvent from '@testing-library/user-event';
import type { PersistenceStatus } from '@/services/storage/persistentStorage';

// ── Mock the persistent-storage service ────────────────────────────────────
// DataPersistenceCard is an internal component of the Settings view, exercised
// here through the rendered view. Mocking the service lets us drive every
// durability outcome deterministically without touching navigator.storage.
const isPersistenceApiAvailable = vi.fn<() => boolean>();
const isStoragePersisted = vi.fn<() => Promise<boolean>>();
const requestPersistentStorage = vi.fn<() => Promise<PersistenceStatus>>();

vi.mock('@/services/storage/persistentStorage', () => ({
  isPersistenceApiAvailable: () => isPersistenceApiAvailable(),
  isStoragePersisted: () => isStoragePersisted(),
  requestPersistentStorage: () => requestPersistentStorage(),
}));

// clearAllUserData is only invoked on an explicit user action (the Clear-data
// dialog) which these tests never trigger; stub it so the module graph stays
// free of IndexedDB/OPFS side effects.
vi.mock('@/services/storage/clearAllUserData', () => ({
  clearAllUserData: vi.fn().mockResolvedValue(undefined),
}));

import Settings from './Settings';

/**
 * Render the Settings view and switch to the "Privacy & Storage" tab, which is
 * where DataPersistenceCard lives. Returns the Storage Usage card scope so
 * assertions are confined to the persistence indicator. Awaits the on-mount
 * `isStoragePersisted()` probe by waiting for the loading text to clear, unless
 * the API is reported unavailable (no probe runs in that case).
 */
async function renderPersistenceCard(options: { expectUnsupported?: boolean } = {}) {
  const user = userEvent.setup();
  render(<Settings />);

  await user.click(screen.getByRole('tab', { name: 'Privacy & Storage' }));

  // The Storage Usage card heading anchors the persistence indicator.
  const heading = await screen.findByRole('heading', { name: 'Storage Usage' });
  const card = heading.closest('div');
  if (!card) throw new Error('Storage Usage card container not found');
  const scope = within(card as HTMLElement);

  if (!options.expectUnsupported) {
    // Let the mounted isStoragePersisted() probe resolve.
    await waitFor(() =>
      expect(scope.queryByText(/Checking data persistence/i)).not.toBeInTheDocument(),
    );
  }

  return { user, scope };
}

describe('DataPersistenceCard (via Settings → Privacy & Storage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Sensible defaults; individual tests override as needed.
    isPersistenceApiAvailable.mockReturnValue(true);
    isStoragePersisted.mockResolvedValue(false);
    requestPersistentStorage.mockResolvedValue('denied');
  });

  it('shows only the unsupported note when the persistence API is unavailable', async () => {
    isPersistenceApiAvailable.mockReturnValue(false);

    const { scope } = await renderPersistenceCard({ expectUnsupported: true });

    expect(scope.getByText(/not supported in this browser/i)).toBeInTheDocument();
    expect(scope.queryByRole('button', { name: 'Protect my data' })).not.toBeInTheDocument();
    // The on-mount probe is gated by availability and must not run.
    expect(isStoragePersisted).not.toHaveBeenCalled();
  });

  it('shows the Protected state with no action button when storage is already persisted', async () => {
    isStoragePersisted.mockResolvedValue(true);

    const { scope } = await renderPersistenceCard();

    expect(await scope.findByText('Protected')).toBeInTheDocument();
    expect(
      scope.getByText('Your data is protected from automatic browser cleanup.'),
    ).toBeInTheDocument();
    expect(scope.queryByRole('button', { name: 'Protect my data' })).not.toBeInTheDocument();
  });

  it('shows the Not protected state with an action button when storage is not persisted', async () => {
    isStoragePersisted.mockResolvedValue(false);

    const { scope } = await renderPersistenceCard();

    expect(await scope.findByText('Not protected')).toBeInTheDocument();
    expect(scope.getByText(/your browser may evict this data/i)).toBeInTheDocument();
    expect(scope.getByRole('button', { name: 'Protect my data' })).toBeInTheDocument();
  });

  it('calls requestPersistentStorage exactly once when the action button is clicked', async () => {
    isStoragePersisted.mockResolvedValue(false);
    // Keep the request pending so the click handler does not transition state
    // mid-assertion; we only care that the service is invoked once.
    requestPersistentStorage.mockReturnValue(new Promise<PersistenceStatus>(() => {}));

    const { user, scope } = await renderPersistenceCard();

    await user.click(await scope.findByRole('button', { name: 'Protect my data' }));

    expect(requestPersistentStorage).toHaveBeenCalledTimes(1);
  });

  it('flips to Protected and removes the button when the request resolves "persisted"', async () => {
    isStoragePersisted.mockResolvedValue(false);
    requestPersistentStorage.mockResolvedValue('persisted');

    const { user, scope } = await renderPersistenceCard();

    const button = await scope.findByRole('button', { name: 'Protect my data' });
    await user.click(button);

    // The polite aria-live region announces the resolved status.
    expect(await scope.findByText('Protected')).toBeInTheDocument();
    expect(
      scope.getByText('Your data is protected from automatic browser cleanup.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(scope.queryByRole('button', { name: 'Protect my data' })).not.toBeInTheDocument(),
    );

    // The status text lives inside the polite live region for SR announcement.
    const live = scope.getByText('Protected').closest('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  it('shows engagement/backstop guidance and keeps the button when the request resolves "denied"', async () => {
    isStoragePersisted.mockResolvedValue(false);
    requestPersistentStorage.mockResolvedValue('denied');

    const { user, scope } = await renderPersistenceCard();

    const button = await scope.findByRole('button', { name: 'Protect my data' });
    await user.click(button);

    // Guidance mentions engagement (bookmarking/installing) and exporting as a backstop.
    expect(await scope.findByText(/declined to protect this data/i)).toBeInTheDocument();
    const guidance = scope.getByText(/declined to protect this data/i);
    expect(guidance).toHaveTextContent(/bookmarking or installing the app/i);
    expect(guidance).toHaveTextContent(/export your data periodically/i);

    // The action remains available so the user can retry later.
    expect(scope.getByRole('button', { name: 'Protect my data' })).toBeInTheDocument();
  });

  it('marks the action button busy/disabled while the request is in flight', async () => {
    isStoragePersisted.mockResolvedValue(false);
    let resolveRequest!: (status: PersistenceStatus) => void;
    requestPersistentStorage.mockReturnValue(
      new Promise<PersistenceStatus>((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const { user, scope } = await renderPersistenceCard();

    const button = await scope.findByRole('button', { name: 'Protect my data' });
    await user.click(button);

    // While the promise is pending the button reflects its in-flight state.
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    expect(button).toBeDisabled();

    // Resolving the request clears the in-flight state.
    resolveRequest('denied');
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy', 'true'));
  });
});
