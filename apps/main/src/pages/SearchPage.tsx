import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage } from '@glazion/api-client';
import { isSearchGone, newSearchKey, searchApi, searchProblem, usesSampleData } from '@glazion/api-client/main';
import type { RecipeImageSearchRequest, SearchResultItem } from '@glazion/types';
import { Empty, ErrorState, formatRelativeTime } from '@glazion/ui';
import SampleNote from '../components/SampleNote';
import Results from '../components/search/Results';
import SearchForm, { type SearchStart, type Widen } from '../components/search/SearchForm';
import { filtersLabel, firingLabel } from '../lib/glaze';
import { scrollBehavior } from '../lib/motion';
import { usePageTitle } from '../lib/usePageTitle';
import { searchHistory, useSearchHistory } from '../lib/searchHistory';

interface Run {
  request: RecipeImageSearchRequest;
  /** What was searched for, for the list of recent searches. */
  label: string;
}

/** Fresh image links at most this often, so an image that can't load doesn't ask again and again. */
const REFRESH_GAP = 30_000;

const code = (err: unknown) => (err instanceof ApiError ? String((err.body as { code?: unknown } | undefined)?.code ?? '') : '');

/** Words for a search that didn't go through; the API's own message where it has one. */
function failure(err: unknown): { title: string; message: string; retry: boolean } {
  if (code(err) === 'feature_disabled') return { title: 'Search is paused', message: 'Tile search is switched off for now. Try again later.', retry: false };
  if (code(err) === 'idempotency_key_reused') return { title: 'The search didn’t go through', message: 'Run the search again.', retry: true };
  const temporary = !(err instanceof ApiError) || err.status >= 500;
  return { title: 'The search didn’t go through', message: errorMessage(err), retry: temporary };
}

export default function SearchPage() {
  const { searchId } = useParams<{ searchId: string }>();
  usePageTitle(searchId ? 'Matching tiles' : 'Find tiles');
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const resultsRef = useRef<HTMLElement>(null);
  const history = useSearchHistory();
  /** The last request and its key. Sending the same request again reuses the key, so a retry can't run it twice. */
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const lastRefresh = useRef(0);
  const [widen, setWiden] = useState<Widen | null>(null);
  /** The search whose results were last brought into view. */
  const shownFor = useRef<string | null>(null);

  // On narrow screens the results sit below the form, out of view.
  function showResults() {
    if (window.matchMedia('(max-width: 1100px)').matches) {
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }));
    }
  }

  const run = useMutation({
    mutationFn: ({ request }: Run) => {
      const body = JSON.stringify(request);
      if (attempt.current?.body !== body) attempt.current = { body, key: newSearchKey() };
      return searchApi.run(request, attempt.current.key);
    },
    onSuccess: (result, { request, label }) => {
      // Done: the next search, even an identical one, is a new search.
      attempt.current = null;
      queryClient.setQueryData(['search', result.searchId], result);
      const { coneMin, coneMax, atmosphere } = request.firing;
      searchHistory.add({
        searchId: result.searchId,
        label,
        firing: coneMin !== null || coneMax !== null || atmosphere ? firingLabel(request.firing) : '',
        filters: filtersLabel(request.filters, !!request.firing.strict),
        closest: result.closestMatch ? (result.closestMatch.source.recipeCode ?? result.closestMatch.source.recipeName) : null,
        createdAt: result.createdAt,
      });
      shownFor.current = result.searchId;
      navigate(`/search/${result.searchId}`);
      showResults();
    },
    // A failed search says so where the results go. A turned-down recipe is explained in the form instead.
    onError: (err) => {
      if (!searchProblem(err)) showResults();
    },
  });

  // Results live under their own URL so a search can be reopened or linked to from chat. Image
  // links are signed and expire, so they're never kept: reopening an older search fetches fresh ones.
  const saved = useQuery({
    queryKey: ['search', searchId],
    queryFn: () => searchApi.getOne(searchId!),
    enabled: !!searchId,
    staleTime: 5 * 60_000,
  });
  const rejection = run.isError ? searchProblem(run.error) : null;

  // Opening a search from Recent searches or a chat link shows its results too, once per search, the
  // same as running one does.
  useEffect(() => {
    // Back on the bare form: the next search opened shows its results again, even one seen before.
    if (!searchId) shownFor.current = null;
    if (!searchId || !saved.data || shownFor.current === searchId) return;
    shownFor.current = searchId;
    showResults();
  }, [searchId, saved.data]);

  // A search the API no longer has for this user comes off the recent list.
  const gone = !!searchId && saved.isError && isSearchGone(saved.error);
  useEffect(() => {
    if (gone) searchHistory.remove(searchId!);
  }, [gone, searchId]);

  const { refetch } = saved;
  const refreshImages = useCallback(() => {
    if (Date.now() - lastRefresh.current < REFRESH_GAP) return;
    lastRefresh.current = Date.now();
    void refetch();
  }, [refetch]);

  function findRecipe(item: SearchResultItem) {
    run.mutate({
      request: {
        query: { type: 'recipe', recipeId: item.source.recipeId! },
        firing: { coneMin: item.firing.coneMin, coneMax: item.firing.coneMax, atmosphere: item.firing.atmosphere },
        topK: 12,
        includeRecipeMetadata: true,
      },
      label: `Tiles like ${item.source.recipeCode ?? item.source.recipeName ?? 'a result'}`,
    });
  }

  let results;
  if (run.isPending || (searchId && saved.isPending)) {
    results = (
      // The closest match's outline while it loads, so the results don't jump in.
      <div className="results-wait" role="status">
        <p className="results-wait-text">
          <span className="spinner" /> Comparing against the tile library…
        </p>
        <div className="card closest" aria-hidden="true">
          <span className="closest-image skeleton-block" />
          <div className="closest-body">
            <span className="skeleton-line" style={{ width: '30%' }} />
            <span className="skeleton-line" style={{ width: '45%', height: 22 }} />
            <span className="skeleton-line" style={{ width: '38%', height: 28 }} />
            <span className="skeleton-line" style={{ width: '70%' }} />
          </div>
        </div>
      </div>
    );
  } else if (run.isError && !rejection) {
    const { title, message, retry } = failure(run.error);
    results = (
      <div className="card">
        <ErrorState title={title} message={message} onRetry={retry && run.variables ? () => run.mutate(run.variables!) : undefined} />
      </div>
    );
  } else if (searchId && saved.isError) {
    results = (
      <div className="card">
        <ErrorState
          title="This search isn’t available"
          message={gone ? 'It may have been run on another account, or it no longer exists. Run it again to see results.' : errorMessage(saved.error)}
          onRetry={gone ? undefined : () => saved.refetch()}
        />
      </div>
    );
  } else if (searchId && saved.data) {
    results = (
      <Results
        key={saved.data.searchId}
        search={saved.data}
        searched={history.find((past) => past.searchId === saved.data.searchId)}
        onImageError={refreshImages}
        onFindRecipe={findRecipe}
        onWiden={(what) => setWiden({ what, at: Date.now() })}
      />
    );
  } else {
    results = (
      <>
        <div className="card">
          <Empty
            icon="image"
            title="Your matches will appear here"
            text="Enter a recipe or a UMF and the cone you fire to. You’ll get the closest photographed tile and similar glazes, with a breakdown of why each one matched."
          />
        </div>
        {history.length > 0 && (
          <section className="card recent">
            <div className="card-head">
              <h2 className="card-title">Recent searches</h2>
            </div>
            <ul className="recent-list">
              {history.map((past) => (
                <li key={past.searchId}>
                  <Link to={`/search/${past.searchId}`} className="recent-item">
                    <span className="recent-label">{past.label}</span>
                    <span className="hint">
                      {[past.firing, past.closest && `Closest: ${past.closest}`, formatRelativeTime(past.createdAt)].filter(Boolean).join(' · ')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  // The calculator can hand over a UMF and cone to start from.
  const start = (location.state as SearchStart | null) ?? {};

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Find tiles</h1>
          <p className="page-sub">See real fired tiles close to your glaze.</p>
        </div>
        {searchId && history.length > 0 && (
          <Link to="/search" className="btn btn-secondary btn-sm">
            Recent searches
          </Link>
        )}
      </header>

      <div className="content content-wide">
        {usesSampleData('search') && (
          <SampleNote>Search isn’t connected to the tile library yet. The tiles and scores below are placeholders to show how it will work.</SampleNote>
        )}

        <div className="search-layout">
          <SearchForm start={start} pending={run.isPending} rejection={rejection} widen={widen} onSubmit={(request, label) => run.mutate({ request, label })} />
          <section className="search-results" aria-live="polite" ref={resultsRef}>
            {results}
          </section>
        </div>
      </div>
    </>
  );
}
