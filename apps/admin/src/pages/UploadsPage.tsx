import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminImagesApi, captureCodesApi, errorMessage, uploadsApi, usersApi } from '@glazion/api-client';
import { CLAY_BODIES, UploadStatus, type AdminUploadDto } from '@glazion/types';
import {
  Icon,
  Modal,
  clayBodyLabel,
  formatBytes,
  formatDateTime,
  formatRelativeTime,
  qualityStatusMeta,
  recipeTitle,
  toast,
  toneClass,
  uploadStatusMeta,
} from '@glazion/ui';
import { Empty, LoadError, LoadMore, Loading } from '../components/ListState';
import { PAGE_SIZE, usePagedList } from '../hooks/usePagedList';

const FILTERS: { label: string; value: UploadStatus | undefined }[] = [
  { label: 'In review', value: UploadStatus.NeedsReview },
  { label: 'Approved', value: UploadStatus.Approved },
  { label: 'Rejected', value: UploadStatus.Rejected },
  { label: 'Indexed', value: UploadStatus.Indexed },
  { label: 'Failed', value: UploadStatus.Failed },
  { label: 'All', value: undefined },
];

/** Corrects the clay body of a stored photo. Only photos that have become images can be changed. */
function ClayBodyField({ upload }: { upload: AdminUploadDto }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(upload.clayBody?.toLowerCase() ?? '');
  const set = useMutation({
    mutationFn: (clayBody: string) => adminImagesApi.setClayBody({ clayBody, imageIds: [upload.imageId!] }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['uploads'] });
      toast(res.updated ? `Clay body set to ${clayBodyLabel(res.clayBody)?.toLowerCase()}` : 'Nothing changed');
    },
  });

  if (!upload.imageId) return null;
  const known = CLAY_BODIES.some((c) => c.value === value);
  return (
    <div className="field">
      <label className="label" htmlFor="review-clay">
        Clay body
      </label>
      <select
        id="review-clay"
        className="select"
        value={value}
        disabled={set.isPending}
        onChange={(e) => {
          setValue(e.target.value);
          if (e.target.value) set.mutate(e.target.value);
        }}
      >
        {!value && <option value="">Not recorded</option>}
        {value && !known && <option value={value}>{value}</option>}
        {CLAY_BODIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <span className={`hint${set.isError ? ' hint-bad' : ''}`}>{set.isError ? errorMessage(set.error) : 'Saved as soon as it’s changed. Search uses it to match tiles.'}</span>
    </div>
  );
}

type Decision = 'approved' | 'rejected';

/** Reject reasons typed but not sent, by upload, so closing the popup by mistake doesn't lose one. */
const reasonDrafts = new Map<string, string>();

interface ReviewModalProps {
  upload: AdminUploadDto;
  onClose: () => void;
  /** `fromReview`: the photo was waiting for review, rather than having its decision changed. */
  onReviewed: (upload: AdminUploadDto, decision: Decision, fromReview: boolean) => void;
}

function ReviewModal({ upload, onClose, onReviewed }: ReviewModalProps) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReasonText] = useState(() => reasonDrafts.get(upload.id) ?? '');
  const setReason = (text: string) => {
    setReasonText(text);
    if (text.trim()) reasonDrafts.set(upload.id, text);
    else reasonDrafts.delete(upload.id);
  };
  const status = uploadStatusMeta(upload.status);
  const quality = qualityStatusMeta(upload.qualityStatus);
  const reviewable = upload.status === UploadStatus.NeedsReview;
  // A decision can be changed later: the API approves a rejected photo and rejects (and unlists) an
  // approved one. It can't put a photo back in review.
  const approved = upload.status === UploadStatus.Approved || upload.status === UploadStatus.Indexing || upload.status === UploadStatus.Indexed;
  const canApprove = reviewable || upload.status === UploadStatus.Rejected;
  const canReject = reviewable || approved;

  // The recipes on the photographer's code: what this photo can be of. A photo taken by a tile's code has none.
  const [recipeId, setRecipeId] = useState(upload.recipeId ?? '');
  const captureCodeId = upload.captureCodeId;
  const codeRecipes = useQuery({
    queryKey: ['code-recipes', captureCodeId],
    queryFn: () => captureCodesApi.listRecipes(captureCodeId!),
    enabled: canApprove && !!captureCodeId,
  });
  const recipeOptions = [...(codeRecipes.data ?? [])].sort((a, b) => (a.code ?? recipeTitle(a)).localeCompare(b.code ?? recipeTitle(b), undefined, { numeric: true }));
  // Photos sent before uploads carried a recipe need one picked before they go into the library,
  // and until the code's recipes have loaded there's no telling whether there's one to pick.
  const needsRecipe = !upload.recipeId && recipeOptions.length > 0;
  const recipesUnknown = canApprove && !upload.recipeId && !!captureCodeId && !codeRecipes.isSuccess;

  function done(decision: Decision) {
    queryClient.invalidateQueries({ queryKey: ['uploads'] });
    queryClient.invalidateQueries({ queryKey: ['overview'] });
    onReviewed(upload, decision, reviewable);
  }

  const approve = useMutation({
    mutationFn: () => uploadsApi.approve(upload.id, recipeId && recipeId !== upload.recipeId ? { recipeId } : {}),
    onSuccess: () => done('approved'),
  });
  const reject = useMutation({
    mutationFn: () => uploadsApi.reject(upload.id, { reason: reason.trim() }),
    onSuccess: () => {
      reasonDrafts.delete(upload.id);
      done('rejected');
    },
  });
  const busy = approve.isPending || reject.isPending;
  const failure = approve.error ?? reject.error;
  const approveBlocked = busy || recipesUnknown || (needsRecipe && !recipeId);

  // A to approve and R to reject, for working through the queue from the keyboard. Not while typing.
  useEffect(() => {
    if (!reviewable) return;
    const onKey = (e: KeyboardEvent) => {
      if (rejecting || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select')) return;
      const key = e.key.toLowerCase();
      if (key === 'a' && !approveBlocked) {
        e.preventDefault();
        approve.mutate();
      } else if (key === 'r' && !busy) {
        e.preventDefault();
        setRejecting(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  let footer = null;
  if (canReject && rejecting) {
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
  } else if (canApprove || canReject) {
    footer = (
      <>
        {reviewable && (
          <span className="footer-note muted">
            <kbd>A</kbd> approve · <kbd>R</kbd> reject
          </span>
        )}
        {canReject && (
          <button className="btn btn-danger" onClick={() => setRejecting(true)} disabled={busy}>
            {reviewable ? 'Reject…' : 'Reject instead…'}
          </button>
        )}
        {canApprove && (
          <button className="btn btn-primary" onClick={() => approve.mutate()} disabled={approveBlocked}>
            {approve.isPending ? <span className="spinner" /> : <Icon name="check" size={18} />}
            {reviewable ? 'Approve' : 'Approve instead'}
          </button>
        )}
      </>
    );
  }

  return (
    <Modal title={upload.recipeCode ?? upload.recipeName ?? upload.fileName ?? 'Untitled photo'} description={upload.recipeCode || upload.recipeName ? (upload.fileName ?? undefined) : undefined} onClose={onClose} size="lg" footer={footer}>
      <div className="review">
        <div className="review-media">
          <div className="review-image">
            {upload.downloadUrl ? (
              <a href={upload.downloadUrl} target="_blank" rel="noreferrer" aria-label="Open the photo full size">
                <img src={upload.downloadUrl} alt={upload.recipeCode ?? upload.fileName ?? 'Uploaded tile'} />
              </a>
            ) : (
              <Icon name="image" size={32} />
            )}
          </div>
          {/* Said in words, not only in a tooltip, so it can be found without hovering. */}
          {upload.downloadUrl && (
            <a className="review-full" href={upload.downloadUrl} target="_blank" rel="noreferrer">
              <Icon name="external" size={16} />
              Open full size
            </a>
          )}
          {/* The back, with the code written on it: check it matches the recipe. It is kept with the photo, never searched. */}
          {upload.backUrl && (
            <figure className="review-back">
              <a href={upload.backUrl} target="_blank" rel="noreferrer" aria-label="Open the back of the tile full size">
                <img src={upload.backUrl} alt={`Back of ${upload.recipeCode ?? 'the tile'}`} />
              </a>
              <figcaption>Back of the tile</figcaption>
            </figure>
          )}
        </div>

        <div className="review-side">
          <dl className="facts">
            <div>
              <dt>Recipe</dt>
              <dd className="facts-recipe">
                {upload.recipeCode && <span className="tile-code">{upload.recipeCode}</span>}
                {upload.recipeName && upload.recipeName !== upload.recipeCode && <span>{upload.recipeName}</span>}
                {!upload.recipeCode && !upload.recipeName && <span className="muted">Not recorded</span>}
              </dd>
            </div>
            {!upload.imageId && (
              <div>
                <dt>Clay body</dt>
                <dd>{clayBodyLabel(upload.clayBody) ?? <span className="muted">Not recorded</span>}</dd>
              </div>
            )}
            <div>
              <dt>Status</dt>
              <dd>
                <span className={toneClass(status.tone)}>{status.label}</span>
              </dd>
            </div>
            {quality && (
              <div>
                <dt>Photo check</dt>
                <dd>
                  <span className={toneClass(quality.tone)}>{quality.label}</span>
                </dd>
              </div>
            )}
            <div>
              <dt>Photographed by</dt>
              <dd>{upload.ownerUsername ? `@${upload.ownerUsername}` : '—'}</dd>
            </div>
            {upload.madeByUsername && (
              <div>
                <dt>Made by</dt>
                <dd>@{upload.madeByUsername}</dd>
              </div>
            )}
            <div>
              <dt>Submitted</dt>
              <dd>{formatDateTime(upload.createdAt)}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatBytes(upload.actualSizeBytes ?? upload.declaredSizeBytes)}</dd>
            </div>
            {upload.reviewedAt && (
              <div>
                <dt>Reviewed</dt>
                <dd>{formatDateTime(upload.reviewedAt)}</dd>
              </div>
            )}
          </dl>

          {upload.reviewNote && (
            <div className="note">
              <div className="note-label">Review note</div>
              {upload.reviewNote}
            </div>
          )}
          {upload.failureReason && (
            <div className="alert">
              <Icon name="alert" size={18} />
              <span>{upload.failureReason}</span>
            </div>
          )}

          {!rejecting && <ClayBodyField upload={upload} />}

          {canApprove && !rejecting && !upload.recipeId && codeRecipes.isPending && <p className="hint">Loading the recipes on this photo’s code…</p>}
          {canApprove && !rejecting && !upload.recipeId && codeRecipes.isError && (
            <div className="alert" role="alert">
              <Icon name="alert" size={18} />
              <span>
                Couldn’t load the recipes on this code, so the photo can’t be approved yet.{' '}
                <button type="button" className="link-btn" onClick={() => codeRecipes.refetch()}>
                  Try again
                </button>
              </span>
            </div>
          )}

          {canApprove && !rejecting && recipeOptions.length > 0 && (
            <div className="field">
              <label className="label" htmlFor="review-recipe">
                {upload.recipeId ? 'Recipe' : 'Which recipe is this?'}
              </label>
              <select id="review-recipe" className="select" value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
                {!upload.recipeId && <option value="">Choose the recipe on the tile</option>}
                {recipeOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code ? `${r.code} · ${recipeTitle(r)}` : recipeTitle(r)}
                  </option>
                ))}
              </select>
              <span className="hint">{upload.recipeId ? 'Change it if the tile shows a different code.' : 'This photo was sent without a recipe. Pick the one written on the tile.'}</span>
            </div>
          )}

          {canReject && rejecting && (
            <div className="field">
              <label className="label" htmlFor="reject-reason">
                Why is it rejected?
              </label>
              <textarea
                id="reject-reason"
                className="textarea"
                placeholder="e.g. Glare across the top half, retake in softer light"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
              />
              <span className="hint">The photographer sees this, so say what to change.</span>
            </div>
          )}

          {/* Last in the column, just above the buttons that caused it. */}
          {failure && (
            <div className="alert" role="alert">
              <Icon name="alert" size={18} />
              <span>{errorMessage(failure)}</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function UploadsPage() {
  const [filter, setFilter] = useState<UploadStatus | undefined>(UploadStatus.NeedsReview);
  /** Whose uploads to show; empty for everyone's. The API filters by uploader but not by text. */
  const [owner, setOwner] = useState('');
  const [open, setOpen] = useState<AdminUploadDto | null>(null);

  const users = useQuery({ queryKey: ['users', 'options'], queryFn: () => usersApi.list({ pageSize: 100 }) });
  const uploaders = [...(users.data?.items ?? [])].filter((u) => u.username).sort((a, b) => a.username!.localeCompare(b.username!));

  const uploads = usePagedList<AdminUploadDto>(['uploads', { status: filter ?? 'all', owner }], (cursor) =>
    uploadsApi.list({ status: filter, ownerUserId: owner || undefined, cursor, pageSize: PAGE_SIZE }),
  );
  const showAll = () => {
    setFilter(undefined);
    setOwner('');
  };

  function reviewed(upload: AdminUploadDto, decision: Decision, fromReview: boolean) {
    // The decision can't be undone, but it can be changed: "Change" reopens the photo to do that.
    toast(decision === 'approved' ? 'Photo approved' : 'Photo rejected', {
      action: { label: 'Change', onClick: () => setOpen({ ...upload, status: decision === 'approved' ? UploadStatus.Approved : UploadStatus.Rejected }) },
    });
    // Straight on to the next photo waiting, so the queue can be worked through without the table.
    if (!fromReview) return setOpen(null);
    const index = uploads.items.findIndex((u) => u.id === upload.id);
    const waiting = (u: AdminUploadDto) => u.status === UploadStatus.NeedsReview && u.id !== upload.id;
    setOpen(uploads.items.slice(index + 1).find(waiting) ?? uploads.items.find(waiting) ?? null);
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Upload review</h1>
          <p className="page-sub">Approve the tile photos that are good enough for the library.</p>
        </div>
      </header>

      <div className="content">
        <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="Filter uploads">
            {FILTERS.map((f) => (
              <button key={f.label} role="tab" aria-selected={filter === f.value} className={filter === f.value ? 'is-active' : ''} onClick={() => setFilter(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
          {uploaders.length > 0 && (
            <select className="select toolbar-select" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Uploaded by">
              <option value="">Uploaded by anyone</option>
              {uploaders.map((u) => (
                <option key={u.id} value={u.id}>
                  @{u.username}
                  {u.displayName ? ` · ${u.displayName}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="card">
          {uploads.isPending ? (
            <Loading />
          ) : uploads.isError ? (
            <LoadError error={uploads.error} onRetry={() => uploads.refetch()} />
          ) : uploads.items.length === 0 ? (
            filter === UploadStatus.NeedsReview && !owner ? (
              <Empty icon="check" title="You’re all caught up" text="There are no photos waiting for review." />
            ) : (
              <Empty
                icon="image"
                title="Nothing here"
                text={owner ? 'This person has no uploads that match.' : 'No uploads match this filter.'}
                action={
                  <button className="btn btn-secondary" onClick={showAll}>
                    Show all uploads
                  </button>
                }
              />
            )
          ) : (
            <div className="table-wrap">
              <table className="table table-clickable">
                <thead>
                  <tr>
                    <th>Photo</th>
                    <th>Uploaded by</th>
                    <th>Clay body</th>
                    <th>Status</th>
                    <th>Photo check</th>
                    <th>Submitted</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {uploads.items.map((upload) => {
                    const status = uploadStatusMeta(upload.status);
                    const quality = qualityStatusMeta(upload.qualityStatus);
                    const thumb = upload.thumbnailUrl ?? upload.downloadUrl;
                    return (
                      <tr key={upload.id} onClick={() => setOpen(upload)}>
                        <td className="cell-wide cell-fit">
                          <div className="cell-photo">
                            <span className="thumb">
                              {thumb ? <img src={thumb} alt="" loading="lazy" /> : <Icon name="image" size={18} />}
                            </span>
                            <span className="recipe-label">
                              <span className="recipe-label-head">
                                {upload.recipeCode && <span className="tile-code">{upload.recipeCode}</span>}
                                <span className="cell-strong truncate">{upload.recipeName ?? upload.fileName ?? 'Untitled photo'}</span>
                              </span>
                              {upload.recipeName && upload.fileName && <span className="muted truncate">{upload.fileName}</span>}
                            </span>
                          </div>
                        </td>
                        <td>{upload.ownerUsername ? `@${upload.ownerUsername}` : '—'}</td>
                        <td>{clayBodyLabel(upload.clayBody) ?? <span className="muted">—</span>}</td>
                        <td>
                          <span className={toneClass(status.tone)}>{status.label}</span>
                        </td>
                        <td>{quality ? <span className={toneClass(quality.tone)}>{quality.label}</span> : <span className="muted">—</span>}</td>
                        <td className="muted">{formatRelativeTime(upload.createdAt)}</td>
                        <td className="cell-actions">
                          {/* Secondary on every row: a column of dark buttons drowns out the page's one main action. */}
                          <button
                            className="btn btn-secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpen(upload);
                            }}
                          >
                            {upload.status === UploadStatus.NeedsReview ? 'Review' : 'View'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <LoadMore
            shown={uploads.items.length}
            total={uploads.total}
            hasMore={!!uploads.hasNextPage}
            loading={uploads.isFetchingNextPage}
            onLoadMore={() => uploads.fetchNextPage()}
          />
        </div>
      </div>

      {open && <ReviewModal key={`${open.id}-${open.status}`} upload={open} onClose={() => setOpen(null)} onReviewed={reviewed} />}
    </>
  );
}
