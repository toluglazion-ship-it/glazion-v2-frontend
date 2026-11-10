import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '@glazion/api-client';
import { CLAY_BODIES, type ClayBody, type RecipeDto } from '@glazion/types';
import { Icon, clayBodyLabel, formatBytes } from '@glazion/ui';
import { captureContextQuery, myTasksQuery } from '../lib/queries';
import { sortRecipes } from '../lib/recipes';
import { isReadyForPhoto } from '../lib/tasks';
import { uploadQueue, useUploadQueue } from '../lib/uploadQueue';
import { useOnline } from '../lib/useOnline';

const MAX_BYTES = 25 * 1024 * 1024;
const MIN_SHORT_SIDE = 1000;

/** What is being photographed: a recipe from the capture code, or a tile task's recipe. */
type Target = Pick<RecipeDto, 'id' | 'code' | 'name' | 'description'>;

interface Photo {
  file: File;
  url: string;
  warning: string | null;
}

// The upload carries its recipe, and the file is named after the tile code as well, so the same
// code is on the tile, the recipe and the photo. Recipes without a code fall back to their name.
function buildFileName(recipe: Target, file: File): string {
  const slug = recipe.code
    ? recipe.code.toUpperCase().replace(/[^A-Z0-9-]+/g, '')
    : (recipe.name ?? 'tile')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'jpg';
  return `${slug || 'tile'}_${stamp}.${ext}`;
}

function readDimensions(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export default function CapturePage() {
  const { recipeId } = useParams<{ recipeId: string }>();
  // A fresh screen for each recipe, so moving on to the next one starts clean.
  return <RecipeCapture key={recipeId} recipeId={recipeId ?? ''} />;
}

/** Photographing a tile task: its recipe and clay body are set by the task. */
export function TaskCapturePage() {
  const { taskId } = useParams<{ taskId: string }>();
  return <RecipeCapture key={taskId} taskId={taskId ?? ''} />;
}

function RecipeCapture({ recipeId, taskId }: { recipeId?: string; taskId?: string }) {
  const navigate = useNavigate();
  const online = useOnline();
  const queue = useUploadQueue();

  // A recipe photo is sent under your capture code; a task's photo needs none.
  const context = useQuery({ ...captureContextQuery, enabled: !taskId });
  const tasks = useQuery({ ...myTasksQuery, enabled: !!taskId });
  /** The photo's place in the upload queue once "Upload" has been pressed. */
  const [queuedId, setQueuedId] = useState<string | null>(null);
  // A tile your admin has checked and approved for its photo. Once its photo is on its way the task moves on to review,
  // and this screen keeps showing it.
  const openTasks = (tasks.data ?? []).filter(isReadyForPhoto);
  const task = taskId ? (openTasks.find((t) => t.id === taskId) ?? (queuedId ? tasks.data?.find((t) => t.id === taskId) : undefined)) : undefined;
  const recipe: Target | undefined = taskId
    ? task && { id: task.recipeId, code: task.recipeCode, name: task.recipeName, description: task.note }
    : context.data?.recipes?.find((r) => r.id === recipeId);
  // The one after this, so a batch can be photographed in order: the next recipe, or the next task.
  const ordered = sortRecipes(context.data?.recipes ?? []);
  const nextRecipe = !taskId && recipe ? ordered[ordered.findIndex((r) => r.id === recipe.id) + 1] : undefined;
  const nextTask = task ? openTasks[openTasks.findIndex((t) => t.id === task.id) + 1] : undefined;
  const next = nextTask
    ? { to: `/task/${nextTask.id}`, label: `${nextTask.recipeCode ?? nextTask.recipeName} on ${clayBodyLabel(nextTask.clayBody)?.toLowerCase()}` }
    : nextRecipe
      ? { to: `/capture/${nextRecipe.id}`, label: nextRecipe.code ?? nextRecipe.name ?? 'next recipe' }
      : undefined;

  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [error, setError] = useState('');
  // Saving the photo to the phone takes a moment; a second tap in that time mustn't queue it twice.
  const saving = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  // Required for every photo. Never guessed; it stays chosen for the next tile of the same recipe. A task sets it.
  const [picked, setClayBody] = useState<ClayBody | null>(null);
  const clayBody = task?.clayBody ?? picked;

  const queued = queue.items.find((item) => item.id === queuedId);
  const uploadId = queuedId ? queue.finished[queuedId] : undefined;
  const progress = queuedId ? (queue.progress[queuedId] ?? 0) : 0;
  // "Waiting" with a connection and no failed try yet just means it's about to start.
  const savedForLater = queued?.state === 'waiting' && (!online || queued.attempts > 0);
  // Sending, or about to: it carries on by itself, so the screen doesn't wait for it.
  const sending = !!queued && queued.state !== 'failed' && !savedForLater;
  // Photos are sent one at a time, oldest first; ones waiting to retry after a failure are passed over.
  const ahead =
    queued?.state === 'waiting'
      ? queue.items.filter((item) => item.id !== queued.id && (item.state === 'uploading' || (item.state === 'waiting' && item.attempts === 0 && item.createdAt < queued.createdAt))).length
      : 0;

  // While this photo is on screen its upload is reported here rather than in a toast.
  useEffect(() => {
    uploadQueue.watch(queuedId);
    return () => uploadQueue.watch(null);
  }, [queuedId]);

  // Release the preview blob when it is replaced or the page is left.
  useEffect(() => {
    return () => {
      if (photo) URL.revokeObjectURL(photo.url);
    };
  }, [photo]);

  async function handlePick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError('');

    if (!file.type.startsWith('image/')) {
      setError('That file isn’t an image. Choose a photo of the tile.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That photo is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_BYTES)}.`);
      return;
    }

    const url = URL.createObjectURL(file);
    const size = await readDimensions(url);
    const tooSmall = size !== null && Math.min(size.width, size.height) < MIN_SHORT_SIDE;
    setPhoto({
      file,
      url,
      warning: tooSmall ? 'This photo is quite small and may be rejected. A sharper, closer shot works better.' : null,
    });
  }

  function reset() {
    setPhoto(null);
    setQueuedId(null);
    setError('');
  }

  async function handleUpload() {
    if (!photo || !recipe || (!task && !context.data)) return;
    if (!clayBody) {
      setError('Choose the clay body of this tile first.');
      return;
    }
    if (saving.current) return;
    saving.current = true;
    setIsSaving(true);
    setError('');
    try {
      const id = await uploadQueue.add({
        recipeId: recipe.id,
        recipeName: recipe.name ?? recipe.code ?? 'Untitled recipe',
        recipeCode: recipe.code,
        codeId: task ? null : context.data!.codeId,
        clayBody,
        taskId: task?.id ?? null,
        fileName: buildFileName(recipe, photo.file),
        blob: photo.file,
      });
      setQueuedId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The photo couldn’t be saved. Please try again.');
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }

  // A photo that isn't in the queue yet exists only on this screen, and camera shots often aren't in
  // the gallery to pick again, so leaving with one asks first.
  const unsent = !!photo && !queuedId;
  useEffect(() => {
    if (!unsent) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsent]);

  function leave() {
    if (unsent && !window.confirm('Leave without uploading this photo? It will be discarded.')) return;
    navigate('/');
  }

  function retake() {
    // After a failed upload the photo is still kept in the queue; retaking deletes it.
    if (queued && !window.confirm('Discard this photo and take a new one? It hasn’t been uploaded.')) return;
    if (queued) uploadQueue.discard(queued.id);
    reset();
  }

  const header = (
    <header className="topbar">
      <button className="btn btn-ghost btn-icon" onClick={leave} aria-label="Back to recipes">
        <Icon name="chevron-left" size={22} />
      </button>
      {/* The screen's heading, so a screen reader can find where it starts. */}
      <h1 className="topbar-title truncate">{recipe?.name ?? recipe?.code ?? 'Capture'}</h1>
      <span className="topbar-spacer" />
    </header>
  );

  if (taskId ? tasks.isPending : context.isPending) {
    return (
      <>
        {header}
        <div className="page-loading">
          <span className="spinner spinner-lg" />
        </div>
      </>
    );
  }

  // The recipes didn't load: say why and offer to try again, rather than suggest the recipe was removed.
  const loadError = taskId ? tasks.error : context.error;
  if (loadError) {
    return (
      <>
        {header}
        <div className="empty">
          <div className="empty-icon">
            <Icon name="alert" size={22} />
          </div>
          <div className="empty-title">Couldn’t load this recipe</div>
          <p className="empty-text">{errorMessage(loadError)}</p>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (taskId) tasks.refetch();
              else context.refetch();
            }}
            disabled={context.isFetching}
            aria-busy={context.isFetching}
          >
            {context.isFetching && <span className="spinner" />}
            {context.isFetching ? 'Trying again…' : 'Try again'}
          </button>
          <Link className="btn btn-secondary" to="/">
            Back to recipes
          </Link>
        </div>
      </>
    );
  }

  if (!recipe) {
    return (
      <>
        {header}
        <div className="empty">
          <div className="empty-icon">
            <Icon name="flask" size={22} />
          </div>
          <div className="empty-title">{taskId ? 'Task not available' : 'Recipe not available'}</div>
          <p className="empty-text">
            {taskId
              ? 'It isn’t waiting for a photo from you any more: it may have moved to someone else, or its photo is already in review.'
              : 'It isn’t one of your recipes to photograph any more. Your admin can add it back.'}
          </p>
          <Link className="btn btn-secondary" to="/">
            Back to recipes
          </Link>
        </div>
      </>
    );
  }

  if (uploadId || savedForLater || sending) {
    return (
      <>
        {header}
        <main className="page capture">
          <div className="result">
            <div className={`result-icon${uploadId ? '' : ' is-waiting'}`}>
              <Icon name={uploadId ? 'check' : savedForLater ? 'clock' : 'upload'} size={28} strokeWidth={2.2} />
            </div>
            <h2 className="result-title">{uploadId ? 'Photo uploaded' : savedForLater ? 'Saved for later' : 'Uploading…'}</h2>
            <p className="result-text">
              {uploadId
                ? 'It’s in the review queue. You’ll see the result under Uploads.'
                : savedForLater
                  ? 'It will upload by itself once you’re back online. You can keep taking photos.'
                  : 'You can take the next photo now. This one keeps uploading by itself, and you’ll be told when it’s done.'}
            </p>
          </div>
          <div className="capture-actions">
            {/* Right above the buttons, where the eye is, rather than up in the message. */}
            {sending && (
              <div className="progress" role="status">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <span>
                  {ahead > 0 ? `Waiting for ${ahead} earlier photo${ahead === 1 ? '' : 's'}…` : progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : 'Finishing up…'}
                </span>
              </div>
            )}
            {next ? (
              <>
                <Link className="btn btn-primary btn-block" to={next.to} replace>
                  Next: {next.label}
                  <Icon name="chevron-right" size={18} />
                </Link>
                {/* A task's photo is now in review, so it takes no second one. */}
                {!task && (
                  <button className="btn btn-secondary btn-block" onClick={reset}>
                    Take another of this tile
                  </button>
                )}
              </>
            ) : task ? (
              <Link className="btn btn-primary btn-block" to="/">
                Back to your tasks
              </Link>
            ) : (
              <button className="btn btn-primary btn-block" onClick={reset}>
                Take another
              </button>
            )}
            <Link className={`btn btn-block ${next ? 'btn-ghost' : 'btn-secondary'}`} to={uploadId ? `/history/${uploadId}` : '/history'}>
              {uploadId ? 'View upload' : savedForLater ? 'See waiting photos' : 'See uploads'}
            </Link>
          </div>
        </main>
      </>
    );
  }

  const failure = queued?.state === 'failed' ? queued.error : error;

  return (
    <>
      {header}
      <main className="page capture">
        {recipe.code && (
          <p className="capture-code">
            Check the tile is marked <span className="tile-code">{recipe.code}</span>
          </p>
        )}
        {recipe.description && <p className="capture-desc">{recipe.description}</p>}

        {photo ? (
          <figure className="preview">
            <img src={photo.url} alt="Selected tile" />
            <figcaption>{formatBytes(photo.file.size)}</figcaption>
          </figure>
        ) : (
          <div className="guide">
            <div className="guide-icon">
              <Icon name="camera" size={26} />
            </div>
            <ul className="guide-list">
              <li>One tile, filling most of the frame</li>
              <li>Even light with no glare or hard shadows</li>
              <li>Hold steady until the tile is in focus</li>
            </ul>
          </div>
        )}

        {photo?.warning && !failure && (
          <div className="alert alert-warn">
            <Icon name="alert" size={18} />
            <span>{photo.warning}</span>
          </div>
        )}

        {task ? (
          <p className="capture-code">
            Clay body: <strong>{clayBodyLabel(task.clayBody)}</strong>
          </p>
        ) : (
          <fieldset className="clay-body">
            <legend className="clay-body-label">Clay body</legend>
            <div className="clay-body-options">
              {CLAY_BODIES.map((c) => (
                <label key={c.value} className={`clay-body-option${clayBody === c.value ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="clay-body"
                    value={c.value}
                    checked={clayBody === c.value}
                    onChange={() => {
                      setClayBody(c.value);
                      if (error === 'Choose the clay body of this tile first.') setError('');
                    }}
                  />
                  {/* Chosen is shown by a tick too, not by colour alone. */}
                  {clayBody === c.value && <Icon name="check" size={16} strokeWidth={2.4} />}
                  {c.label}
                </label>
              ))}
            </div>
            {!clayBody && <p className="clay-body-hint">Pick the clay the tile is made of. A photo can’t be uploaded without it.</p>}
          </fieldset>
        )}

        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={handlePick} />
        <input ref={galleryInput} type="file" accept="image/*" hidden onChange={handlePick} />

        <div className="capture-actions">
          {/* By the buttons, where the eye is after pressing one, rather than above the clay body pushing them down. */}
          {failure && (
            <div className="alert" role="alert">
              <Icon name="alert" size={18} />
              <span>{failure}</span>
            </div>
          )}
          {photo ? (
            <>
              {queued?.state === 'failed' ? (
                <button className="btn btn-primary btn-block" onClick={() => uploadQueue.retry(queued.id)}>
                  Try again
                </button>
              ) : (
                <button className="btn btn-primary btn-block" onClick={handleUpload} disabled={!clayBody || isSaving}>
                  <Icon name="upload" size={18} />
                  {online ? 'Upload photo' : 'Save to upload later'}
                </button>
              )}
              <button className="btn btn-secondary btn-block" onClick={retake}>
                {queued ? 'Discard and retake' : 'Retake'}
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-primary btn-block" onClick={() => cameraInput.current?.click()}>
                <Icon name="camera" size={18} />
                Take photo
              </button>
              <button className="btn btn-secondary btn-block" onClick={() => galleryInput.current?.click()}>
                <Icon name="image" size={18} />
                Choose from gallery
              </button>
            </>
          )}
        </div>
      </main>
    </>
  );
}
