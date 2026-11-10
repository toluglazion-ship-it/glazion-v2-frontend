import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Whether the phone is set to reduce motion, kept up to date if it's changed while the app is open. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => active && setReduced(on));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}
