import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, imagesApi, recipesApi } from '@glazion/api-client';
import type { ApprovalStatus, ChemistryStatus, ImageAssetDto, QualityStatus } from '@glazion/types';
import { Icon, Modal, formatBytes, formatDateTime, qualityStatusMeta, recipeTitle, toast, toneClass } from '@glazion/ui';
import { Empty, LoadError, Loading } from '../components/ListState';
import AiCopies from '../components/AiCopies';
import { MaterialsTable, UmfTable } from '../components/Trace';
import { useDebounced } from '../hooks/useDebounced';
import { usePagedList } from '../hooks/usePagedList';
import { approvalMeta, chemistryMeta, firingText, parseList, sentence, tileBodyLabel } from '../lib/library';

/** Photos per page; the API allows up to 200. */
const STEP = 60;

const APPROVAL_FILTERS: { label: string; value: ApprovalStatus | undefined }[] = [
  { label: 'Waiting', value: 'Pending' },
  { label: 'Approved', value: 'Approved' },
  { label: 'Rejected', value: 'Rejected' },
  { label: 'All', value: undefined },
];

/** The recipe a photo shows, picked by searching the register. */
function RecipePicker({ value, onChange }: { value: string; onChange: (recipeId: string) => void }) {
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim());
  const recipes = useQuery({
    queryKey: ['recipes', 'options', term],
    queryFn: () => recipesApi.list({ activeOnly: true, search: term || undefined, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  const options = recipes.data?.items ?? [];

  return (
    <div className="field">
      <span className="label">Which recipe is this?</span>
      <div className="search">
        <Icon name="search" size={16} />
        <input className="input" placeholder="Search by code or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search recipes" />
      </div>
      <ul className="pick-list" role="listbox" aria-label="Recipes">
        {options.map((r) => (
          <li key={r.id}>
            <button type="button" role="option" aria-selected={value === r.id} className={value === r.id ? 'is-picked' : ''} onClick={() => onChange(r.id)}>
              {r.code && <span className="tile-code">{r.code}</span>}
              <span className="truncate">{recipeTitle(r)}</span>
              {value === r.id && <Icon name="check" size={16} />}
            </button>
          </li>
        ))}
        {recipes.isSuccess && options.length === 0 && <li className="muted pick-empty">No active recipe matches.</li>}
      </ul>
      <span className="hint">Linking a recipe gives the photo its chemistry, which is what the search matches on.</span>
    </div>
  );
}

/** The photo's recipe (colorants marked) and its UMF, to check the photo is linked to the right chemistry. */
function TraceSection({ imageId }: { imageId: string }) {
  const trace = useQuery({ queryKey: ['images', imageId, 'trace'], queryFn: () => imagesApi.trace(imageId) });
  if (trace.isPending) return <p className="muted library-trace">Loading the recipe and chemistry…</p>;
  if (trace.isError || !trace.data) return null;
  const recipe = trace.data.recipes[0];
  return (
    <div className="library-trace">
      <div>
        <div className="section-label">{recipe ? `Recipe ${recipe.code ?? recipe.name}` : 'Recipe'}</div>
        <MaterialsTable materials={recipe?.materials ?? []} empty="No recipe linked, so no materials." />
      </div>
      <div>
        <div className="section-label">
          Chemistry (UMF){trace.data.chemistry?.supplied ? ': supplied as numbers, not worked out from materials' : ''}
        </div>
        {trace.data.chemistry ? <UmfTable umf={trace.data.chemistry.umf} /> : <p className="muted">No chemistry linked.</p>}
      </div>
    </div>
  );
}

function PhotoModal({ image, onClose }: { image: ImageAssetDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [recipeId, setRecipeId] = useState('');

  const approval = approvalMeta(image.approvalStatus);
  const quality = qualityStatusMeta(image.qualityStatus);
  const chemistry = chemistryMeta(image.chemistryStatus);
  const reasons = parseList(image.qualityReasonsJson);
  const links = image.recipes ?? [];
  const reviewable = image.approvalStatus === 'Pending' || image.approvalStatus === 'Rejected';
  // Without a recipe the photo has no chemistry and can't be found by a chemistry search.
  const needsRecipe = links.length === 0;

  function done(message: string) {
    queryClient.invalidateQueries({ queryKey: ['images'] });
    queryClient.invalidateQueries({ queryKey: ['search-index'] });
    toast(message);
    onClose();
  }

  const approve = useMutation({ mutationFn: () => imagesApi.approve(image.imageId, recipeId ? { recipeId } : {}), onSuccess: () => done('Photo approved') });
  const reject = useMutation({ mutationFn: () => imagesApi.reject(image.imageId, { reason: reason.trim() }), onSuccess: () => done('Photo rejected') });
  const remake = useMutation({
    mutationFn: () => imagesApi.rebuildDerivatives({ imageIds: [image.imageId], regenerate: true }),
    onSuccess: () => toast('The display size and thumbnail will be remade shortly'),
  });
  const busy = approve.isPending || reject.isPending;
  const failure = approve.error ?? reject.error ?? remake.error;

  let footer = (
    <button className="btn btn-secondary" onClick={() => remake.mutate()} disabled={remake.isPending}>
      {remake.isPending ? <span className="spinner" /> : <Icon name="refresh" size={18} />}
      Remake thumbnail
    </button>
  );
  if (reviewable && rejecting) {
    footer = (
      <>
        <button className="btn btn-secondary" onClick={() => setRejecting(false)} disabled={busy}>
          Back
        </button>
        <button className="btn btn-danger" onClick={() => reject.mutate()} disabled={!reason.trim() || busy}>
          {reject.isPending && <span className="spinner" />}
          Reject photo
        </button>
      </>
    );
  } else if (reviewable) {
    footer = (
      <>
        {image.approvalStatus === 'Pending' && (
          <button className="btn btn-danger" onClick={() => setRejecting(true)} disabled={busy}>
            Reject…
          </button>
        )}
        <button className="btn btn-primary" onClick={() => approve.mutate()} disabled={busy || (needsRecipe && !recipeId)}>
          {approve.isPending ? <span className="spinner" /> : <Icon name="check" size={18} />}
          {image.approvalStatus === 'Rejected' ? 'Approve after all' : 'Approve'}
        </button>
      </>
    );
  }

  const title = links[0]?.recipeCode ?? links[0]?.recipeName ?? image.externalRecordId ?? 'Library photo';

  return (
    <Modal
      title={title}
      description={image.sourceType === 'UserUpload' ? 'Sent from Capture' : image.externalRecordId && image.externalRecordId !== title ? `Imported as ${image.externalRecordId}` : 'Imported'}
      onClose={onClose}
      size="lg"
      footer={footer}
    >
      {failure && (
        <div className="alert" role="alert">
          <Icon name="alert" size={18} />
          <span>{errorMessage(failure)}</span>
        </div>
      )}
      <div className="review">
        <div className="review-image">
          {image.displayUrl ?? image.downloadUrl ? (
            <a href={image.downloadUrl ?? image.displayUrl!} target="_blank" rel="noreferrer" title="Open full size">
              <img src={image.displayUrl ?? image.downloadUrl!} alt={title} />
            </a>
          ) : (
            <Icon name="image" size={32} />
          )}
        </div>
        <div className="review-side">
          <dl className="facts">
            <div>
              <dt>Recipe</dt>
              <dd className="facts-recipe">
                {links.length === 0 && <span className="muted">None linked</span>}
                {links.map((l) => (
                  <span key={l.recipeId} className="facts-recipe">
                    {l.recipeCode && <span className="tile-code">{l.recipeCode}</span>}
                    {l.recipeName && l.recipeName !== l.recipeCode && <span>{l.recipeName}</span>}
                  </span>
                ))}
              </dd>
            </div>
            <div>
              <dt>Approval</dt>
              <dd>
                <span className={toneClass(approval.tone)}>{approval.label}</span>
              </dd>
            </div>
            <div>
              <dt>Photo check</dt>
              <dd>{quality ? <span className={toneClass(quality.tone)}>{quality.label}</span> : '—'}</dd>
            </div>
            <div>
              <dt>Chemistry</dt>
              <dd>
                <span className={toneClass(chemistry.tone)}>{chemistry.label}</span>
              </dd>
            </div>
            <div>
              <dt>Firing</dt>
              <dd>{firingText(image.coneMin, image.coneMax, image.atmosphere)}</dd>
            </div>
            <div>
              <dt>Body colour</dt>
              <dd>{tileBodyLabel(image.tileVariantKey)}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>
                {image.width && image.height ? `${image.width} × ${image.height}` : '—'}
                {image.sizeBytes ? ` · ${formatBytes(image.sizeBytes)}` : ''}
              </dd>
            </div>
            <div>
              <dt>Added</dt>
              <dd>{formatDateTime(image.createdAt)}</dd>
            </div>
          </dl>

          {reasons.length > 0 && (
            <div className="note">
              <div className="note-label">The photo check noticed</div>
              {reasons.map(sentence).join(', ')}
            </div>
          )}
          {image.duplicateOfImageId && (
            <div className="alert alert-warn" role="note">
              <Icon name="copy" size={18} />
              <span>This looks like a copy of a photo already in the library.</span>
            </div>
          )}

          {reviewable && !rejecting && needsRecipe && <RecipePicker value={recipeId} onChange={setRecipeId} />}

          {reviewable && rejecting && (
            <div className="field">
              <label className="label" htmlFor="library-reject">
                Why is it rejected?
              </label>
              <textarea
                id="library-reject"
                className="textarea"
                placeholder="e.g. Blurry, or not a fired tile"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
              />
            </div>
          )}
        </div>
      </div>
      {links.length > 0 && <TraceSection imageId={image.imageId} />}
      {(image.qualityStatus === 'Passed' || image.qualityStatus === 'NeedsReview') && <AiCopies image={image} />}
    </Modal>
  );
}

export default function LibraryPage() {
  const [approval, setApproval] = useState<ApprovalStatus | undefined>('Pending');
  const [quality, setQuality] = useState<QualityStatus | ''>('');
  const [chemistry, setChemistry] = useState<ChemistryStatus | ''>('');
  const [open, setOpen] = useState<ImageAssetDto | null>(null);

  const images = usePagedList(['images', { approval, quality, chemistry }], (cursor) =>
    imagesApi.list({ approval, quality: quality || undefined, chemistry: chemistry || undefined, cursor, pageSize: STEP }),
  );
  const list = images.items;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Photo library</h1>
          <p className="page-sub">Every photo the search can show, from Capture and from imports. Only approved photos with chemistry are searchable.</p>
        </div>
      </header>

      <div className="content">
        <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="Filter by approval">
            {APPROVAL_FILTERS.map((f) => (
              <button
                key={f.label}
                role="tab"
                aria-selected={approval === f.value}
                className={approval === f.value ? 'is-active' : ''}
                onClick={() => setApproval(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <select className="select toolbar-select" value={quality} onChange={(e) => setQuality(e.target.value as QualityStatus | '')} aria-label="Photo check">
            <option value="">Any photo check</option>
            <option value="Passed">Passed</option>
            <option value="NeedsReview">Needs a look</option>
            <option value="Failed">Failed</option>
            <option value="Pending">Not checked yet</option>
          </select>
          <select className="select toolbar-select" value={chemistry} onChange={(e) => setChemistry(e.target.value as ChemistryStatus | '')} aria-label="Chemistry">
            <option value="">Any chemistry</option>
            <option value="Linked">Chemistry linked</option>
            <option value="Missing">No chemistry</option>
            <option value="Pending">Working it out</option>
            <option value="Invalid">Chemistry invalid</option>
          </select>
        </div>

        {images.isPending ? (
          <div className="card">
            <Loading />
          </div>
        ) : images.isError ? (
          <div className="card">
            <LoadError error={images.error} onRetry={() => images.refetch()} />
          </div>
        ) : list.length === 0 ? (
          <div className="card">
            {approval === 'Pending' && !quality && !chemistry ? (
              <Empty icon="check" title="Nothing waiting" text="New photos from Capture and imports show up here until they're approved." />
            ) : (
              <Empty icon="image" title="Nothing here" text="No photos match these filters." />
            )}
          </div>
        ) : (
          <>
            <ul className="photo-grid">
              {list.map((img) => {
                const a = approvalMeta(img.approvalStatus);
                const q = qualityStatusMeta(img.qualityStatus);
                const c = chemistryMeta(img.chemistryStatus);
                const code = img.recipes?.[0]?.recipeCode;
                const name = img.recipes?.[0]?.recipeName;
                const thumb = img.thumbnailUrl ?? img.displayUrl;
                return (
                  <li key={img.imageId}>
                    <button className="photo-card" onClick={() => setOpen(img)}>
                      <span className="photo-thumb">{thumb ? <img src={thumb} alt="" loading="lazy" /> : <Icon name="image" size={28} />}</span>
                      <span className="photo-body">
                        <span className="recipe-label-head">
                          {code ? <span className="tile-code">{code}</span> : <span className="cell-strong truncate">{name ?? 'No recipe'}</span>}
                        </span>
                        <span className="muted truncate">
                          {img.sourceType === 'UserUpload' ? 'Capture' : 'Import'} · {firingText(img.coneMin, img.coneMax, img.atmosphere)}
                        </span>
                        <span className="photo-badges">
                          <span className={toneClass(a.tone)}>{a.label}</span>
                          {q && img.qualityStatus !== 'Passed' && <span className={toneClass(q.tone)}>{q.label}</span>}
                          {img.chemistryStatus !== 'Linked' && <span className={toneClass(c.tone)}>{c.label}</span>}
                          {img.displayCopyId && <span className="badge badge-info">AI copy</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="table-foot card">
              <span className="muted">
                Showing {list.length} of {Math.max(images.total, list.length)} {images.total === 1 ? 'photo' : 'photos'}
                {images.isFetching && ' · updating…'}
              </span>
              {images.hasNextPage && (
                <button className="btn btn-secondary btn-sm" onClick={() => images.fetchNextPage()} disabled={images.isFetchingNextPage}>
                  {images.isFetchingNextPage ? <span className="spinner" /> : 'Show more'}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {open && <PhotoModal image={open} onClose={() => setOpen(null)} />}
    </>
  );
}

