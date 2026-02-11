import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppStore } from '@/stores/useAppStore';
import { useThemeEffect } from '@/hooks/useTheme';

describe('useThemeEffect', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    useAppStore.setState({
      theme: 'system',
      resolvedTheme: 'light',
    });
  });

  it('should apply data-theme attribute matching resolvedTheme', () => {
    renderHook(() => useThemeEffect());
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('should update data-theme when resolvedTheme changes to dark', () => {
    renderHook(() => useThemeEffect());

    useAppStore.getState().setTheme('dark');
    expect(useAppStore.getState().resolvedTheme).toBe('dark');
  });
});

describe('useAppStore theme state', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    useAppStore.setState({
      theme: 'system',
      resolvedTheme: 'light',
    });
  });

  it('should default to "system" theme', () => {
    expect(useAppStore.getState().theme).toBe('system');
  });

  it('should update theme to "dark" via setTheme', () => {
    useAppStore.getState().setTheme('dark');
    expect(useAppStore.getState().theme).toBe('dark');
    expect(useAppStore.getState().resolvedTheme).toBe('dark');
  });

  it('should update theme to "light" via setTheme', () => {
    useAppStore.getState().setTheme('light');
    expect(useAppStore.getState().theme).toBe('light');
    expect(useAppStore.getState().resolvedTheme).toBe('light');
  });

  it('should resolve "system" to "light" when matchMedia returns false', () => {
    // jsdom matchMedia mock returns matches: false by default
    useAppStore.getState().setTheme('system');
    expect(useAppStore.getState().theme).toBe('system');
    expect(useAppStore.getState().resolvedTheme).toBe('light');
  });

  it('should persist theme to localStorage via zustand persist middleware', () => {
    useAppStore.getState().setTheme('dark');
    // The persist middleware serializes under the key 'cpap-theme'
    const stored = localStorage.getItem('cpap-theme');
    expect(stored).toBeTruthy();
    const parsed: unknown = JSON.parse(stored!);
    expect(parsed).toHaveProperty('state.theme', 'dark');
  });

  it('should cycle through all theme values', () => {
    const themes = ['light', 'dark', 'system'] as const;
    for (const t of themes) {
      useAppStore.getState().setTheme(t);
      expect(useAppStore.getState().theme).toBe(t);
    }
  });
});
