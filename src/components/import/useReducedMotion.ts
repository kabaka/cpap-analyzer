/**
 * Subscribe to the user's `prefers-reduced-motion` preference.
 *
 * Returns `true` when the user has requested reduced motion, so callers can swap
 * an animated indicator (e.g. the rotating spinner) for a static equivalent.
 * Local to the import UI to avoid touching shared hooks owned elsewhere.
 *
 * @module components/import/useReducedMotion
 */

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** Whether the user prefers reduced motion (reactive). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches);
    // Some older engines only expose addListener/removeListener.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return reduced;
}
