import { useState } from 'react';
import { matchCheckApi } from '@glazion/api-client';
import type { ImageSourceType, ImageTrace } from '@glazion/types';
import { Icon } from '@glazion/ui';
import { Empty, LoadError, LoadMore, Loading } from '../components/ListState';
import { MaterialsTable, TraceFacts, UmfTable } from '../components/Trace';
import { useDebounced } from '../hooks/useDebounced';
import { usePagedList } from '../hooks/usePagedList';
import { amountText } from '../lib/matchCheck';

const SOURCES: { key: '' | ImageSourceType; label: string }[] = [
  { key: '', label: 'All photos' },
  { key: 'Import', label: 'Imported' },
  { key: 'UserUpload', label: 'Uploaded' },
];

function TileCheck({ trace }: { trace: ImageTrace }) {
  const recipe = trace.recipes[0];
  const title = recipe?.code ?? recipe?.name ?? trace.fileName ?? 'Photo';
  const photo = trace.displayUrl ?? trace.thumbnailUrl;
  return (
    <section className="card match-result" aria-label={title}>
      <div className="card-head">
        <span className="match-result-title">
          <span className="card-title">{title}</span>
          {recipe?.code && <span className="muted">{recipe.name}</span>}
        </span>
        <span className="match-result-score">
          {trace.approvalStatus !== 'Approved' && <span className="badge badge-warn">{trace.approvalStatus === 'Rejected' ? 'Rejected' : 'Not approved yet'}</span>}
        </span>
      </div>
      <div className="match-result-body">
        <div className="match-photo">
          {photo ? (
            <a href={photo} target="_blank" rel="noreferrer" title="Open full size">
              <img src={photo} alt={title} loading="lazy" />
            </a>
          ) : (
            <Icon name="image" size={32} />
          )}
        </div>
        <div className="match-side">
          <TraceFacts trace={trace} />
          {(recipe?.additions.length ?? 0) > 0 && (
            <p className="match-adds">Adds to its base: {recipe!.additions.map((a) => `${amountText(a)} ${a.name}`).join(', ')}</p>
          )}
        </div>
        <div className="match-compare">
          <div className="section-label">{recipe ? `Recipe ${recipe.code ?? recipe.name}` : 'Recipe'}</div>
          <MaterialsTable materials={recipe?.materials ?? []} empty="No recipe linked to this photo." />
          <div className="section-label tile-check-umf">
            Chemistry (UMF){trace.chemistry?.supplied ? ': supplied as numbers, not worked out from materials' : ''}
          </div>
          {trace.chemistry ? <UmfTable umf={trace.chemistry.umf} /> : <p className="muted">No chemistry linked.</p>}
        </div>
      </div>
    </section>
  );
}

/** Every photo, newest first, with its recipe and chemistry beside it: imported ones and new uploads alike. */
function TileChecks() {
  const [source, setSource] = useState<'' | ImageSourceType>('');
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim());
  const list = usePagedList<ImageTrace>(['match-check', 'tiles', source, term], (cursor) =>
    matchCheckApi.tiles({ source: source || undefined, q: term || undefined, cursor, pageSize: 20 }),
  );

  return (
    <>
      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Where the photo came from">
          {SOURCES.map((t) => (
            <button key={t.key} role="tab" aria-selected={source === t.key} className={source === t.key ? 'is-active' : ''} onClick={() => setSource(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="search">
          <Icon name="search" size={16} />
          <input className="input" placeholder="Lab code, recipe or file name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search photos" />
        </div>
      </div>
      {list.isPending ? (
        <div className="card">
          <Loading />
        </div>
      ) : list.isError ? (
        <div className="card">
          <LoadError error={list.error} onRetry={() => list.refetch()} />
        </div>
      ) : list.items.length === 0 ? (
        <div className="card">
          <Empty icon="image" title="No photos here" text={term || source ? 'No photo matches this view.' : 'Imported and uploaded photos show up here with their recipe.'} />
        </div>
      ) : (
        <>
          {list.items.map((t) => (
            <TileCheck key={t.imageId} trace={t} />
          ))}
          <div className="card">
            <LoadMore shown={list.items.length} total={list.total} hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => list.fetchNextPage()} />
          </div>
        </>
      )}
    </>
  );
}

/** Tile check: every photo in the library, imported or uploaded, beside the recipe and chemistry it claims to show. */
export default function TileCheckPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Tile check</h1>
          <p className="page-sub">Every photo beside the recipe and chemistry it claims to show, imported or uploaded. Only admins see this.</p>
        </div>
      </header>
      <div className="content">
        <TileChecks />
      </div>
    </>
  );
}
