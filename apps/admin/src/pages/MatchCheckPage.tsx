import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { matchCheckApi } from '@glazion/api-client';
import type { SearchCheckSummary } from '@glazion/types';
import { Icon, formatDateTime } from '@glazion/ui';
import { Empty, LoadError, LoadMore, Loading } from '../components/ListState';
import { useDebounced } from '../hooks/useDebounced';
import { PAGE_SIZE, usePagedList } from '../hooks/usePagedList';
import { QUERY_TYPE_LABEL, scoreText } from '../lib/matchCheck';

type TypeFilter = '' | SearchCheckSummary['queryType'];

const TYPES: { key: TypeFilter; label: string }[] = [
  { key: '', label: 'All searches' },
  { key: 'raw_recipe', label: QUERY_TYPE_LABEL.raw_recipe },
  { key: 'recipe', label: QUERY_TYPE_LABEL.recipe },
  { key: 'umf', label: QUERY_TYPE_LABEL.umf },
];

/** What was searched, in a line: the typed name and rows, the recipe's code, or "a UMF". */
function searchedText(s: SearchCheckSummary): string {
  if (s.queryType === 'recipe') return s.recipeCode ?? 'A saved recipe';
  if (s.queryType === 'umf') return 'A UMF';
  return s.materials.length > 0 ? s.materials.join(', ') : 'A recipe (rows not kept on searches before 27 Oct)';
}

/**
 * Every search, newest first, with what it suggested at the top. Opening one shows what was searched beside each tile it
 * suggested, so an admin can check the chemistry agrees before results go public. Every photo beside its own recipe is
 * on Tile check.
 */
export default function MatchCheckPage() {
  const [params] = useSearchParams();
  // The tile list used to be a tab here (?view=tiles); old links go to its own page.
  if (params.get('view') === 'tiles') return <Navigate to="/tile-check" replace />;
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Match check</h1>
          <p className="page-sub">Every search, with what was typed beside each tile it suggested. Only admins see this.</p>
        </div>
      </header>
      <div className="content">
        <SearchChecks />
      </div>
    </>
  );
}

function SearchChecks() {
  const navigate = useNavigate();
  const [type, setType] = useState<TypeFilter>('');
  const [flagged, setFlagged] = useState(false);
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim());

  const list = usePagedList<SearchCheckSummary>(['match-check', type, flagged, term], (cursor) =>
    matchCheckApi.list({ type: type || undefined, notRelevant: flagged || undefined, q: term || undefined, cursor, pageSize: PAGE_SIZE }),
  );

  return (
    <>
      <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="Kind of search">
            {TYPES.map((t) => (
              <button key={t.key} role="tab" aria-selected={type === t.key} className={type === t.key ? 'is-active' : ''} onClick={() => setType(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar">
          <div className="search">
            <Icon name="search" size={16} />
            <input className="input" placeholder="Search by person" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search by person" />
          </div>
          <label className="toolbar-check">
            <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} />
            Only searches with a result marked not relevant
          </label>
        </div>

        <div className="card">
          {list.isPending ? (
            <Loading />
          ) : list.isError ? (
            <LoadError error={list.error} onRetry={() => list.refetch()} />
          ) : list.items.length === 0 ? (
            <Empty
              icon="search"
              title={type || flagged || term ? 'Nothing here' : 'No searches yet'}
              text={type || flagged || term ? 'No search matches this view.' : 'When someone searches for tiles in the app, the search shows up here.'}
            />
          ) : (
            <div className="table-wrap">
              <table className="table table-clickable">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Person</th>
                    <th>Searched</th>
                    <th>Closest match</th>
                    <th className="num">Results</th>
                    <th aria-label="Flags" />
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((s) => (
                    <tr key={s.id} onClick={() => navigate(`/match-check/${s.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/match-check/${s.id}`)}>
                      <td className="cell-fit muted">{formatDateTime(s.createdAt)}</td>
                      <td>
                        {s.requester ? (
                          <span className="recipe-label">
                            <span className="cell-strong">{s.requester.displayName ?? s.requester.username}</span>
                            <span className="muted">@{s.requester.username}</span>
                          </span>
                        ) : (
                          <span className="muted">Unknown</span>
                        )}
                      </td>
                      <td className="cell-wide">
                        <span className="recipe-label">
                          <span className="recipe-label-head">
                            <span className="badge">{QUERY_TYPE_LABEL[s.queryType]}</span>
                            {s.name && <span className="cell-strong">{s.name}</span>}
                          </span>
                          <span className="muted cell-clamp">{searchedText(s)}</span>
                        </span>
                      </td>
                      <td>
                        {s.top ? (
                          <span className="match-top">
                            <span className="thumb">{s.top.thumbnailUrl ? <img src={s.top.thumbnailUrl} alt="" /> : <Icon name="image" size={18} />}</span>
                            <span className="recipe-label">
                              {s.top.recipeCode && <span className="tile-code">{s.top.recipeCode}</span>}
                              <span className="muted">{scoreText(s.topScore)} match</span>
                            </span>
                          </span>
                        ) : (
                          <span className="muted">No reliable match</span>
                        )}
                      </td>
                      <td className="num">{s.resultCount}</td>
                      <td className="cell-actions">
                        {s.notRelevant > 0 && (
                          <span className="badge badge-bad" title="Results the person marked not relevant">
                            {s.notRelevant} not relevant
                          </span>
                        )}
                        <Icon name="chevron-right" size={18} className="muted" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <LoadMore shown={list.items.length} total={list.total} hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => list.fetchNextPage()} />
        </div>
    </>
  );
}
