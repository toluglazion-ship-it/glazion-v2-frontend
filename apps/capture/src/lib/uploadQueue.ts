// Photos waiting to be uploaded. Every upload goes through here: with a connection it starts at
// once, without one the photo is kept on the phone and sent when the connection comes back.
import { useSyncExternalStore } from 'react';
import { ApiError, errorMessage, myUploadsApi, uploadToStorage } from '@glazion/api-client';

const DB_NAME = 'glazion-capture';
const STORE = 'pending-uploads';
const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;

export interface PendingUpload {
  id: string;
  /** Whose photo this is, so two people sharing a phone never see each other's queue. */
  ownerId: string;
  recipeId: string;
  recipeName: string;
  /** The tile code, e.g. P01-B1-002. Missing on photos queued before codes existed. */
  recipeCode?: string | null;
  /** The capture code it goes under; null for a photo of a tile task taken by its code. */
  codeId: string | null;
  /** The tile's clay body. Missing only on photos queued before Capture asked for it. */
  clayBody?: string | null;
  /** The tile task the photo is for, when it was taken from one. */
  taskId?: string | null;
  fileName: string;
  blob: Blob;
  /** The back of the tile, with its code on it, sent alongside. */
  backBlob?: Blob | null;
  backFileName?: string | null;
  createdAt: string;
  /** The server's record, once it exists. A retry carries on with the same one. */
  uploadId: string | null;
  attempts: number;
  state: 'waiting' | 'uploading' | 'failed';
  error: string | null;
  /** True once the photo has had to wait: taken offline, or a first try that didn't get through. */
  waited: boolean;
}

export type NewUpload = Pick<PendingUpload, 'recipeId' | 'recipeName' | 'recipeCode' | 'codeId' | 'clayBody' | 'taskId' | 'fileName' | 'blob' | 'backBlob' | 'backFileName'>;

interface Snapshot {
  items: PendingUpload[];
  /** 0..1 for the photo being sent. */
  progress: Record<string, number>;
  /** Queue id -> upload id, for photos that finished while the app was open. */
  finished: Record<string, string>;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function store<T>(mode: IDBTransactionMode, run: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  // If the browser won't give us a database (some private modes), the queue still works for
  // this visit; it just won't survive closing the app.
  try {
    const db = await openDb();
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return undefined;
  }
}

// ─── State ────────────────────────────────────────────────────────────────────

let snapshot: Snapshot = { items: [], progress: {}, finished: {} };
const listeners = new Set<() => void>();
let ownerId: string | null = null;
let onUploaded: ((item: PendingUpload, seen: boolean) => void) | null = null;
let onFailed: ((item: PendingUpload, seen: boolean) => void) | null = null;
/** The photo the Capture screen is showing. Its upload is reported there, so it needs no toast. */
let watched: string | null = null;
let running = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** When a photo that hit a temporary failure may be tried again. Newer photos go ahead of it meanwhile. */
const retryAt = new Map<string, number>();

function emit(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

async function patch(id: string, changes: Partial<PendingUpload>) {
  const current = snapshot.items.find((item) => item.id === id);
  if (!current) return;
  const updated = { ...current, ...changes };
  emit({ items: snapshot.items.map((item) => (item.id === id ? updated : item)) });
  await store('readwrite', (s) => s.put(updated));
}

async function drop(id: string) {
  retryAt.delete(id);
  const { [id]: _, ...progress } = snapshot.progress;
  emit({ items: snapshot.items.filter((item) => item.id !== id), progress });
  await store('readwrite', (s) => s.delete(id));
}

// ─── Uploading ────────────────────────────────────────────────────────────────

/** Gives up on a photo until someone presses Retry. */
async function fail(item: PendingUpload, changes: Partial<PendingUpload>): Promise<'failed'> {
  retryAt.delete(item.id);
  await patch(item.id, { ...changes, state: 'failed' });
  onFailed?.(item, watched === item.id);
  return 'failed';
}

/** Worth trying again later: no connection, the server fell over, or storage refused the link. */
function isTemporary(err: unknown): boolean {
  if (!navigator.onLine || err instanceof TypeError) return true;
  return err instanceof ApiError && (err.status === 0 || err.status >= 500);
}

/** 'later': this photo waits its turn to retry, and the queue moves on. 'stop': nothing else can go now. */
async function send(item: PendingUpload): Promise<'done' | 'failed' | 'later' | 'stop'> {
  await patch(item.id, { state: 'uploading', error: null });

  try {
    let uploadId = item.uploadId;
    if (!uploadId) {
      const created = await myUploadsApi.create({
        captureCodeId: item.codeId,
        fileName: item.fileName,
        contentType: item.blob.type,
        sizeBytes: item.blob.size,
        recipeId: item.recipeId,
        recipeCode: item.recipeCode ?? null,
        clayBody: item.clayBody ?? null,
        taskId: item.taskId ?? null,
        back: item.backBlob ? { fileName: item.backFileName ?? 'back.jpg', contentType: item.backBlob.type, sizeBytes: item.backBlob.size } : null,
      });
      uploadId = created.id;
      await patch(item.id, { uploadId });
    }

    // A fresh link every attempt, so one that expired while offline is never reused.
    const presign = await myUploadsApi.presign(uploadId);
    // One bar for both sides, by size: the front, then the back.
    const total = item.blob.size + (item.backBlob?.size ?? 0);
    const report = (done: number) => emit({ progress: { ...snapshot.progress, [item.id]: total ? done / total : 1 } });
    try {
      await uploadToStorage(presign, item.blob, (fraction) => report(fraction * item.blob.size));
      if (item.backBlob) {
        if (!presign.back) throw new ApiError(500, 'The server did not return an address for the back of the tile.');
        const back = item.backBlob;
        await uploadToStorage({ ...presign.back, uploadId }, back, (fraction) => report(item.blob.size + fraction * back.size));
      }
    } catch (err) {
      // Storage errors are about the link or the connection, not the photo.
      throw err instanceof ApiError ? new ApiError(0, err.message) : err;
    }
    await myUploadsApi.complete(uploadId);

    await drop(item.id);
    emit({ finished: { ...snapshot.finished, [item.id]: uploadId } });
    onUploaded?.(item, watched === item.id);
    return 'done';
  } catch (err) {
    // Signed out mid-upload: leave the photo waiting for when they sign back in.
    if (err instanceof ApiError && err.status === 401) {
      await patch(item.id, { state: 'waiting' });
      return 'stop';
    }

    if (isTemporary(err)) {
      const attempts = item.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) return fail(item, { attempts, error: 'This photo couldn’t be sent after several tries. Check your connection and try again.' });
      await patch(item.id, { state: 'waiting', attempts, waited: true });
      retryAt.set(item.id, Date.now() + Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS));
      // Without a connection the rest would fail too; with one, the next photo needn't wait behind this one.
      return navigator.onLine ? 'later' : 'stop';
    }

    return fail(item, { error: errorMessage(err) });
  }
}

async function run() {
  if (running || !ownerId || !navigator.onLine) return;
  running = true;
  try {
    for (;;) {
      const now = Date.now();
      const next = snapshot.items.find((item) => item.state === 'waiting' && (retryAt.get(item.id) ?? 0) <= now);
      if (!next || (await send(next)) === 'stop') break;
    }
  } finally {
    running = false;
  }
  // Come back for the first photo whose wait is up.
  clearTimeout(retryTimer);
  const due = snapshot.items.filter((item) => item.state === 'waiting' && retryAt.has(item.id)).map((item) => retryAt.get(item.id)!);
  if (due.length > 0) retryTimer = setTimeout(run, Math.max(0, Math.min(...due) - Date.now()));
}

/** Back online: photos that failed for want of a connection needn't sit out their wait. */
function resume() {
  retryAt.clear();
  run();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const uploadQueue = {
  /**
   * Call when someone signs in. Loads their waiting photos and starts sending them. `seen` says
   * whether the photo was on screen when it finished, where the Capture screen reports it itself.
   */
  async start(userId: string, uploaded: (item: PendingUpload, seen: boolean) => void, failed: (item: PendingUpload, seen: boolean) => void) {
    ownerId = userId;
    onUploaded = uploaded;
    onFailed = failed;
    window.addEventListener('online', resume);

    const all = (await store<PendingUpload[]>('readonly', (s) => s.getAll())) ?? [];
    if (ownerId !== userId) return;
    // Anything marked "uploading" was cut off when the app last closed.
    const mine = all
      .filter((item) => item.ownerId === userId)
      .map((item) => (item.state === 'uploading' ? { ...item, state: 'waiting' as const } : item))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    emit({ items: mine });
    run();
  },

  stop() {
    ownerId = null;
    onUploaded = null;
    onFailed = null;
    clearTimeout(retryTimer);
    retryAt.clear();
    window.removeEventListener('online', resume);
    emit({ items: [], progress: {}, finished: {} });
  },

  async add(upload: NewUpload): Promise<string> {
    if (!ownerId) throw new Error('Sign in before uploading.');
    const item: PendingUpload = {
      ...upload,
      id: crypto.randomUUID(),
      ownerId,
      createdAt: new Date().toISOString(),
      uploadId: null,
      attempts: 0,
      state: 'waiting',
      error: null,
      waited: !navigator.onLine,
    };
    emit({ items: [...snapshot.items, item] });
    await store('readwrite', (s) => s.put(item));
    run();
    return item.id;
  },

  /** The photo on screen right now, or null when none is. */
  watch(id: string | null) {
    watched = id;
  },

  async retry(id: string) {
    retryAt.delete(id);
    await patch(id, { state: 'waiting', attempts: 0, error: null });
    run();
  },

  async discard(id: string) {
    const item = snapshot.items.find((candidate) => candidate.id === id);
    await drop(id);
    // Tidy up the server's half-made record if there is one. Fine if this doesn't get through.
    if (item?.uploadId) myUploadsApi.cancel(item.uploadId).catch(() => {});
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useUploadQueue(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}
