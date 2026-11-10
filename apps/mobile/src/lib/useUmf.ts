import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ApiError } from '@glazion/api-client';
import { umfApi } from '@glazion/api-client/main';
import { calculatorRow } from '@glazion/api-client/recipes';
import type { UmfCalculateRequest } from '@glazion/types';
import { useDebounced } from './useDebounced';

interface CalcRow {
  key: number;
  material: string;
  materialId: string | null;
  picked: boolean;
  amount: string;
}

/**
 * The backend's analysis of the recipe as it's typed. Edits are sent once typing pauses (300 ms),
 * and only the answer for the latest recipe is shown: one that arrives late for an older recipe
 * lands in its own cache entry and is never displayed. While a new answer is on its way the last
 * one stays on screen.
 *
 * `keys` lines the backend's skippedRows (by index) up with the rows on screen (by key).
 */
export function useUmfCalculation(rows: CalcRow[], cone: string) {
  // Rows still being filled in are left out rather than reported back as mistakes.
  const sent = rows.filter((row) => row.picked && row.material !== '' && row.amount.trim() !== '');
  const payload = JSON.stringify({ request: { cone, rows: sent.map(calculatorRow) } satisfies UmfCalculateRequest, keys: sent.map((row) => row.key) });
  const settled = useDebounced(payload, 300);

  const query = useQuery({
    queryKey: ['umf', settled],
    queryFn: async ({ signal }) => {
      const { request, keys } = JSON.parse(settled) as { request: UmfCalculateRequest; keys: number[] };
      return { response: await umfApi.calculate(request, signal), keys };
    },
    enabled: sent.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    // A 4xx won't fix itself; a dropped connection might.
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
  });

  const empty = sent.length === 0;
  return {
    calc: empty ? null : (query.data?.response ?? null),
    keys: empty ? [] : (query.data?.keys ?? []),
    /** Waiting on the first answer, or on one for a newer edit. */
    updating: !empty && (query.isFetching || settled !== payload),
    error: empty ? null : query.error,
    /** Fetch failed outright: no connection, or the server couldn't be reached. */
    offline: !empty && query.error instanceof TypeError,
    refetch: query.refetch,
  };
}
