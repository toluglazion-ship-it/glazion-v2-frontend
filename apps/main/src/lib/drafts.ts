import { getStoredUser } from '@glazion/api-client';

// Work not sent yet: the search form, a chat message, the sign-up fields. Kept for this tab only, so
// going to another page and coming back (or reloading) doesn't lose it, and kept per account, so a
// shared computer doesn't show it to the next person who signs in.

const draftKey = (name: string) => `glazion_draft_${name}_${getStoredUser()?.id ?? 'guest'}`;

export const drafts = {
  read<T>(name: string): T | null {
    try {
      const raw = sessionStorage.getItem(draftKey(name));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  /** null clears it. */
  write(name: string, value: unknown) {
    try {
      if (value === null) sessionStorage.removeItem(draftKey(name));
      else sessionStorage.setItem(draftKey(name), JSON.stringify(value));
    } catch {
      // Full or blocked storage: the draft still holds while the page is open.
    }
  },
};

/** The firing of the last search run, to start the next one from. Kept in this browser per account. */
export interface Firing {
  coneFrom: string;
  coneTo: string;
  atmosphere: string;
}

const firingKey = () => `glazion_last_firing_${getStoredUser()?.id ?? 'guest'}`;

export const lastFiring = {
  read(): Firing | null {
    try {
      const raw = localStorage.getItem(firingKey());
      return raw ? (JSON.parse(raw) as Firing) : null;
    } catch {
      return null;
    }
  },
  write(firing: Firing) {
    try {
      localStorage.setItem(firingKey(), JSON.stringify(firing));
    } catch {
      // Full or blocked storage: the next search starts from Any.
    }
  },
};
