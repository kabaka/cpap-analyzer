import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { QuotaEstimate } from '@/services/storage/OPFSService';

// ── OPFSService mock ──
// The StatusBar reads the storage estimate via `new OPFSService().getQuotaEstimate()`
// and gates on the static `OPFSService.isSupported()`. We mock both so each test
// can deterministically control support + the resolved/rejected estimate.
const getQuotaEstimate = vi.fn<() => Promise<QuotaEstimate>>();
const isSupported = vi.fn<() => boolean>();

vi.mock('@/services/storage/OPFSService', () => ({
  OPFSService: class {
    static isSupported() {
      return isSupported();
    }
    getQuotaEstimate() {
      return getQuotaEstimate();
    }
  },
}));

// Imported after the mock is registered.
import { StatusBar } from '@/components/layouts/StatusBar';
import { useDataStore } from '@/stores/useDataStore';

// The store's session-metadata value type is internal; StatusBar only reads
// `sessions.size`, so we derive the map type from the store's own state shape
// rather than depending on the (unexported) value interface.
type SessionsMap = ReturnType<typeof useDataStore.getState>['sessions'];
type SessionValue = SessionsMap extends Map<string, infer V> ? V : never;

/** Build a sessions Map of the requested size (values are not read by StatusBar). */
function makeSessions(count: number): SessionsMap {
  const map: SessionsMap = new Map();
  for (let i = 0; i < count; i++) {
    map.set(`s${i}`, {} as SessionValue);
  }
  return map;
}

function quota(usage: number, total: number): QuotaEstimate {
  return {
    usage,
    quota: total,
    percentUsed: total > 0 ? (usage / total) * 100 : 0,
  };
}

function resetDataStore() {
  useDataStore.setState({
    sessions: new Map(),
    sessionsRange: null,
    lastImportAt: null,
  });
}

describe('StatusBar', () => {
  beforeEach(() => {
    resetDataStore();
    isSupported.mockReturnValue(true);
    // Default: a non-trivial estimate so storage renders unless overridden.
    getQuotaEstimate.mockResolvedValue(quota(1_000_000, 10_000_000));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('corpus label', () => {
    it('shows an explicit empty message (never a bare dash) when no sessions are imported', async () => {
      render(<StatusBar />);
      expect(await screen.findByText('No sessions imported')).toBeInTheDocument();
      expect(screen.queryByText('—')).not.toBeInTheDocument();
    });

    it('uses the singular noun for exactly one session', async () => {
      useDataStore.setState({ sessions: makeSessions(1) });
      render(<StatusBar />);
      expect(await screen.findByText('1 session')).toBeInTheDocument();
    });

    it('uses the plural noun for multiple sessions', async () => {
      useDataStore.setState({ sessions: makeSessions(42) });
      render(<StatusBar />);
      expect(await screen.findByText('42 sessions')).toBeInTheDocument();
    });
  });

  describe('date coverage', () => {
    it('renders a month-year range derived from sessionsRange', async () => {
      useDataStore.setState({
        sessions: makeSessions(3),
        sessionsRange: {
          start: new Date('2024-01-15T00:00:00Z'),
          end: new Date('2025-06-15T00:00:00Z'),
        },
      });
      render(<StatusBar />);
      // Use a tolerant matcher: the exact month/year text depends on the
      // runtime locale, but it must contain both years separated by a dash.
      const coverage = await screen.findByText(/2024.*–.*2025/);
      expect(coverage).toBeInTheDocument();
    });

    it('omits the coverage item when there is no range', async () => {
      useDataStore.setState({ sessions: makeSessions(3), sessionsRange: null });
      render(<StatusBar />);
      await screen.findByText('3 sessions');
      expect(screen.queryByText(/–/)).not.toBeInTheDocument();
    });
  });

  describe('last-import timestamp', () => {
    it('shows relative text with the absolute time in the title attribute', async () => {
      const iso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
      useDataStore.setState({ sessions: makeSessions(1), lastImportAt: iso });
      render(<StatusBar />);

      const relative = await screen.findByText(/Imported .* ago/);
      expect(relative).toBeInTheDocument();

      // The absolute timestamp lives on the enclosing item's title attribute.
      const titled = relative.closest('[title]');
      expect(titled).not.toBeNull();
      expect(titled?.getAttribute('title')).toBe(new Date(iso).toLocaleString());
    });

    it('omits the import item when no import has occurred', async () => {
      useDataStore.setState({ sessions: new Map(), lastImportAt: null });
      render(<StatusBar />);
      await screen.findByText('No sessions imported');
      expect(screen.queryByText(/Imported/)).not.toBeInTheDocument();
    });
  });

  describe('storage meter', () => {
    it('shows usage, quota and a percentage', async () => {
      getQuotaEstimate.mockResolvedValue(quota(1_000_000, 10_000_000)); // ~10%
      render(<StatusBar />);
      const meter = await screen.findByText(/used \(\d+%\)/);
      expect(meter.textContent).toMatch(/of/);
      expect(meter.textContent).toMatch(/10%/);
    });

    it('applies the warning tone with a visible percentage at >= 80% usage', async () => {
      getQuotaEstimate.mockResolvedValue(quota(8_200_000, 10_000_000)); // 82%
      const { container } = render(<StatusBar />);
      await screen.findByText(/82%/);
      // The fill element carries a CSS-module tone class; assert a warning-ish
      // class is present rather than the exact hashed name.
      const fill = container.querySelector('[class*="meterFill"]');
      expect(fill?.className).toMatch(/meterWarning/i);
    });

    it('applies the error tone with a visible percentage at >= 95% usage', async () => {
      getQuotaEstimate.mockResolvedValue(quota(9_700_000, 10_000_000)); // 97%
      const { container } = render(<StatusBar />);
      await screen.findByText(/97%/);
      const fill = container.querySelector('[class*="meterFill"]');
      expect(fill?.className).toMatch(/meterError/i);
    });

    it('uses the normal tone below 80% usage', async () => {
      getQuotaEstimate.mockResolvedValue(quota(5_000_000, 10_000_000)); // 50%
      const { container } = render(<StatusBar />);
      await screen.findByText(/50%/);
      const fill = container.querySelector('[class*="meterFill"]');
      expect(fill?.className).toMatch(/meterNormal/i);
    });

    it('omits the storage item entirely when OPFS is unsupported', async () => {
      isSupported.mockReturnValue(false);
      render(<StatusBar />);
      // The corpus side still renders.
      await screen.findByText('No sessions imported');
      // No loading placeholder and no meter once we settle on "unsupported".
      await waitFor(() => {
        expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
      });
      expect(screen.queryByText(/used/)).not.toBeInTheDocument();
    });

    it('omits the storage item when the estimate reports a zero quota', async () => {
      getQuotaEstimate.mockResolvedValue(quota(0, 0));
      render(<StatusBar />);
      await waitFor(() => {
        expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
      });
      expect(screen.queryByText(/used/)).not.toBeInTheDocument();
    });

    it('omits the storage item when the estimate rejects', async () => {
      getQuotaEstimate.mockRejectedValue(new Error('quota unavailable'));
      render(<StatusBar />);
      await waitFor(() => {
        expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
      });
      expect(screen.queryByText(/used/)).not.toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows "Loading…" (never a bare dash) before the estimate resolves', async () => {
      let resolveEstimate: (e: QuotaEstimate) => void = () => {};
      getQuotaEstimate.mockReturnValue(
        new Promise<QuotaEstimate>((resolve) => {
          resolveEstimate = resolve;
        }),
      );

      render(<StatusBar />);
      expect(await screen.findByText('Loading…')).toBeInTheDocument();
      expect(screen.queryByText('—')).not.toBeInTheDocument();

      // Resolve to settle the pending effect and avoid act warnings.
      resolveEstimate(quota(1_000_000, 10_000_000));
      await screen.findByText(/used/);
    });
  });
});
