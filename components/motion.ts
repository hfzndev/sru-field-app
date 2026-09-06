import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Motion, kept deliberately small.
 *
 * reanimated and worklets were already dependencies before this pass and so are
 * already compiled into the shipped APK — the binary cost is being paid whether
 * or not any JS uses them. What follows adds three uses and no more:
 *
 *   1. the save toast fades and lifts in
 *   2. inline confirm blocks expand in place
 *   3. big primary buttons take a press scale — computed synchronously in the
 *      Pressable style callback, NOT here, so the most-tapped control in the
 *      app never waits on a worklet to acknowledge a thumb
 *
 * Nothing animates on a list, nothing animates layout, and every duration is
 * under a quarter second. These handsets have 2 GB of RAM and an operator
 * waiting on them in the sun; motion here is for continuity, never decoration.
 */

export const DURATION = {
  fast: 120,
  base: 180,
  slow: 240,
} as const;

/**
 * Tracks the OS reduce-motion setting, including changes made while the app is
 * open — an operator who turns it on mid-shift should not have to restart.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let ignore = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => { if (!ignore) setReduced(value); })
      .catch(() => {});

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { ignore = true; sub.remove(); };
  }, []);

  return reduced;
}

/** Collapses any duration to a cut when reduce-motion is on. */
export function useDuration(ms: number): number {
  return useReducedMotion() ? 0 : ms;
}
