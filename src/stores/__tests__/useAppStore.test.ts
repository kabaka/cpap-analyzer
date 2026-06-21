import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/stores/useAppStore';

describe('useAppStore', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset store to initial state before each test
    useAppStore.setState({
      dateRange: (() => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);
        return { start, end };
      })(),
      selectedSessionId: null,
      theme: 'system',
      resolvedTheme: 'light',
      sidebarCollapsed: false,
      importStatus: 'idle',
      importProgress: { current: 0, total: 0 },
    });
  });

  describe('default state', () => {
    it('should have dateRange spanning the last 30 days', () => {
      const { dateRange } = useAppStore.getState();
      const diffMs = dateRange.end.getTime() - dateRange.start.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(30);
    });

    it('should have selectedSessionId as null', () => {
      expect(useAppStore.getState().selectedSessionId).toBeNull();
    });

    it('should have importStatus as "idle"', () => {
      expect(useAppStore.getState().importStatus).toBe('idle');
    });

    it('should have theme as "system"', () => {
      expect(useAppStore.getState().theme).toBe('system');
    });

    it('should have resolvedTheme as "light" when matchMedia is false', () => {
      // jsdom matchMedia returns matches: false by default
      expect(useAppStore.getState().resolvedTheme).toBe('light');
    });

    it('should have sidebarCollapsed default to false (expanded)', () => {
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });
  });

  describe('sidebar collapse', () => {
    it('setSidebarCollapsed(true) collapses the sidebar', () => {
      useAppStore.getState().setSidebarCollapsed(true);
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    });

    it('setSidebarCollapsed(false) expands the sidebar', () => {
      useAppStore.getState().setSidebarCollapsed(true);
      useAppStore.getState().setSidebarCollapsed(false);
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });

    it('toggleSidebarCollapsed flips the state from its current value', () => {
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
      useAppStore.getState().toggleSidebarCollapsed();
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);
      useAppStore.getState().toggleSidebarCollapsed();
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });

    it('persists sidebarCollapsed alongside theme in the localStorage payload', () => {
      useAppStore.getState().setSidebarCollapsed(true);
      const stored = localStorage.getItem('cpap-theme');
      expect(stored).toBeTruthy();
      const parsed: unknown = JSON.parse(stored!);
      // partialize persists { theme, sidebarCollapsed } under the state key.
      expect(parsed).toHaveProperty('state.sidebarCollapsed', true);
    });

    it('does not persist sidebarCollapsed=true when expanded (writes false)', () => {
      // Start collapsed (persisted true), then expand and confirm the payload
      // reflects the new value rather than leaving a stale true.
      useAppStore.getState().setSidebarCollapsed(true);
      useAppStore.getState().setSidebarCollapsed(false);
      const stored = localStorage.getItem('cpap-theme');
      const parsed: unknown = JSON.parse(stored!);
      expect(parsed).toHaveProperty('state.sidebarCollapsed', false);
    });
  });

  describe('persistence backward compatibility', () => {
    it('merges a theme-only payload (no sidebarCollapsed) to sidebarCollapsed=false', () => {
      // Simulate an older persisted payload that predates the sidebar feature.
      // zustand's persist `merge` should default the missing key to false.
      const legacyPayload = JSON.stringify({ state: { theme: 'dark' }, version: 0 });
      localStorage.setItem('cpap-theme', legacyPayload);

      // Re-run hydration from the stored value through the store's own merge fn.
      useAppStore.persist.rehydrate();

      const state = useAppStore.getState();
      expect(state.theme).toBe('dark');
      expect(state.sidebarCollapsed).toBe(false);
    });

    it('restores a persisted sidebarCollapsed=true on rehydrate', () => {
      const payload = JSON.stringify({
        state: { theme: 'light', sidebarCollapsed: true },
        version: 0,
      });
      localStorage.setItem('cpap-theme', payload);

      useAppStore.persist.rehydrate();

      const state = useAppStore.getState();
      expect(state.theme).toBe('light');
      expect(state.sidebarCollapsed).toBe(true);
    });
  });

  describe('setDateRange', () => {
    it('should update dateRange', () => {
      const newRange = {
        start: new Date('2025-01-01'),
        end: new Date('2025-06-01'),
      };
      useAppStore.getState().setDateRange(newRange);
      const { dateRange } = useAppStore.getState();
      expect(dateRange.start).toEqual(newRange.start);
      expect(dateRange.end).toEqual(newRange.end);
    });
  });

  describe('setSelectedSession', () => {
    it('should update selectedSessionId', () => {
      useAppStore.getState().setSelectedSession('session-123');
      expect(useAppStore.getState().selectedSessionId).toBe('session-123');
    });

    it('should allow setting to null', () => {
      useAppStore.getState().setSelectedSession('session-123');
      useAppStore.getState().setSelectedSession(null);
      expect(useAppStore.getState().selectedSessionId).toBeNull();
    });
  });

  describe('theme', () => {
    it('should update theme to "dark"', () => {
      useAppStore.getState().setTheme('dark');
      expect(useAppStore.getState().theme).toBe('dark');
      expect(useAppStore.getState().resolvedTheme).toBe('dark');
    });

    it('should update theme to "light"', () => {
      useAppStore.getState().setTheme('light');
      expect(useAppStore.getState().theme).toBe('light');
      expect(useAppStore.getState().resolvedTheme).toBe('light');
    });

    it('should resolve "system" to the OS preference', () => {
      // jsdom matchMedia returns matches: false → 'light'
      useAppStore.getState().setTheme('system');
      expect(useAppStore.getState().theme).toBe('system');
      expect(useAppStore.getState().resolvedTheme).toBe('light');
    });

    it('should persist theme to localStorage', () => {
      useAppStore.getState().setTheme('dark');
      const stored = localStorage.getItem('cpap-theme');
      expect(stored).toBeTruthy();
      const parsed: unknown = JSON.parse(stored!);
      expect(parsed).toHaveProperty('state.theme', 'dark');
    });
  });

  describe('import state', () => {
    it('should update importStatus', () => {
      useAppStore.getState().setImportStatus('scanning');
      expect(useAppStore.getState().importStatus).toBe('scanning');
    });

    it('should update importProgress', () => {
      useAppStore.getState().setImportProgress({ current: 5, total: 10 });
      expect(useAppStore.getState().importProgress).toEqual({
        current: 5,
        total: 10,
      });
    });

    it('should handle all importStatus transitions', () => {
      const statuses = ['scanning', 'importing', 'complete', 'error', 'idle'] as const;
      for (const status of statuses) {
        useAppStore.getState().setImportStatus(status);
        expect(useAppStore.getState().importStatus).toBe(status);
      }
    });
  });
});
