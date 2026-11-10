import { useEffect, useState } from 'react';

/** The value, once it has stopped changing for `ms`. Keeps a search box from firing a request per keystroke. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);

  return settled;
}
