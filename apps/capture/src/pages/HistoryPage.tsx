import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { errorMessage, myUploadsApi } from '@glazion/api-client';
import { Icon, formatRelativeTime, toneClass, uploadStatusMeta } from '@glazion/ui';
import { uploadQueue, useUploadQueue, type PendingUpload } from '../lib/uploadQueue';
import { useOnline } from '../lib/useOnline';

function WaitingRow({ item, progress, online }: { item: PendingUpload; progress: number; online: boolean }) {
  const url = useMemo(() => URL.createObjectURL(item.blob), [item.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  // The photo only exists on this phone until it's sent, so discarding it asks first.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [item.state]);

  let status: string;
  if (item.state === 'failed') status = item.error ?? 'Couldn’t be uploaded.';
  else if (item.state === 'uploading') status = `Uploading… ${Math.round(progress * 100)}%`;
  else status = online ? 'Waiting to retry' : 'Waiting for a connection';
  const name = item.recipeCode ?? item.recipeName;

  return (
    <li className="row row-static row-waiting">
      <span className="thumb">
        <img src={url} alt="" />
      </span>
      <span className="row-body">
        <span className="row-title truncate">{name}</span>
        {confirming ? (
          <span className="row-text is-asking">Not uploaded yet, so discarding deletes it from this phone for good.</span>
        ) : (
          <span className={`row-text${item.state === 'failed' ? ' is-bad' : ''}`}>{status}</span>
        )}
        {item.state !== 'uploading' && (
          <span className="row-actions">
            {confirming ? (
              <>
                <button className="btn btn-secondary btn-sm" onClick={() => setConfirming(false)}>
                  Keep it
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => uploadQueue.discard(item.id)}>
                  Discard photo
                </button>
              </>
            ) : (
              <>
                {item.state === 'failed' && (
                  <button className="btn btn-secondary btn-sm" onClick={() => uploadQueue.retry(item.id)}>
                    Retry
                  </button>
                )}
                <button className="btn btn-ghost btn-sm row-discard" onClick={() => setConfirming(true)} aria-label={`Discard the ${name} photo`}>
                  <Icon name="trash" size={16} />
                  Discard
                </button>
              </>
            )}
          </span>
        )}
      </span>
    </li>
  );
}

export default function HistoryPage() {
  const online = useOnline();
  const queue = useUploadQueue();
  // 50 at a time, older ones on request, so "everything you've sent in" is really everything.
  const uploads = useInfiniteQuery({
    queryKey: ['my-uploads', 'list'],
    queryFn: ({ pageParam }) => myUploadsApi.list({ pageSize: 50, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = uploads.data?.pages.flatMap((page) => page.items ?? []) ?? [];
  const waiting = queue.items;

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Uploads</h1>
          <p className="page-sub">Everything you’ve sent in, newest first.</p>
        </div>
        <button className="btn btn-ghost btn-icon" onClick={() => uploads.refetch()} aria-label="Refresh" disabled={uploads.isFetching}>
          {uploads.isFetching ? <span className="spinner" /> : <Icon name="refresh" size={20} />}
        </button>
      </header>

      <main className="page">
        {waiting.length > 0 && (
          <>
            <h2 className="section-title">
              Waiting to upload <span className="muted">{waiting.length}</span>
            </h2>
            <ul className="list">
              {waiting.map((item) => (
                <WaitingRow key={item.id} item={item} progress={queue.progress[item.id] ?? 0} online={online} />
              ))}
            </ul>
            <h2 className="section-title">Sent</h2>
          </>
        )}

        {uploads.isPending && (
          <div className="page-loading">
            <span className="spinner spinner-lg" />
          </div>
        )}

        {uploads.isError && (
          <div className="empty">
            <div className="empty-icon">
              <Icon name={online ? 'alert' : 'wifi-off'} size={22} />
            </div>
            <div className="empty-title">{online ? 'Couldn’t load your uploads' : 'You’re offline'}</div>
            <p className="empty-text">{online ? errorMessage(uploads.error) : 'Your sent photos will show here once you reconnect.'}</p>
            {online && (
              <button className="btn btn-secondary" onClick={() => uploads.refetch()}>
                Try again
              </button>
            )}
          </div>
        )}

        {uploads.isSuccess && items.length === 0 && waiting.length === 0 && (
          <div className="empty">
            <div className="empty-icon">
              <Icon name="image" size={22} />
            </div>
            <div className="empty-title">Nothing uploaded yet</div>
            <p className="empty-text">Pick a recipe and photograph its tile to get started.</p>
            <Link className="btn btn-secondary" to="/">
              Go to recipes
            </Link>
          </div>
        )}

        {items.length > 0 && (
          <ul className="list">
            {items.map((upload) => {
              const status = uploadStatusMeta(upload.status);
              const thumb = upload.thumbnailUrl ?? upload.downloadUrl;
              const title = upload.recipeCode ?? upload.recipeName ?? upload.fileName ?? 'Untitled photo';
              // With a code as the title, the recipe name says what it is.
              const subtitle = upload.recipeCode && upload.recipeName && upload.recipeName !== upload.recipeCode ? `${upload.recipeName} · ` : '';
              return (
                <li key={upload.id}>
                  <Link className="row" to={`/history/${upload.id}`}>
                    <span className="thumb">
                      {thumb ? <img src={thumb} alt="" loading="lazy" /> : <Icon name="image" size={20} />}
                    </span>
                    <span className="row-body">
                      <span className={`row-title truncate${upload.recipeCode ? ' mono' : ''}`}>{title}</span>
                      <span className="row-text">
                        {subtitle}
                        {formatRelativeTime(upload.createdAt)}
                      </span>
                    </span>
                    <span className={toneClass(status.tone)}>{status.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {uploads.hasNextPage && (
          <button className="btn btn-secondary btn-block" onClick={() => uploads.fetchNextPage()} disabled={uploads.isFetchingNextPage}>
            {uploads.isFetchingNextPage && <span className="spinner" />}
            {uploads.isFetchingNextPage ? 'Loading…' : 'Load older uploads'}
          </button>
        )}
      </main>
    </>
  );
}
