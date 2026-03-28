import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '@/lib/theme';

describe('useTheme', () => {
  let mockMatchMedia: {
    matches: boolean;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');

    mockMatchMedia = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(mockMatchMedia),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial theme selection', () => {
    it('uses stored theme when available', () => {
      localStorage.setItem('matei_theme', 'dark');

      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('dark');
    });

    it('falls back to system light theme when no stored preference', () => {
      mockMatchMedia.matches = false; // prefers-color-scheme: light

      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('light');
    });

    it('falls back to system dark theme when no stored preference', () => {
      mockMatchMedia.matches = true; // prefers-color-scheme: dark

      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('dark');
    });

    it('ignores invalid stored theme values', () => {
      localStorage.setItem('matei_theme', 'neon-green');
      mockMatchMedia.matches = false;

      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('light');
    });
  });

  describe('applyTheme (DOM class)', () => {
    it('adds dark class to documentElement when theme is dark', () => {
      localStorage.setItem('matei_theme', 'dark');

      renderHook(() => useTheme());

      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('removes dark class from documentElement when theme is light', () => {
      document.documentElement.classList.add('dark');
      localStorage.setItem('matei_theme', 'light');

      renderHook(() => useTheme());

      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  describe('toggleTheme', () => {
    it('toggles from light to dark', () => {
      mockMatchMedia.matches = false;

      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('light');

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('dark');
      expect(localStorage.getItem('matei_theme')).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('toggles from dark to light', () => {
      localStorage.setItem('matei_theme', 'dark');

      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('dark');

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('light');
      expect(localStorage.getItem('matei_theme')).toBe('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('persists theme to localStorage on toggle', () => {
      mockMatchMedia.matches = false;

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.toggleTheme();
      });

      expect(localStorage.getItem('matei_theme')).toBe('dark');

      act(() => {
        result.current.toggleTheme();
      });

      expect(localStorage.getItem('matei_theme')).toBe('light');
    });
  });

  describe('system theme change listener', () => {
    it('registers a change listener on matchMedia', () => {
      renderHook(() => useTheme());

      expect(mockMatchMedia.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('removes listener on unmount', () => {
      const { unmount } = renderHook(() => useTheme());

      unmount();

      expect(mockMatchMedia.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('updates theme when system preference changes and no stored preference', () => {
      mockMatchMedia.matches = false;

      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('light');

      // Simulate system theme change
      const handler = mockMatchMedia.addEventListener.mock.calls[0][1] as (e: MediaQueryListEvent) => void;
      act(() => {
        handler({ matches: true } as MediaQueryListEvent);
      });

      expect(result.current.theme).toBe('dark');
    });

    it('ignores system preference change when user has stored preference', () => {
      localStorage.setItem('matei_theme', 'light');

      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('light');

      // Simulate system theme change
      const handler = mockMatchMedia.addEventListener.mock.calls[0][1] as (e: MediaQueryListEvent) => void;
      act(() => {
        handler({ matches: true } as MediaQueryListEvent);
      });

      // Should still be light since user explicitly chose it
      expect(result.current.theme).toBe('light');
    });
  });
});
