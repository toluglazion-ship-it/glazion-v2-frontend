import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError, captureApi, errorMessage } from '@glazion/api-client';
import type { CaptureTileDto } from '@glazion/types';
import { Icon, clayBodyLabel, formatBytes } from '@glazion/ui';
import { firingText } from '../lib/tasks';
import { uploadQueue, useUploadQueue } from '../lib/uploadQueue';
import { useOnline } from '../lib/useOnline';

const MAX_BYTES = 25 * 1024 * 1024;
/** A tile code is at least this long before it is looked up (P01-B1-001 is 10). */
const MIN_CODE = 6;

type Side = 'front' | 'back';

interface Photo {
  file: File;
  url: string;
}

/** Why a tile can't be photographed now, as its maker would put it. */
const NOT_READY: Record<string, string> = {
  not_done: 'Not made yet',
  not_approved: 'Waiting for the admin to check it',
  in_review: 'Photo waiting for review',
  approved: 'Already photographed',
};

function fileName(code: string, side: Side, file: File) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'jpg';
  return `${code.toUpperCase().replace(/[^A-Z0-9-]+/g, '') || 'tile'}_${stamp}${side === 'back' ? '_back' : ''}.${ext}`;
}

/** Waits for typing to settle before looking a code up. */
function useSettled(value: string, ms = 400) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Capture by code: snap the front of a tile and its back (with the code written on it), type the code, and pick which
 * of that recipe's tiles it is. Any tile an admin has approved can be photographed, whoever made it. The photo goes to an admin
 * for review before it reaches the library.
 */
export default function SnapPage() {
  const online = useOnline();
  const queue = useUploadQueue();
  const [front, setFront] = useState<Photo | null>(null);
  const [back, setBack] = useState<Photo | null>(null);
  // Opened from To photograph: the tile's code (and which of its tiles) come filled in.
  const [params] = useSearchParams();
  const wantedTask = params.get('task');
  const [code, setCode] = useState(() => params.get('code') ?? '');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const saving = useRef(false);
  const inputs = {
    front: useRef<HTMLInputElement>(null),
    back: useRef<HTMLInputElement>(null),
  };
  const gallery = {
    front: useRef<HTMLInputElement>(null),
    back: useRef<HTMLInputElement>(null),
  };

  const typed = code.trim();
  const settled = useSettled(typed);
  const lookup = useQuery({
    queryKey: ['capture-tiles', settled.toUpperCase()],
    queryFn: () => captureApi.tiles(settled),
    enabled: settled.length >= MIN_CODE,
    retry: false,
    staleTime: 15_000,
  });
  const found = settled === typed && lookup.data ? lookup.data : undefined;
  const tiles = found?.tiles ?? [];
  const ready = tiles.filter((t) => t.status === 'ready');
  const chosen = tiles.find((t) => t.taskId === taskId && t.status === 'ready');
  const notFound = settled === typed && lookup.error instanceof ApiError && lookup.error.status === 404;

  // The tile asked for, or the only one ready. Otherwise the choice is left to the person holding it.
  useEffect(() => {
    const asked = ready.find((t) => t.taskId === wantedTask);
    setTaskId(asked ? asked.taskId : ready.length === 1 ? ready[0].taskId : null);
  }, [found?.recipeId, ready.length === 1 ? ready[0].taskId : null, ready.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Release preview blobs when they are replaced or the page is left.
  useEffect(() => () => void (front && URL.revokeObjectURL(front.url)), [front]);
  useEffect(() => () => void (back && URL.revokeObjectURL(back.url)), [back]);

  const queued = queue.items.find((item) => item.id === queuedId);
  const uploadId = queuedId ? queue.finished[queuedId] : undefined;
  const progress = queuedId ? (queue.progress[queuedId] ?? 0) : 0;
  useEffect(() => {
    uploadQueue.watch(queuedId);
    return () => uploadQueue.watch(null);
  }, [queuedId]);

  function pick(side: Side) {
    return (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) return setError('That file isn’t an image. Choose a photo of the tile.');
      if (file.size > MAX_BYTES) return setError(`That photo is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_BYTES)}.`);
      setError('');
      (side === 'front' ? setFront : setBack)({
        file,
        url: URL.createObjectURL(file),
      });
    };
  }

  function reset() {
    setFront(null);
    setBack(null);
    setCode('');
    setTaskId(null);
    setQueuedId(null);
    setError('');
  }

  async function send() {
    if (!front || !back || !found || !chosen || saving.current) return;
    saving.current = true;
    setError('');
    try {
      const tileCode = found.code ?? typed;
      const id = await uploadQueue.add({
        recipeId: found.recipeId,
        recipeName: found.name ?? tileCode,
        recipeCode: found.code,
        codeId: null,
        clayBody: chosen.clayBody,
        taskId: chosen.taskId,
        fileName: fileName(tileCode, 'front', front.file),
        blob: front.file,
        backFileName: fileName(tileCode, 'back', back.file),
        backBlob: back.file,
      });
      setQueuedId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The photo couldn’t be saved. Please try again.');
    } finally {
      saving.current = false;
    }
  }

  const header = (
    <header className="page-head">
      <div>
        <h1 className="page-title">Snap a tile</h1>
        <p className="page-sub">Photograph any tile your admin has approved, by the code on its back.</p>
      </div>
    </header>
  );

  if (queued?.state !== 'failed' && (uploadId || queued)) {
    return (
      <>
        {header}
        <main className="page capture">
          <div className="result">
            <div className={`result-icon${uploadId ? '' : ' is-waiting'}`}>
              <Icon name={uploadId ? 'check' : 'upload'} size={28} strokeWidth={2.2} />
            </div>
            <h2 className="result-title">{uploadId ? 'Photo sent for review' : online ? 'Uploading…' : 'Saved for later'}</h2>
            <p className="result-text">
              {uploadId
                ? `${found?.code ?? 'The tile'} on ${clayBodyLabel(chosen?.clayBody ?? '')?.toLowerCase()} goes into the library once an admin approves it.`
                : online
                  ? 'You can snap the next tile now. This one keeps uploading by itself.'
                  : 'It will upload by itself once you’re back online.'}
            </p>
            {!uploadId && online && (
              <div className="progress" role="status">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <span>{progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : 'Finishing up…'}</span>
              </div>
            )}
          </div>
          <div className="capture-actions">
            <button className="btn btn-primary btn-block" onClick={reset}>
              <Icon name="camera" size={18} />
              Snap the next tile
            </button>
            <Link className="btn btn-secondary btn-block" to={uploadId ? `/history/${uploadId}` : '/history'}>
              {uploadId ? 'View upload' : 'See uploads'}
            </Link>
          </div>
        </main>
      </>
    );
  }

  const slot = (side: Side, photo: Photo | null) => (
    <div className="snap-slot">
      <div className="snap-slot-label">{side === 'front' ? 'Front' : 'Back, with its code'}</div>
      {photo ? (
        <figure className="preview snap-preview">
          <img src={photo.url} alt={side === 'front' ? 'Front of the tile' : 'Back of the tile'} />
          <figcaption>{formatBytes(photo.file.size)}</figcaption>
        </figure>
      ) : (
        <button className="snap-empty" onClick={() => inputs[side].current?.click()} aria-label={`Take a photo of the ${side} of the tile`}>
          <Icon name="camera" size={24} />
          <span>{side === 'front' ? 'Take the front' : 'Take the back'}</span>
        </button>
      )}
      <div className="snap-slot-actions">
        {photo && (
          <button className="btn btn-ghost btn-sm" onClick={() => inputs[side].current?.click()}>
            Retake
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => gallery[side].current?.click()}>
          <Icon name="image" size={16} />
          Gallery
        </button>
      </div>
      <input ref={inputs[side]} type="file" accept="image/*" capture="environment" hidden onChange={pick(side)} />
      <input ref={gallery[side]} type="file" accept="image/*" hidden onChange={pick(side)} />
    </div>
  );

  const option = (t: CaptureTileDto) => {
    const isReady = t.status === 'ready';
    const selected = chosen?.taskId === t.taskId;
    return (
      <label key={t.taskId} className={`snap-tile${selected ? ' is-selected' : ''}${isReady ? '' : ' is-disabled'}`}>
        <input type="radio" name="tile" value={t.taskId} checked={selected} disabled={!isReady} onChange={() => setTaskId(t.taskId)} />
        <span className="snap-tile-body">
          <span className="snap-tile-title">
            {selected && <Icon name="check" size={16} strokeWidth={2.4} />}
            {clayBodyLabel(t.clayBody)}
          </span>
          <span className="snap-tile-text">
            {t.mine ? 'Your tile' : `Made by @${t.madeByUsername}`}
            {isReady ? (t.retakeReason ? ` · Retake: ${t.retakeReason}` : '') : ` · ${NOT_READY[t.status] ?? t.status}`}
          </span>
        </span>
      </label>
    );
  };

  const failure = queued?.state === 'failed' ? queued.error : error;
  const firing = found ? firingText(found.cone, found.atmosphere) : null;
  const missing = !front
    ? 'Take the front of the tile.'
    : !back
      ? 'Take the back, with its code.'
      : !found
        ? 'Type the code on the back.'
        : !chosen
          ? 'Choose which tile it is.'
          : null;

  return (
    <>
      {header}
      <main className="page capture">
        <div className="snap-photos">
          {slot('front', front)}
          {slot('back', back)}
        </div>

        <div className="field">
          <label className="label" htmlFor="snap-code">
            Tile code
          </label>
          <input
            id="snap-code"
            className="input mono"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. P01-B1-002"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
          />
          {lookup.isFetching && typed.length >= MIN_CODE && <p className="clay-body-hint">Looking it up…</p>}
          {notFound && <p className="clay-body-hint is-bad">No recipe has the code {typed}. Check the code on the back of the tile.</p>}
          {settled === typed && lookup.isError && !notFound && <p className="clay-body-hint is-bad">{errorMessage(lookup.error)}</p>}
        </div>

        {found && (
          <section className="snap-recipe" aria-label="The recipe">
            <div className="snap-recipe-head">
              {found.code && <span className="tile-code">{found.code}</span>}
              <strong>{found.name}</strong>
            </div>
            <div className="task-recipe-facts">
              {found.baseCode && (
                <span className="badge">
                  Base {found.baseCode}
                  {found.baseName ? ` · ${found.baseName}` : ''}
                </span>
              )}
              {firing && <span className="badge">{firing}</span>}
            </div>
            {tiles.length === 0 ? (
              <p className="clay-body-hint">Nobody has been given this recipe to make yet, so there’s no tile of it to photograph.</p>
            ) : (
              <fieldset className="clay-body">
                <legend className="clay-body-label">Which tile is it?</legend>
                <div className="snap-tiles">{tiles.map(option)}</div>
                {ready.length === 0 && <p className="clay-body-hint">None of its tiles can be photographed right now.</p>}
              </fieldset>
            )}
          </section>
        )}

        <div className="capture-actions">
          {failure && (
            <div className="alert" role="alert">
              <Icon name="alert" size={18} />
              <span>{failure}</span>
            </div>
          )}
          {queued?.state === 'failed' ? (
            <>
              <button className="btn btn-primary btn-block" onClick={() => uploadQueue.retry(queued.id)}>
                Try again
              </button>
              <button
                className="btn btn-secondary btn-block"
                onClick={() => {
                  uploadQueue.discard(queued.id);
                  reset();
                }}
              >
                Discard and start again
              </button>
            </>
          ) : (
            <>
              {missing && <p className="clay-body-hint">{missing}</p>}
              <button className="btn btn-primary btn-block" onClick={send} disabled={!!missing}>
                <Icon name="upload" size={18} />
                {online ? 'Send for review' : 'Save to send later'}
              </button>
            </>
          )}
        </div>
      </main>
    </>
  );
}
