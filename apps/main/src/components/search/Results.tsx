import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { ColorantMaterial, RecipeImageSearchResponse, SearchResultItem } from '@glazion/types';
import { Empty, Icon, toneClass } from '@glazion/ui';
import { BAND, COLORANT_KIND, COLORANT_OXIDES, OTHER_OXIDES, OXIDE_GROUPS, OxideName, formatUmf, humanise, percent, recipeNameUnderCode, resultName, tileAlt, tileFacts, tileLooks, warningText } from '../../lib/glaze';
import type { PastSearch } from '../../lib/searchHistory';
import ResultModal from './ResultModal';
import TilePhoto from './TilePhoto';

interface Props {
  search: RecipeImageSearchResponse;
  /** What was asked for, from this browser's recent searches; unknown for a search opened from elsewhere. */
  searched?: PastSearch;
  /** Image links expire after 10 minutes; a failed image asks for the search again with fresh ones. */
  onImageError: () => void;
  /** Runs a new search for tiles like the recipe this result came from. */
  onFindRecipe: (item: SearchResultItem) => void;
  /** Searches again with the form's firing or filters cleared. */
  onWiden: (what: 'firing' | 'filters') => void;
}

export default function Results({ search, searched, onImageError, onFindRecipe, onWiden }: Props) {
  const best = search.closestMatch;
  const more = search.items.filter((item) => item.imageId !== best?.imageId);

  // The open tile is in the address (?tile=…), so the phone's Back button closes it like a page, and
  // a link can point straight at one tile.
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const tileId = params.get('tile');
  const open = tileId ? ([best, ...search.similar, ...search.items].find((item) => item?.imageId === tileId) ?? null) : null;
  const setOpen = (item: SearchResultItem) =>
    setParams(
      (p) => {
        p.set('tile', item.imageId);
        return p;
      },
      { state: { openedTile: true } },
    );
  const withoutTile = () =>
    setParams(
      (p) => {
        p.delete('tile');
        return p;
      },
      { replace: true },
    );
  // Opened here: step back, as Back would. Arrived on a link with the tile open: just drop it.
  const closeTile = () => ((location.state as { openedTile?: boolean } | null)?.openedTile ? navigate(-1) : withoutTile());

  // Weak matches are never shown as if they were answers: with no_reliable_match, say so instead.
  if (!best || search.warnings.includes('no_reliable_match')) {
    return (
      <>
        <SearchedFor searched={searched} />
        <div className="card">
          <Empty
            icon="image"
            title="No close match in the collection yet"
            text="No photographed tile is close enough to this glaze and firing to be worth showing. Try widening the cone range or removing a filter."
            action={
              // The advice as buttons, for what this search narrowed by (or both, when that isn't known).
              (!searched || searched.firing || searched.filters) && (
                <div className="empty-actions">
                  {(!searched || searched.firing) && (
                    <button type="button" className="btn btn-secondary" onClick={() => onWiden('firing')}>
                      Search any cone and atmosphere
                    </button>
                  )}
                  {(!searched || searched.filters) && (
                    <button type="button" className="btn btn-secondary" onClick={() => onWiden('filters')}>
                      Search without filters
                    </button>
                  )}
                </div>
              )
            }
          />
        </div>
        <SearchNotes search={search} />
        <YourRecipe search={search} />
      </>
    );
  }

  return (
    <>
      <SearchedFor searched={searched} />
      <ClosestMatch item={best} onOpen={() => setOpen(best)} onImageError={onImageError} />

      <SearchNotes search={search} />

      {search.similar.length > 0 && (
        <section className="results-section">
          <div className="results-head">
            <h2 className="results-count">Similar glazes</h2>
            <span className="muted">Other recipes, the closest photo of each</span>
          </div>
          <ul className="similar-strip">
            {search.similar.map((item) => (
              <li key={item.imageId}>
                <ResultCard item={item} onOpen={() => setOpen(item)} onImageError={onImageError} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <YourRecipe search={search} />

      {more.length > 0 && (
        <details className="more all-results">
          <summary>
            {/* Counts what the list below holds: everything but the closest match shown above. */}
            <h2 className="results-count">More results ({more.length})</h2>
            <Icon name="chevron-down" size={16} />
          </summary>
          <p className="muted">
            Best of {search.ranker.candidateCount} compared, ranked by how close each tile is to your glaze and firing. The same recipe can appear more than once.
          </p>
          <ul className="results">
            {more.map((item) => (
              <li key={item.imageId}>
                <ResultCard item={item} onOpen={() => setOpen(item)} onImageError={onImageError} />
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="evidence">
        These are photos of real fired tiles. A close match shows what a similar glaze has done before; it isn’t a promise that your glaze will
        fire the same way.
      </p>

      {open && (
        <ResultModal
          searchId={search.searchId}
          item={open}
          onClose={closeTile}
          onImageError={onImageError}
          onFindRecipe={(item) => {
            withoutTile();
            onFindRecipe(item);
          }}
        />
      )}
    </>
  );
}

/** The search these results answer, since the form may now show something else. */
function SearchedFor({ searched }: { searched?: PastSearch }) {
  if (!searched) return null;
  const parts = [searched.firing || 'Any firing', searched.filters].filter(Boolean);
  return (
    <p className="searched">
      Searched: <strong>{searched.label}</strong> · {parts.join(' · ')}
    </p>
  );
}

function ClosestMatch({ item, onOpen, onImageError }: { item: SearchResultItem; onOpen: () => void; onImageError: () => void }) {
  const band = BAND[item.confidenceBand];
  return (
    <article className="card closest">
      {/* The label says what the photo shows, and that it's generated when it is. */}
      <button className="closest-image" onClick={onOpen} aria-label={`Open ${tileAlt(item)}`}>
        {item.displayUrl ? <TilePhoto src={item.displayUrl} alt="" onError={onImageError} flagLowRes /> : <Icon name="image" size={36} />}
        {item.resultType === 'synthetic_preview' && <span className="result-flag">Generated preview, not a real tile</span>}
      </button>
      <div className="closest-body">
        <h2 className="hint closest-label">Closest match</h2>
        <div className="closest-title">
          {item.source.recipeCode ? <span className="tile-code tile-code-lg">{item.source.recipeCode}</span> : <strong>{resultName(item)}</strong>}
          {recipeNameUnderCode(item) && <span className="result-name">{recipeNameUnderCode(item)}</span>}
        </div>
        <div className="result-score">
          <strong>{percent(item.score)}</strong>
          <span className={toneClass(band.tone)}>{band.label}</span>
        </div>
        <span className="result-line">{tileFacts(item)}</span>
        {item.matchedFields.length > 0 && (
          <div className="chips-row">
            {item.matchedFields.map((field) => (
              <span key={field} className="chip is-static">
                {humanise(field)}
              </span>
            ))}
          </div>
        )}
        <button className="btn btn-secondary btn-sm closest-more" onClick={onOpen}>
          About this tile
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
    </article>
  );
}

function ResultCard({ item, onOpen, onImageError }: { item: SearchResultItem; onOpen: () => void; onImageError: () => void }) {
  const band = BAND[item.confidenceBand];
  return (
    <button className="result" onClick={onOpen}>
      <span className="result-thumb">
        {item.thumbnailUrl ? <TilePhoto src={item.thumbnailUrl} alt={tileLooks(item)} loading="lazy" onError={onImageError} /> : <Icon name="image" size={28} />}
        <span className="result-rank">#{item.rank}</span>
        {item.resultType === 'synthetic_preview' && <span className="result-flag">Generated preview</span>}
      </span>
      <span className="result-body">
        {item.source.recipeCode && <span className="tile-code">{item.source.recipeCode}</span>}
        {/* The recipe's name, so a tile without a lab code isn't anonymous. */}
        {item.source.recipeName && <span className="result-name">{item.source.recipeName}</span>}
        <span className="result-score">
          <strong>{percent(item.score)}</strong>
          <span className={toneClass(band.tone)}>{band.label}</span>
        </span>
        <span className="result-line">{tileFacts(item)}</span>
      </span>
    </button>
  );
}

/**
 * The chemistry the search used, and its colorants: metallic oxides, which are in the UMF, and stains, which aren't. For
 * a regular user the API leaves the chemistry out (the match is shown, not how it was worked out), so only the
 * colorants show.
 */
function YourRecipe({ search }: { search: RecipeImageSearchResponse }) {
  const { umf, colourants, colorantMaterials, recipeCode, type } = search.query;
  if (!umf && !colourants) return null;

  const present = Object.keys(umf ?? {}).filter((oxide) => (umf?.[oxide] ?? 0) > 0);
  const listed = new Set<string>([...OXIDE_GROUPS.flatMap((group) => group.oxides), ...COLORANT_OXIDES, ...OTHER_OXIDES]);
  const groups = [
    ...OXIDE_GROUPS.map((group) => ({ title: group.title, oxides: group.oxides.filter((oxide) => present.includes(oxide)) as string[] })),
    { title: 'Colorants (metallic oxides)', oxides: COLORANT_OXIDES.filter((oxide) => present.includes(oxide)) },
    // Anything outside the usual lists still shows.
    {
      title: 'Other oxides',
      oxides: [...OTHER_OXIDES.filter((oxide) => present.includes(oxide) && !COLORANT_OXIDES.includes(oxide)), ...present.filter((oxide) => !listed.has(oxide))],
    },
  ].filter((group) => group.oxides.length > 0);
  // A search made before the API listed every colorant only knows its stains.
  const colorants: ColorantMaterial[] | null =
    colorantMaterials ?? colourants?.map((c) => ({ materialId: c.materialId ?? '', name: c.name ?? c.materialId ?? 'unnamed', kind: 'stain', percentOfBase: c.percentOfBase })) ?? null;

  const title = !umf
    ? 'Colorants in your recipe'
    : type === 'recipe'
      ? `Chemistry of ${recipeCode ?? 'the recipe'}`
      : type === 'umf'
        ? 'The UMF you searched'
        : 'Your recipe’s chemistry';

  return (
    <section className="card recipe-chem">
      <div className="card-head">
        <h2 className="card-title">{title}</h2>
        {umf && <span className="hint">Unity formula: the fluxes add up to 1</span>}
      </div>
      {umf && (
        <div className="chem-groups">
          {groups.map((group) => (
            <div key={group.title} className="chem-group">
              <span className="note-label">{group.title}</span>
              <dl className="chem-list">
                {group.oxides.map((oxide) => (
                  <div key={oxide}>
                    <dt>
                      <OxideName oxide={oxide} />
                    </dt>
                    <dd>{formatUmf(umf[oxide]!)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
      {colorants &&
        (colorants.length === 0 ? (
          <p className="chem-stains">
            <strong>Colorants:</strong> none
          </p>
        ) : (
          <div className="chem-stains">
            <span className="note-label">Colorants</span>
            <ul className="colorant-list">
              {colorants.map((c) => (
                <li key={c.materialId || c.name}>
                  <span>{c.name}</span>
                  <span className={toneClass(COLORANT_KIND[c.kind]?.tone ?? 'neutral')}>{COLORANT_KIND[c.kind]?.label ?? c.kind}</span>
                  <strong>{Number(c.percentOfBase.toFixed(2))}%</strong>
                </li>
              ))}
            </ul>
            <span className="hint">Added on top of the base: parts per 100 parts of the rest of the recipe.</span>
          </div>
        ))}
    </section>
  );
}

const NO_ANALYSIS = 'no_oxide_analysis:';
const PARTIAL = ['chemistry_search_unavailable', 'text_search_unavailable'];
/** Notes the API adds that need nothing on screen. */
const SILENT = ['no_reliable_match', 'calculated_for_this_search', 'results_changed_since_search'];

/** The search's own notes: partial results, materials left out of the chemistry, data quality. */
function SearchNotes({ search }: { search: RecipeImageSearchResponse }) {
  const stains = new Set((search.query.colourants ?? []).map((c) => c.name));
  const partial = search.warnings.some((w) => PARTIAL.includes(w));
  const missing = search.warnings.filter((w) => w.startsWith(NO_ANALYSIS)).map((w) => w.slice(NO_ANALYSIS.length));
  const notStains = missing.filter((name) => !stains.has(name));
  const other = search.warnings
    .filter((w) => !w.startsWith(NO_ANALYSIS) && !PARTIAL.includes(w) && !SILENT.includes(w))
    .map(warningText)
    .filter((text): text is string => text !== null);
  if (!partial && notStains.length === 0 && other.length === 0) return null;

  return (
    <div className="search-notes">
      {partial && (
        <div className="alert alert-warn" role="status">
          <Icon name="alert" size={18} />
          <span>Part of the search was unavailable, so these results may be incomplete. Try again shortly.</span>
        </div>
      )}
      {notStains.length > 0 && (
        <div className="alert alert-info" role="note">
          <Icon name="info" size={18} />
          <span>
            {notStains.join(', ')} {notStains.length === 1 ? 'isn’t' : 'aren’t'} in our materials data, so {notStains.length === 1 ? 'it isn’t' : 'they aren’t'}{' '}
            counted. If {notStains.length === 1 ? 'it isn’t a stain' : 'they aren’t stains'}, pick another entry from the list.
          </span>
        </div>
      )}
      {other.length > 0 && (
        <ul className="plain-list hint">
          {other.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
