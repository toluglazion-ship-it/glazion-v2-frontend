import { useSyncExternalStore } from 'react';
import { getStoredUser } from '@glazion/api-client';

// Recent searches are kept in this browser, one list per account. Only the search id is kept, never
// image links: those expire, so a search is reopened from the API to get fresh ones.

export interface PastSearch {
  searchId: string;
  /** What was searched for, e.g. "Custer Feldspar, Silica +3 more". */
  label: string;
  /** "Cone 6 · Oxidation", or empty. */
  firing: string;
  /** The filters chosen, e.g. "Porcelain · Glossy", or empty. Missing on searches saved before 20 Oct 2026. */
  filters?: string;
  /** Lab code of the closest match, when there was one. */
  closest: string | null;
  createdAt: string;
}

const LIMIT = 20;

const key = () => `glazion_searches_${getStoredUser()?.id ?? 'guest'}`;

const NONE: PastSearch[] = [];
let cache: { key: string; list: PastSearch[] } | null = null;
const listeners = new Set<() => void>();

function read(): PastSearch[] {
  const current = key();
  if (cache?.key === current) return cache.list;
  let list = NONE;
  try {
    const raw = localStorage.getItem(current);
    if (raw) list = JSON.parse(raw) as PastSearch[];
  } catch {
    // Unreadable storage is treated as no history.
  }
  cache = { key: current, list };
  return list;
}

function write(list: PastSearch[]) {
  const current = key();
  cache = { key: current, list };
  try {
    localStorage.setItem(current, JSON.stringify(list));
  } catch {
    // Full or blocked storage: the list still holds for this visit.
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Recent searches, newest first. */
export function useSearchHistory(): PastSearch[] {
  return useSyncExternalStore(subscribe, read);
}

export const searchHistory = {
  add(search: PastSearch) {
    write([search, ...read().filter((s) => s.searchId !== search.searchId)].slice(0, LIMIT));
  },
  /** For a search the API no longer has for this user. */
  remove(searchId: string) {
    if (read().some((s) => s.searchId === searchId)) write(read().filter((s) => s.searchId !== searchId));
  },
};
