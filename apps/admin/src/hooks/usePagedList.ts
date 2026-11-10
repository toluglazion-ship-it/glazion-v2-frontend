import { useMemo } from 'react';
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import type { PagedResult } from '@glazion/types';

export const PAGE_SIZE = 50;

/** Cursor-paged list: `items` is every page loaded so far, `total` is what the server says exists. */
export function usePagedList<T>(queryKey: QueryKey, fetchPage: (cursor?: string) => Promise<PagedResult<T>>) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items ?? []) ?? [], [query.data]);
  const total = query.data?.pages[0]?.totalCount ?? 0;

  return { ...query, items, total };
}
