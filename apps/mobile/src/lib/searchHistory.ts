import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getStoredUser } from '@glazion/api-client';
import type { RecipeImageSearchRequest } from '@glazion/types';
import type { SearchForm } from './searchForm';

// Recent searches are kept on this phone, one list per account. The search itself is kept, so it can
// be edited or run again, but never image links: those expire, so a search is reopened from the API
// to get fresh ones.

export interface PastSearch {
  searchId: string;
  /** What was searched for, e.g. "Custer Feldspar, Silica +3 more". */
  label: string;
  /** "Cone 6 · Oxidation", or empty. */
  firing: string;
  /** The filters chosen, e.g. "Porcelain · Glossy", or empty. Missing on searches saved before 20 Oct 2026. */
  filters?: string;
  /** What was sent, to run it again. */
  request?: RecipeImageSearchRequest;
  /** The form as it was, to edit it. Not there for searches started from a result. */
  form?: SearchForm;
  /** Lab code of the closest match, when there was one. */
  closest: string | null;
  createdAt: string;
}

const LIMIT = 20;
const storageKey = () => `glazion_searches_${getStoredUser()?.id ?? 'guest'}`;
const QUERY_KEY = ['search-history'];
const NONE: PastSearch[] = [];

async function read(): Promise<PastSearch[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey());
    return raw ? (JSON.parse(raw) as PastSearch[]) : NONE;
  } catch {
    // Unreadable storage is treated as no history.
    return NONE;
  }
}

/** Recent searches, newest first, with the two ways to change them. */
export function useSearchHistory() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: read, staleTime: Infinity });

  // Each change starts from what's stored, not from this render's list, so two quick changes
  // don't undo each other.
  async function change(update: (list: PastSearch[]) => PastSearch[]) {
    const next = update(await read());
    queryClient.setQueryData(QUERY_KEY, next);
    try {
      await AsyncStorage.setItem(storageKey(), JSON.stringify(next));
    } catch {
      // Full or blocked storage: the list still holds until the app closes.
    }
  }

  return {
    searches: query.data ?? NONE,
    add: (search: PastSearch) => change((list) => [search, ...list.filter((s) => s.searchId !== search.searchId)].slice(0, LIMIT)),
    /** For a search the API no longer has for this user. */
    remove: (searchId: string) => change((list) => list.filter((s) => s.searchId !== searchId)),
  };
}
