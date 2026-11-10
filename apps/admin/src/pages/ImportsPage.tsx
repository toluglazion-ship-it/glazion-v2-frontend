import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminImagesApi, errorMessage, importsApi, uploadToStorage } from '@glazion/api-client';
import { CLAY_BODIES, type ImportBatchDto, type ImportManifestRow, type ImportRecordStatus, type PresignDto } from '@glazion/types';
import { Icon, Modal, clayBodyLabel, formatBytes, formatDateTime, formatRelativeTime, qualityStatusMeta, toast, toneClass } from '@glazion/ui';
import { Empty, LoadError, Loading } from '../components/ListState';
import { CONES, TILE_BODIES, chemistryMeta, codeFromFileName, coneToNumber, recordStatusMeta, sha256Hex, tileBodyLabel } from '../lib/library';

const CHUNK = 25;
const PARALLEL_UPLOADS = 3;

// ─── New import ───────────────────────────────────────────────────────────────

function NewImportModal({ onClose, onCreated }: { onClose: () => void; onCreated: (batch: ImportBatchDto) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [tileBody, setTileBody] = useState('white');
  const [autoApprove, setAutoApprove] = useState(false);

  const create = useMutation({
    mutationFn: importsApi.create,
    onSuccess: (batch) => {
      queryClient.invalidateQueries({ queryKey: ['imports'] });
      onCreated(batch);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || create.isPending) return;
    create.mutate({ name: name.trim(), sourceLabel: sourceLabel.trim() || null, defaultTileVariantKey: tileBody || null, autoApprove });
  }

  return (
    <Modal
      title="New import"
      description="An import groups a set of photos brought in together, so you can follow how they get on."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="new-import" type="submit" disabled={!name.trim() || create.isPending}>
            {create.isPending && <span className="spinner" />}
            Create import
          </button>
        </>
      }
    >
      <form id="new-import" className="form" onSubmit={handleSubmit}>
        {create.isError && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{errorMessage(create.error)}</span>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="import-name">
            Name
          </label>
          <input id="import-name" className="input" placeholder="e.g. Group A tiles, October" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="import-source">
              Where the photos come from <span className="muted">(optional)</span>
            </label>
            <input id="import-source" className="input" placeholder="e.g. Old studio archive" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="import-body">
              Body colour
            </label>
            <select id="import-body" className="select" value={tileBody} onChange={(e) => setTileBody(e.target.value)}>
              {TILE_BODIES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
              <option value="">Mixed or unknown</option>
            </select>
          </div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
          <span>
            <span className="cell-strong">Approve photos that pass the photo check</span>
            <span className="muted">Otherwise every photo waits in the Photo library for you to approve it.</span>
          </span>
        </label>
      </form>
    </Modal>
  );
}

// ─── Adding photos ────────────────────────────────────────────────────────────

type Step = 'ready' | 'registering' | 'uploading' | 'checking' | 'done' | 'failed';

interface Item {
  id: string;
  file: File;
  code: string | null;
  step: Step;
  progress: number;
  message: string | null;
}

const STEP_LABEL: Record<Step, string> = {
  ready: 'Ready',
  registering: 'Preparing…',
  uploading: 'Uploading…',
  checking: 'Checking…',
  done: 'Imported',
  failed: 'Not imported',
};

/** File names make the record ids, so two files with one name get "(2)" added. */
function uniqueIds(files: File[], taken: Set<string>): string[] {
  return files.map((file) => {
    const base = file.webkitRelativePath || file.name;
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base} (${n})`;
    taken.add(id);
    return id;
  });
}

async function inChunks<T>(list: T[], size: number, run: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < list.length; i += size) await run(list.slice(i, i + size));
}

async function inParallel<T>(list: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (next < list.length) await run(list[next++]);
    }),
  );
}

function AddPhotos({ batch }: { batch: ImportBatchDto }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [coneFrom, setConeFrom] = useState('');
  const [coneTo, setConeTo] = useState('');
  const [atmosphere, setAtmosphere] = useState('');
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState('');

  const patch = (id: string, changes: Partial<Item>) => setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    const taken = new Set(items.map((i) => i.id));
    const ids = uniqueIds(files, taken);
    setItems((prev) => [
      ...prev.filter((i) => i.step !== 'done'),
      ...files.map((file, n) => ({ id: ids[n], file, code: codeFromFileName(file.name), step: 'ready' as Step, progress: 0, message: null })),
    ]);
  }

  async function run() {
    const ready = items.filter((i) => i.step === 'ready' || i.step === 'failed');
    if (ready.length === 0 || running) return;
    setRunning(true);
    setProblem('');
    const coneMin = coneFrom ? coneToNumber(coneFrom) : null;
    const coneMax = coneTo ? coneToNumber(coneTo) : coneMin;

    try {
      // 1. Register the files; each accepted one comes back with its own upload link.
      const accepted: { item: Item; upload: PresignDto }[] = [];
      await inChunks(ready, CHUNK, async (chunk) => {
        chunk.forEach((item) => patch(item.id, { step: 'registering', message: null }));
        const rows: ImportManifestRow[] = await Promise.all(
          chunk.map(async (item) => ({
            externalRecordId: item.id,
            fileName: item.file.name,
            contentType: item.file.type,
            sizeBytes: item.file.size,
            sha256: await sha256Hex(item.file),
            tileVariantKey: batch.defaultTileVariantKey,
            coneMin,
            coneMax,
            atmosphere: atmosphere || null,
            recipeCode: item.code,
          })),
        );
        const res = await importsApi.register(batch.id, rows);
        for (const item of chunk) {
          const reg = res.records?.find((r) => r.externalRecordId === item.id);
          if (reg?.accepted && reg.upload) {
            accepted.push({ item, upload: reg.upload });
            patch(item.id, { message: reg.warnings?.length ? reg.warnings.join(' ') : null });
          } else {
            patch(item.id, { step: 'failed', message: reg?.errors?.join(' ') || 'The server didn’t accept this file.' });
          }
        }
      });

      // 2. Send the files straight to storage, a few at a time.
      const uploaded: Item[] = [];
      await inParallel(accepted, PARALLEL_UPLOADS, async ({ item, upload }) => {
        patch(item.id, { step: 'uploading', progress: 0 });
        try {
          await uploadToStorage(upload, item.file, (progress) => patch(item.id, { progress }));
          uploaded.push(item);
          patch(item.id, { step: 'checking', progress: 1 });
        } catch (err) {
          patch(item.id, { step: 'failed', message: errorMessage(err) });
        }
      });

      // 3. Tell the server the files are in, so it checks them and links their chemistry.
      await inChunks(uploaded, CHUNK, async (chunk) => {
        const res = await importsApi.complete(
          batch.id,
          chunk.map((i) => i.id),
        );
        for (const item of chunk) {
          const done = res.records?.find((r) => r.externalRecordId === item.id);
          if (!done || done.status === 'Failed') patch(item.id, { step: 'failed', message: done?.error ?? 'The server couldn’t process this file.' });
          // Keep any warning from registering (an unknown tile code, say); add the review note to it.
          else if (done.status === 'NeedsReview')
            setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, step: 'done', message: [i.message, 'Needs a look in the Photo library.'].filter(Boolean).join(' ') } : i)));
          else patch(item.id, { step: 'done' });
        }
      });

      const imported = uploaded.length;
      toast(`${imported} ${imported === 1 ? 'photo' : 'photos'} imported`);
    } catch (err) {
      setProblem(errorMessage(err));
      setItems((prev) => prev.map((i) => (['registering', 'uploading', 'checking'].includes(i.step) ? { ...i, step: 'failed', message: i.message ?? 'Stopped before it finished.' } : i)));
    } finally {
      setRunning(false);
      queryClient.invalidateQueries({ queryKey: ['imports'] });
      queryClient.invalidateQueries({ queryKey: ['import', batch.id] });
      queryClient.invalidateQueries({ queryKey: ['images'] });
    }
  }

  const ready = items.filter((i) => i.step === 'ready').length;
  const failed = items.filter((i) => i.step === 'failed').length;
  const waiting = ready + failed;
  const withoutCode = items.filter((i) => !i.code && i.step !== 'done').length;

  return (
    <section className="add-photos">
      <div className="add-photos-head">
        <div>
          <h3 className="section-label">Add photos</h3>
          <p className="muted">
            Name each file after its tile code, like <span className="tile-code">P01-B1-002</span>.jpg, and it’s linked to that recipe and its chemistry.
          </p>
        </div>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={pick} />
        <button className="btn btn-secondary" onClick={() => input.current?.click()} disabled={running}>
          <Icon name="image" size={18} />
          Choose photos
        </button>
      </div>

      {items.length > 0 && (
        <>
          <div className="field-row field-row-3">
            <div className="field">
              <label className="label" htmlFor="imp-cone-from">
                Cone <span className="muted">(all photos, optional)</span>
              </label>
              <select id="imp-cone-from" className="select" value={coneFrom} onChange={(e) => setConeFrom(e.target.value)} disabled={running}>
                <option value="">Not recorded</option>
                {CONES.map((c) => (
                  <option key={c} value={c}>
                    Cone {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="imp-cone-to">
                Up to cone <span className="muted">(optional)</span>
              </label>
              <select id="imp-cone-to" className="select" value={coneTo} onChange={(e) => setConeTo(e.target.value)} disabled={running || !coneFrom}>
                <option value="">Same</option>
                {CONES.filter((c) => !coneFrom || coneToNumber(c) > coneToNumber(coneFrom)).map((c) => (
                  <option key={c} value={c}>
                    Cone {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="imp-atmosphere">
                Atmosphere
              </label>
              <select id="imp-atmosphere" className="select" value={atmosphere} onChange={(e) => setAtmosphere(e.target.value)} disabled={running}>
                <option value="">Not recorded</option>
                <option value="oxidation">Oxidation</option>
                <option value="reduction">Reduction</option>
              </select>
            </div>
          </div>

          {problem && (
            <div className="alert" role="alert">
              <Icon name="alert" size={18} />
              <span>{problem}</span>
            </div>
          )}
          {withoutCode > 0 && (
            <div className="alert alert-warn" role="note">
              <Icon name="alert" size={18} />
              <span>
                {withoutCode} {withoutCode === 1 ? 'file has' : 'files have'} no tile code in the name. They’ll be imported without chemistry, so search can’t match them until a recipe is linked in the Photo library.
              </span>
            </div>
          )}

          <ul className="item-list file-list">
            {items.map((item) => (
              <li key={item.id}>
                <span className="recipe-label">
                  <span className="recipe-label-head">
                    {item.code ? <span className="tile-code">{item.code}</span> : <span className="badge badge-warn">No code</span>}
                    <span className="truncate">{item.id}</span>
                  </span>
                  <span className={item.step === 'failed' ? 'hint-bad' : 'muted'}>
                    {formatBytes(item.file.size)}
                    {item.message && ` · ${item.message}`}
                  </span>
                </span>
                <span className={`file-step is-${item.step}`}>
                  {item.step === 'uploading' ? `Uploading ${Math.round(item.progress * 100)}%` : STEP_LABEL[item.step]}
                </span>
                {!running && item.step !== 'done' && (
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))} aria-label={`Remove ${item.id}`}>
                    <Icon name="x" size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="add-photos-foot">
            <span className="muted">
              {items.length} {items.length === 1 ? 'photo' : 'photos'} chosen
            </span>
            {waiting === 0 && !running ? (
              <button className="btn btn-secondary" onClick={() => setItems([])}>
                Clear list
              </button>
            ) : (
              <button className="btn btn-primary" onClick={run} disabled={running}>
                {running ? <span className="spinner" /> : <Icon name="upload" size={18} />}
                {running ? 'Importing…' : failed > 0 && ready === 0 ? `Try ${failed} again` : `Import ${waiting} ${waiting === 1 ? 'photo' : 'photos'}`}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ─── Clay body ────────────────────────────────────────────────────────────────

/** Sets the clay body on every photo of this import, such as the existing porcelain set. Lives here, with the import it acts on. */
function ImportClayBody({ batch }: { batch: ImportBatchDto }) {
  const queryClient = useQueryClient();
  const [clayBody, setClayBody] = useState('');
  const [onlyIfMissing, setOnlyIfMissing] = useState(true);
  const set = useMutation({
    mutationFn: () => adminImagesApi.setClayBody({ clayBody, importBatchId: batch.id, onlyIfMissing }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['images'] });
      queryClient.invalidateQueries({ queryKey: ['uploads'] });
    },
  });

  return (
    <section className="import-clay">
      <div>
        <h3 className="section-label">Clay body of these photos</h3>
        <p className="muted">For photos that came in this import rather than through Capture, so search can filter them by clay body.</p>
      </div>
      {set.isError && (
        <div className="alert" role="alert">
          <Icon name="alert" size={18} />
          <span>{errorMessage(set.error)}</span>
        </div>
      )}
      {set.isSuccess && (
        <div className="alert alert-ok" role="status">
          <Icon name="check" size={18} />
          <span>
            {set.data.updated.toLocaleString()} of {set.data.matched.toLocaleString()} photos set to {clayBodyLabel(set.data.clayBody)?.toLowerCase()}.
            {set.data.reindexQueued > 0 && ` ${set.data.reindexQueued.toLocaleString()} queued to be re-indexed for search.`}
          </span>
        </div>
      )}
      <div className="import-clay-row">
        <div className="field">
          <label className="label" htmlFor="import-clay">
            Clay body
          </label>
          <select
            id="import-clay"
            className="select"
            value={clayBody}
            onChange={(e) => {
              setClayBody(e.target.value);
              set.reset();
            }}
          >
            <option value="">Choose a clay body</option>
            {CLAY_BODIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-secondary" onClick={() => set.mutate()} disabled={!clayBody || set.isPending}>
          {set.isPending && <span className="spinner" />}
          Set clay body
        </button>
      </div>
      <label className="switch">
        <input type="checkbox" checked={onlyIfMissing} onChange={(e) => setOnlyIfMissing(e.target.checked)} />
        <span>
          <span className="cell-strong">Only photos without one</span>
          <span className="muted">Leaves any clay body already recorded as it is.</span>
        </span>
      </label>
    </section>
  );
}

// ─── One import ───────────────────────────────────────────────────────────────

const RECORD_FILTERS: { label: string; value: ImportRecordStatus | '' }[] = [
  { label: 'All', value: '' },
  { label: 'Needs a look', value: 'NeedsReview' },
  { label: 'Failed', value: 'Failed' },
  { label: 'Waiting for file', value: 'Registered' },
];

function Counts({ batch }: { batch: ImportBatchDto }) {
  const c = batch.counts;
  const tiles: { label: string; value: number; tone?: string }[] = [
    { label: 'Photos', value: c.total },
    { label: 'Checked', value: c.validated },
    { label: 'Needs a look', value: c.needsReview, tone: c.needsReview ? 'warn' : undefined },
    { label: 'Failed', value: c.failed, tone: c.failed ? 'bad' : undefined },
    { label: 'Approved', value: c.approved },
    { label: 'Searchable', value: c.indexed },
    { label: 'No chemistry', value: c.chemistryMissing + c.chemistryInvalid, tone: c.chemistryMissing + c.chemistryInvalid ? 'warn' : undefined },
  ];
  return (
    <div className="mini-stats">
      {tiles.map((t) => (
        <div key={t.label} className={`mini-stat${t.tone ? ` is-${t.tone}` : ''}`}>
          <span className="mini-stat-value">{t.value}</span>
          <span className="mini-stat-label">{t.label}</span>
        </div>
      ))}
    </div>
  );
}

/** The batch window lists this many photos; a filter narrows it down. The API allows up to 500. */
const RECORDS_SHOWN = 200;

function BatchModal({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ImportRecordStatus | ''>('');
  const [confirmClose, setConfirmClose] = useState(false);

  const batch = useQuery({ queryKey: ['import', batchId], queryFn: () => importsApi.getOne(batchId) });
  const records = useQuery({
    queryKey: ['import', batchId, 'records', filter],
    queryFn: () => importsApi.records(batchId, { status: filter || undefined, pageSize: RECORDS_SHOWN }),
  });
  const shown = records.data?.items ?? [];
  const totalRecords = records.data?.totalCount ?? 0;

  const close = useMutation({
    mutationFn: () => importsApi.close(batchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['imports'] });
      queryClient.invalidateQueries({ queryKey: ['import', batchId] });
      toast('Import closed');
      setConfirmClose(false);
    },
  });

  const b = batch.data;
  const open = b?.status === 'Open';

  return (
    <Modal
      title={b?.name ?? 'Import'}
      description={b ? `${b.sourceLabel ? `${b.sourceLabel} · ` : ''}${tileBodyLabel(b.defaultTileVariantKey)} tiles · started ${formatDateTime(b.createdAt)}` : undefined}
      onClose={onClose}
      size="lg"
      footer={
        b &&
        (confirmClose ? (
          <>
            <span className="muted footer-note">No more photos can be added once it’s closed.</span>
            <button className="btn btn-secondary" onClick={() => setConfirmClose(false)}>
              Keep open
            </button>
            <button className="btn btn-primary" onClick={() => close.mutate()} disabled={close.isPending}>
              {close.isPending && <span className="spinner" />}
              Close import
            </button>
          </>
        ) : open ? (
          <button className="btn btn-secondary" onClick={() => setConfirmClose(true)}>
            Close import…
          </button>
        ) : (
          <button className="btn btn-secondary" onClick={onClose}>
            Done
          </button>
        ))
      }
    >
      {batch.isError ? (
        <LoadError error={batch.error} onRetry={() => batch.refetch()} />
      ) : !b ? (
        <Loading />
      ) : (
        <div className="base-detail">
          {close.isError && (
            <div className="alert" role="alert">
              <Icon name="alert" size={18} />
              <span>{errorMessage(close.error)}</span>
            </div>
          )}
          <Counts batch={b} />
          {open ? <AddPhotos batch={b} /> : <p className="muted">This import is closed{b.closedAt ? ` (${formatDateTime(b.closedAt)})` : ''}, so no more photos can be added.</p>}

          <section>
            <div className="section-head">
              <h3 className="section-label">Photos in this import</h3>
              <div className="segmented segmented-sm" role="tablist" aria-label="Filter photos">
                {RECORD_FILTERS.map((f) => (
                  <button key={f.label} role="tab" aria-selected={filter === f.value} className={filter === f.value ? 'is-active' : ''} onClick={() => setFilter(f.value)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            {records.isPending ? (
              <Loading />
            ) : records.isError ? (
              <LoadError error={records.error} onRetry={() => records.refetch()} />
            ) : shown.length === 0 ? (
              <p className="muted">{filter ? 'None with this status.' : 'No photos yet.'}</p>
            ) : (
              <ul className="item-list">
                {shown.map((r) => {
                  const s = recordStatusMeta(r.status);
                  const q = qualityStatusMeta(r.qualityStatus);
                  const c = chemistryMeta(r.chemistryStatus);
                  return (
                    <li key={r.id}>
                      <span className="recipe-label">
                        <span className="truncate cell-strong">{r.externalRecordId ?? r.id}</span>
                        <span className={r.failureDetail ? 'hint-bad' : 'muted'}>{r.failureDetail ?? formatRelativeTime(r.uploadedAt ?? r.createdAt)}</span>
                      </span>
                      <span className="photo-badges">
                        <span className={toneClass(s.tone)}>{s.label}</span>
                        {q && r.qualityStatus !== 'Passed' && r.qualityStatus !== 'Pending' && <span className={toneClass(q.tone)}>{q.label}</span>}
                        {r.chemistryStatus !== 'Linked' && <span className={toneClass(c.tone)}>{c.label}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {totalRecords > shown.length && (
              <p className="muted">
                Showing the first {shown.length} of {totalRecords}. Choose a status to narrow the list.
              </p>
            )}
          </section>

          {b.counts.total > 0 && <ImportClayBody batch={b} />}
        </div>
      )}
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ImportsPage() {
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const batches = useQuery({ queryKey: ['imports'], queryFn: () => importsApi.list({ pageSize: 100 }) });
  const list = [...(batches.data?.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Imports</h1>
          <p className="page-sub">Bring existing tile photos into the library in bulk. A file named after its tile code is linked to that recipe.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={18} />
          New import
        </button>
      </header>

      <div className="content">
        <div className="card">
          {batches.isPending ? (
            <Loading />
          ) : batches.isError ? (
            <LoadError error={batches.error} onRetry={() => batches.refetch()} />
          ) : list.length === 0 ? (
            <Empty
              icon="upload"
              title="No imports yet"
              text="Start an import, then choose the photos. Name each file after its tile code so it's linked to the right recipe."
              action={
                <button className="btn btn-primary" onClick={() => setCreating(true)}>
                  New import
                </button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table table-clickable">
                <thead>
                  <tr>
                    <th>Import</th>
                    <th>Status</th>
                    <th>Photos</th>
                    <th>Checked</th>
                    <th>Needs a look</th>
                    <th>Failed</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((b) => (
                    <tr key={b.id} onClick={() => setOpenId(b.id)}>
                      <td className="cell-wide">
                        <div className="cell-strong">{b.name ?? 'Untitled import'}</div>
                        {b.sourceLabel && <div className="muted">{b.sourceLabel}</div>}
                      </td>
                      <td>
                        <span className={b.status === 'Open' ? 'badge badge-info' : 'badge'}>{b.status === 'Open' ? 'Open' : 'Closed'}</span>
                      </td>
                      <td>{b.counts.total}</td>
                      <td>{b.counts.validated}</td>
                      <td className={b.counts.needsReview ? '' : 'muted'}>{b.counts.needsReview}</td>
                      <td className={b.counts.failed ? 'hint-bad' : 'muted'}>{b.counts.failed}</td>
                      <td className="muted">{formatRelativeTime(b.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {creating && (
        <NewImportModal
          onClose={() => setCreating(false)}
          onCreated={(batch) => {
            setCreating(false);
            setOpenId(batch.id);
          }}
        />
      )}
      {openId && <BatchModal batchId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
