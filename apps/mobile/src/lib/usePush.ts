import { useRef } from 'react';
import { useRouter, type Href } from 'expo-router';

/** router.push that ignores a second tap a moment later, so a double tap doesn't open the same screen twice. */
export function usePush() {
  const router = useRouter();
  const last = useRef(0);
  return (href: Href) => {
    const now = Date.now();
    if (now - last.current < 700) return;
    last.current = now;
    router.push(href);
  };
}
