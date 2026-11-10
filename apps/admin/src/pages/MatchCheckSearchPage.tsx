import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { matchCheckApi } from '@glazion/api-client';
import type { SearchCheckDetail, SearchCheckResult } from '@glazion/types';
import { Icon, clayBodyLabel, formatDateTime } from '@glazion/ui';
import { LoadError, Loading } from '../components/ListState';
import { MaterialsCompare, MaterialsTable, TraceFacts, UmfComparison, stainsText } from '../components/Trace';
import { firingText } from '../lib/library';
import { QUERY_TYPE_LABEL, SHOWN_LABEL, amountText, scoreText } from '../lib/matchCheck';

function Searched({ search }: { search: SearchCheckDetail }) {
  const q = search.query;
  const who = search.requester ? `${search.requester.displayName ?? search.requester.username} (@${search.requester.username})` : 'Unknown';
  return (
    <section className="card match-query" aria-label="What was searched">
      <div className="card-head">
        <span className="card-title">What was searched</span>
        <span className="badge">{QUERY_TYPE_LABEL[q.type]}</span>
      </div>
      <div className="match-query-body">
        <div>
          {q.type === 'umf' ? (
            <p className="muted">Searched by UMF numbers, so there are no materials. Each tile below is compared with that UMF.</p>
          ) : (
            <>
              <div className="section-label">
                {q.materialsAsTyped ? (q.name ? `Typed as “${q.name}”` : 'As typed') : q.recipeCode ? `Recipe ${q.recipeCode}${q.recipeName ? ` · ${q.recipeName}` : ''}, as it is now` : 'Materials'}
              </div>
              <MaterialsTable
                materials={q.materials ?? []}
                empty="This search was made before searches kept what was typed. Its UMF is compared below."
              />
            </>
          )}
        </div>
        <dl className="facts">
          <div>
            <dt>Person</dt>
            <dd>{who}</dd>
          </div>
          <div>
            <dt>When</dt>
            <dd>{formatDateTime(search.createdAt)}</dd>
          </div>
          <div>
            <dt>Firing</dt>
            <dd>
              {firingText(q.coneMin, q.coneMax, q.atmosphere)}
              {q.strict && ' · exact'}
            </dd>
          </div>
          <div>
            <dt>Clay body</dt>
            <dd>{q.clayBodies.length > 0 ? q.clayBodies.map((c) => clayBodyLabel(c)).join(', ') : 'Any'}</dd>
          </div>
          <div>
            <dt>Stains</dt>
            <dd>{stainsText(q.colourants)}</dd>
          </div>
          <div>
            <dt>Tiles compared</dt>
            <dd>{search.candidateCount}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function Result({ result, search }: { result: SearchCheckResult; search: SearchCheckDetail }) {
  const trace = result.image;
  const recipe = trace?.recipes[0];
  const additions = recipe?.additions ?? [];
  const title = recipe?.code ?? recipe?.name ?? trace?.fileName ?? 'Tile';
  return (
    <section className="card match-result" aria-label={`${SHOWN_LABEL[result.shown]}: ${title}`}>
      <div className="card-head">
        <span className="match-result-title">
          <span className={result.shown === 'closest' ? 'badge badge-info' : 'badge'}>{SHOWN_LABEL[result.shown]}</span>
          {result.rank !== null && <span className="muted">#{result.rank}</span>}
          <span className="card-title">{title}</span>
        </span>
        <span className="match-result-score">
          {result.feedback === 'not_relevant' && <span className="badge badge-bad">Marked not relevant</span>}
          {result.feedback === 'relevant' && <span className="badge badge-ok">Marked relevant</span>}
          <span className="cell-strong">{scoreText(result.score)} match</span>
        </span>
      </div>
      {result.feedbackNote && (
        <div className="alert alert-warn match-note" role="note">
          <Icon name="message" size={18} />
          <span>“{result.feedbackNote}”</span>
        </div>
      )}
      {!trace ? (
        <p className="muted match-gone">This tile is no longer in the library.</p>
      ) : (
        <div className="match-result-body">
          <div className="match-photo">
            {trace.displayUrl ?? trace.thumbnailUrl ? (
              <a href={trace.displayUrl ?? trace.thumbnailUrl!} target="_blank" rel="noreferrer" title="Open full size">
                <img src={trace.displayUrl ?? trace.thumbnailUrl!} alt={title} />
              </a>
            ) : (
              <Icon name="image" size={32} />
            )}
          </div>
          <div className="match-side">
            <TraceFacts trace={trace} />
            {additions.length > 0 && (
              <p className="match-adds">
                Adds to its base: {additions.map((a) => `${amountText(a)} ${a.name}`).join(', ')}
              </p>
            )}
          </div>
          <div className="match-compare">
            <div className="section-label">Chemistry (UMF): searched against this tile</div>
            <UmfComparison rows={result.comparison} />
          </div>
          <div className="match-materials">
            <div className="section-label">{recipe ? `Recipe ${recipe.code ?? recipe.name}: searched against what the tile is made of` : 'The tile’s recipe'}</div>
            {!recipe ? (
              <p className="muted">No recipe linked to this tile, so there are no materials to compare.</p>
            ) : search.query.type === 'umf' || (search.query.materials ?? []).length === 0 ? (
              <MaterialsTable materials={recipe.materials} />
            ) : (
              <MaterialsCompare searched={search.query.materials ?? []} tile={recipe.materials} />
            )}
          </div>
          <details className="match-more">
            <summary>Why it was suggested</summary>
            <div className="match-more-body">
              <div>
                <div className="section-label">Score</div>
                <dl className="facts">
                  <div>
                    <dt>Chemistry</dt>
                    <dd>{scoreText(result.scoreBreakdown.chemistrySimilarity)}</dd>
                  </div>
                  <div>
                    <dt>Colorants</dt>
                    <dd>{scoreText(result.scoreBreakdown.colourantSimilarity)}</dd>
                  </div>
                  <div>
                    <dt>Firing</dt>
                    <dd>{scoreText(result.scoreBreakdown.firingCompatibility)}</dd>
                  </div>
                  <div>
                    <dt>Labels and text</dt>
                    <dd>{scoreText(result.scoreBreakdown.labelOrTextSimilarity)}</dd>
                  </div>
                </dl>
                {result.limitations.length > 0 && (
                  <ul className="match-limits">
                    {result.limitations.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

/** One search: what was typed, then every tile it suggested, each traced to its source and compared oxide by oxide. */
export default function MatchCheckSearchPage() {
  const { searchId = '' } = useParams();
  const search = useQuery({ queryKey: ['match-check', searchId], queryFn: () => matchCheckApi.getOne(searchId) });

  return (
    <>
      <header className="page-header">
        <div>
          <Link to="/match-check" className="back-link">
            <Icon name="chevron-left" size={16} />
            Match check
          </Link>
          <h1 className="page-title">Search check</h1>
          <p className="page-sub">What was searched, beside each tile it suggested and where that tile came from.</p>
        </div>
      </header>

      <div className="content">
        {search.isPending ? (
          <div className="card">
            <Loading />
          </div>
        ) : search.isError ? (
          <div className="card">
            <LoadError error={search.error} onRetry={() => search.refetch()} />
          </div>
        ) : (
          <>
            <Searched search={search.data} />
            {search.data.results.length === 0 ? (
              <div className="alert alert-info" role="note">
                <Icon name="info" size={18} />
                <span>No tile was close enough to suggest.</span>
              </div>
            ) : (
              search.data.results.map((r, i) => <Result key={`${r.image?.imageId ?? i}-${r.shown}`} result={r} search={search.data} />)
            )}
          </>
        )}
      </div>
    </>
  );
}

