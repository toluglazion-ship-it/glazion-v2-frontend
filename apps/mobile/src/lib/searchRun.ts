import { useRef } from 'react';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage } from '@glazion/api-client';
import { newSearchKey, searchApi } from '@glazion/api-client/main';
import type { RecipeImageSearchRequest } from '@glazion/types';
import { filtersLabel, firingLabel } from './labels';
import type { SearchForm } from './searchForm';
import { useSearchHistory } from './searchHistory';

export interface SearchRun {
  request: RecipeImageSearchRequest;
  /** What was searched for, for the list of recent searches. */
  label: string;
  /** The form it was run from, so it can be edited later. */
  form?: SearchForm;
}

/**
 * Runs a search, keeps it in the recent list and opens its results. Sending the same request again
 * after a failure reuses its Idempotency-Key, so a retry on a bad connection can't run it twice.
 */
export function useRunSearch({ replace = false }: { replace?: boolean } = {}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const history = useSearchHistory();
  const attempt = useRef<{ body: string; key: string } | null>(null);

  return useMutation({
    mutationFn: ({ request }: SearchRun) => {
      const body = JSON.stringify(request);
      if (attempt.current?.body !== body) attempt.current = { body, key: newSearchKey() };
      return searchApi.run(request, attempt.current.key);
    },
    onSuccess: (result, { request, label, form }) => {
      // Done: the next search, even an identical one, is a new search.
      attempt.current = null;
      queryClient.setQueryData(['search', result.searchId], result);
      const { coneMin, coneMax, atmosphere } = request.firing;
      void history.add({
        searchId: result.searchId,
        label,
        firing: coneMin !== null || coneMax !== null || atmosphere ? firingLabel(request.firing) : '',
        filters: filtersLabel(request.filters, !!request.firing.strict),
        request,
        form,
        closest: result.closestMatch ? (result.closestMatch.source.recipeCode ?? result.closestMatch.source.recipeName) : null,
        createdAt: result.createdAt,
      });
      // Run again from a search that's gone: its results take that screen's place.
      if (replace) router.replace(`/results/${result.searchId}`);
      else router.push(`/results/${result.searchId}`);
    },
  });
}

const code = (err: unknown) => (err instanceof ApiError ? String((err.body as { code?: unknown } | undefined)?.code ?? '') : '');

/** Words for a search that didn't go through, and whether trying again could help. */
export function searchFailure(err: unknown): { message: string; retry: boolean } {
  if (code(err) === 'feature_disabled') return { message: 'Search is paused. Tile search is switched off for now; try again later.', retry: false };
  if (err instanceof TypeError) return { message: 'You’re offline. Search needs an internet connection.', retry: true };
  return { message: errorMessage(err), retry: !(err instanceof ApiError) || err.status >= 500 };
}
