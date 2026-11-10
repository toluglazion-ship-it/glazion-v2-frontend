import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, experimentsApi } from '@glazion/api-client';
import { CLAY_BODIES, type ClayBody, type ExperimentDto, type ExperimentStepDto } from '@glazion/types';
import { Icon, Modal, clayBodyLabel, formatDateTime, formatRelativeTime, toast, toneClass } from '@glazion/ui';
import { Empty, LoadError, Loading } from '../components/ListState';
import StageRows, { amountText, readStageRows, stageAmount, stageRow, stageRowsFrom, type StageRow } from '../components/StageRows';
import { useAllBases } from '../components/VariationModals';
import { useAssignees, userLabel } from '../lib/tasks';

const num = (text: string) => (text.trim() === '' ? NaN : Number(text.trim().replace(',', '.')));
const pct = (n: number) => `${Number(n.toFixed(4))}%`;

// ─── New experiment ───────────────────────────────────────────────────────────

type TilesChoice = 'each' | ClayBody;

function NewExperimentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (e: ExperimentDto) => void }) {
  const queryClient = useQueryClient();
  const bases = useAllBases();
  const { assignees } = useAssignees();
  const [baseCode, setBaseCode] = useState('');
  const [userId, setUserId] = useState('');
  const [name, setName] = useState('');
  const [dry, setDry] = useState('100');
  const [water, setWater] = useState('60');
  const [tiles, setTiles] = useState('3');
  const [clay, setClay] = useState<TilesChoice>('each');
  const [reserve, setReserve] = useState('10');
  const [rows, setRows] = useState<StageRow[]>(() => [stageRow(), stageRow()]);
  const [tried, setTried] = useState(false);

  const read = readStageRows(rows);
  const cupCount = read.cups;
  const tilesPerStep = Number(tiles) || 0;
  const problem = !baseCode
    ? 'Choose the base glaze in the cups.'
    : !userId
      ? 'Choose who does the experiment.'
      : (read.problem ??
        (read.stages.length === 0
          ? 'Add the colorant of stage 1.'
          : !(num(dry) > 0)
            ? 'Enter the dry glaze per cup.'
            : !(tilesPerStep >= 1 && tilesPerStep <= 12)
              ? 'Dip 1 to 12 tiles after each change.'
              : null));

  const create = useMutation({
    mutationFn: () =>
      experimentsApi.create({
        name: name.trim() || null,
        baseCode,
        participantUserId: userId,
        cups: cupCount,
        dryGrams: num(dry),
        waterGrams: num(water) || 0,
        tilesPerStep,
        clayBodies: clay === 'each' ? CLAY_BODIES.map((c) => c.value as ClayBody) : [clay],
        minReserveGrams: num(reserve) || 0,
        stages: read.stages,
      }),
    onSuccess: (e) => {
      queryClient.invalidateQueries({ queryKey: ['experiments'] });
      toast(`Experiment ready for @${e.participantUsername}`);
      onCreated(e);
    },
  });

  function submit(ev: FormEvent) {
    ev.preventDefault();
    setTried(true);
    if (!problem && !create.isPending) create.mutate();
  }

  return (
    <Modal
      title="New cup experiment"
      description="Many recipes from a few cups: the participant adds a material in stages and dips tiles after every change. Glazion works out the grams from what is left in each cup."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <span className="modal-foot-start muted">
            {read.steps > 0 && `${read.steps} ${read.steps === 1 ? 'step' : 'steps'} · ${read.steps * cupCount} recipes · ${read.steps * cupCount * tilesPerStep} tiles`}
          </span>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="new-experiment" type="submit" disabled={create.isPending || (tried && !!problem)}>
            {create.isPending && <span className="spinner" />}
            Create experiment
          </button>
        </>
      }
    >
      <form id="new-experiment" className="form" onSubmit={submit}>
        {(create.isError || (tried && problem)) && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{create.isError ? errorMessage(create.error) : problem}</span>
          </div>
        )}
        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="exp-base">
              Base glaze
            </label>
            <select id="exp-base" className="select" value={baseCode} onChange={(e) => setBaseCode(e.target.value)}>
              <option value="">Choose a base</option>
              {(bases.data ?? []).map((b) => (
                <option key={b.id} value={b.code ?? ''}>
                  {b.code}
                  {b.name ? ` · ${b.name}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="exp-user">
              Participant
            </label>
            <select id="exp-user" className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Choose who does it</option>
              {assignees.map((u) => (
                <option key={u.id} value={u.id}>
                  {userLabel(u)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field-row field-row-3">
          <div className="field">
            <label className="label" htmlFor="exp-cups">
              Cups
            </label>
            <input id="exp-cups" className="input" disabled readOnly value={cupCount ? `${cupCount}, from stage 1` : 'From stage 1'} />
          </div>
          <div className="field">
            <label className="label" htmlFor="exp-dry">
              Dry glaze per cup
            </label>
            <div className="input-unit">
              <input id="exp-dry" className="input" inputMode="decimal" value={dry} onChange={(e) => setDry(e.target.value)} />
              <span aria-hidden="true">g</span>
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="exp-water">
              Water per cup
            </label>
            <div className="input-unit">
              <input id="exp-water" className="input" inputMode="decimal" value={water} onChange={(e) => setWater(e.target.value)} />
              <span aria-hidden="true">g</span>
            </div>
          </div>
        </div>
        <div className="field-row field-row-3">
          <div className="field">
            <label className="label" htmlFor="exp-tiles">
              Tiles after each change
            </label>
            <input id="exp-tiles" className="input" inputMode="numeric" value={tiles} onChange={(e) => /^[0-9]*$/.test(e.target.value) && setTiles(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="exp-clay">
              Clay bodies
            </label>
            <select id="exp-clay" className="select" value={clay} onChange={(e) => setClay(e.target.value as TilesChoice)}>
              <option value="each">One of each (porcelain, stoneware, red clay)</option>
              {CLAY_BODIES.map((c) => (
                <option key={c.value} value={c.value}>
                  All {c.label.toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="exp-reserve">
              Ask for fresh glaze below
            </label>
            <div className="input-unit">
              <input id="exp-reserve" className="input" inputMode="decimal" value={reserve} onChange={(e) => setReserve(e.target.value)} />
              <span aria-hidden="true">g</span>
            </div>
          </div>
        </div>
        <div className="field">
          <span className="label">Colorants, one stage each</span>
          <span className="hint">Stage 1 sets the cups, one for each amount. Each stage goes in on top of the ones before. Amounts are % of the dry glaze left in the cup. There’s no maximum.</span>
          <StageRows rows={rows} onChange={setRows} />
        </div>
        <div className="field">
          <label className="label" htmlFor="exp-name">
            Name <span className="muted">(optional)</span>
          </label>
          <input id="exp-name" className="input" placeholder="e.g. Cobalt and iron, November" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}

// ─── One experiment ───────────────────────────────────────────────────────────

function EditStagesModal({ experiment, onClose }: { experiment: ExperimentDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<StageRow[]>(() => stageRowsFrom(experiment));
  const started = experiment.history.length > 0 || !!experiment.current?.id;
  const read = readStageRows(rows);
  const problem = read.problem ?? (read.stages.length === 0 ? 'Keep at least one stage.' : null);
  const save = useMutation({
    mutationFn: () => experimentsApi.update(experiment.id, { stages: read.stages, ...(started ? {} : { cups: read.cups }) }),
    onSuccess: (e) => {
      queryClient.setQueryData(['experiments', e.id], e);
      queryClient.invalidateQueries({ queryKey: ['experiments'] });
      toast('Stages saved');
      onClose();
    },
  });
  return (
    <Modal
      title="Change the stages"
      description="Stages that haven’t started can change: another colorant, amount or Series/Fixed. A started one stays as it is; a series can go on to a higher amount."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending || !!problem}>
            {save.isPending && <span className="spinner" />}
            Save stages
          </button>
        </>
      }
    >
      {(save.isError || problem) && (
        <div className="alert" role="alert">
          <Icon name="alert" size={18} />
          <span>{save.isError ? errorMessage(save.error) : problem}</span>
        </div>
      )}
      <StageRows rows={rows} onChange={setRows} />
    </Modal>
  );
}

function RefillModal({ experiment, cup, onClose }: { experiment: ExperimentDto; cup: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [dry, setDry] = useState(String(experiment.dryGrams));
  const [water, setWater] = useState(String(experiment.waterGrams));
  const refill = useMutation({
    mutationFn: () => experimentsApi.refill(experiment.id, cup, { dryGrams: num(dry), waterGrams: num(water) || 0 }),
    onSuccess: (e) => {
      queryClient.setQueryData(['experiments', e.id], e);
      const adds = e.history[e.history.length - 1]?.cups[0]?.refillAdds ?? [];
      toast(`Cup ${cup}: add ${adds.map((a) => `${a.grams} g ${a.material}`).join(', ') || 'nothing else'} to the fresh glaze`);
      onClose();
    },
  });
  return (
    <Modal
      title={`Fresh glaze for cup ${cup}`}
      description="Glazion gives the grams of every material already in the cup to add with it, so the cup stays the same recipe."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => refill.mutate()} disabled={refill.isPending || !(num(dry) > 0)}>
            {refill.isPending && <span className="spinner" />}
            Add fresh glaze
          </button>
        </>
      }
    >
      {refill.isError && (
        <div className="alert" role="alert">
          <Icon name="alert" size={18} />
          <span>{errorMessage(refill.error)}</span>
        </div>
      )}
      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor="refill-dry">
            Dry glaze
          </label>
          <div className="input-unit">
            <input id="refill-dry" className="input" inputMode="decimal" value={dry} onChange={(e) => setDry(e.target.value)} />
            <span aria-hidden="true">g</span>
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="refill-water">
            Water
          </label>
          <div className="input-unit">
            <input id="refill-water" className="input" inputMode="decimal" value={water} onChange={(e) => setWater(e.target.value)} />
            <span aria-hidden="true">g</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

const stepTitle = (s: ExperimentStepDto) =>
  s.kind === 'refill'
    ? `Fresh glaze in cup ${s.cups[0]?.number}`
    : `Stage ${s.stageNumber}${s.levels && s.levels > 1 ? `, step ${s.level} of ${s.levels}` : ''}: ${s.material}`;

function Experiment({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['experiments', id], queryFn: () => experimentsApi.getOne(id) });
  const [dialog, setDialog] = useState<{ kind: 'stages' } | { kind: 'refill'; cup: number } | null>(null);
  const e = query.data;
  const remove = useMutation({
    mutationFn: () => (e?.deletedAt ? experimentsApi.restore(id) : experimentsApi.remove(id)),
    onSuccess: (updated) => {
      queryClient.setQueryData(['experiments', id], updated);
      queryClient.invalidateQueries({ queryKey: ['experiments'] });
      toast(updated.deletedAt ? 'Experiment deleted. Its recipes and tiles stay.' : 'Experiment restored');
      if (updated.deletedAt) navigate('/experiments');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (query.isPending) return <Loading />;
  if (query.isError || !e) return <LoadError error={query.error} onRetry={() => query.refetch()} />;
  const current = e.current;
  const low = e.cups.filter((c) => c.needsGlaze);

  return (
    <>
      <header className="page-header">
        <div>
          <Link className="link-back" to="/experiments">
            <Icon name="chevron-left" size={16} />
            Experiments
          </Link>
          <h1 className="page-title">{e.name}</h1>
          <p className="page-sub">
            {e.participantDisplayName ?? `@${e.participantUsername}`}
            {e.participantCode ? ` (${e.participantCode})` : ''} · base {e.baseCode}
            {e.baseName ? ` · ${e.baseName}` : ''} · {e.cupCount} cups of {e.dryGrams} g dry + {e.waterGrams} g water · {e.tilesPerStep} tiles per step (
            {[...new Set(e.clayBodies)].map((c) => clayBodyLabel(c)).join(', ')})
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => setDialog({ kind: 'stages' })} disabled={!!e.deletedAt}>
            Change stages
          </button>
          <button className={e.deletedAt ? 'btn btn-primary' : 'btn btn-danger'} onClick={() => remove.mutate()} disabled={remove.isPending}>
            {e.deletedAt ? 'Restore' : 'Delete'}
          </button>
        </div>
      </header>

      <div className="content">
        <div className="stats">
          <div className="stat">
            <span className="stat-label">Steps done</span>
            <span className="stat-value">
              {e.progress.stepsDone}
              <span className="stat-note"> of {e.progress.stepsTotal}</span>
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Recipes made</span>
            <span className="stat-value">{e.progress.recipes}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Tiles dipped</span>
            <span className="stat-value">{e.progress.tiles}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Cups needing glaze</span>
            <span className="stat-value">{low.length}</span>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">Stages</h2>
          </div>
          <ul className="item-list card-list exp-stages">
            {e.stages.map((s) => (
              <li key={s.index} className="exp-stage-item">
                <details className="exp-stage">
                  <summary>
                    <span className="recipe-label">
                      <span className="recipe-label-head">
                        <span className="cell-strong">
                          Stage {s.number}: {s.material}
                        </span>
                        <span className="muted">{s.index === 0 ? 'Series · sets the cups' : s.mode === 'constant' ? 'Fixed' : 'Series'}</span>
                      </span>
                      <span className="muted">{s.summary}</span>
                    </span>
                    <span className={toneClass(s.stepsDone >= s.stepsTotal ? 'ok' : s.stepsDone > 0 || (current?.id && current.stageIndex === s.index) ? 'warn' : 'neutral')}>
                      {s.stepsDone >= s.stepsTotal
                        ? 'Done'
                        : current?.id && current.stageIndex === s.index
                          ? s.stepsTotal > 1
                            ? `Mixing step ${current.level} of ${s.stepsTotal}`
                            : 'Mixing now'
                          : s.stepsDone > 0
                            ? `${s.stepsDone} of ${s.stepsTotal}`
                            : 'Not started'}
                    </span>
                  </summary>
                  <StageCups experiment={e} stageIndex={s.index} />
                </details>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">{e.finished ? 'Finished' : current?.id ? 'Being mixed now' : 'Next step'}</h2>
            {current && <span className="muted">{stepTitle(current)}</span>}
          </div>
          {e.finished || !current ? (
            <Empty icon="check" title="Every step is done" text={`${e.progress.recipes} recipes and ${e.progress.tiles} tiles. Check the tiles on Tasks.`} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Cup</th>
                    <th>Target</th>
                    <th>Add</th>
                    <th>Glaze before dipping</th>
                    <th>Recipe</th>
                  </tr>
                </thead>
                <tbody>
                  {current.cups.map((c) => (
                    <tr key={c.number}>
                      <td className="cell-strong">Cup {c.number}</td>
                      {c.skipped ? (
                        <td colSpan={4} className="muted">
                          Too low: sits this step out until it gets fresh glaze.
                        </td>
                      ) : (
                        <>
                          <td>{c.targetPercent != null ? pct(c.targetPercent) : '—'}</td>
                          <td className="cell-strong">{c.addGrams} g</td>
                          <td className="muted">{c.wetBeforeGrams} g</td>
                          <td>{c.recipeCode ? <span className="tile-code">{c.recipeCode}</span> : <span className="muted">Code given at Start</span>}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">Cups now</h2>
            <span className="muted">Grams left, and the recipe in each cup</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Cup</th>
                  <th>Glaze left</th>
                  <th>Dry base</th>
                  <th>In it</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {e.cups.map((c) => (
                  <tr key={c.number}>
                    <td className="cell-strong">Cup {c.number}</td>
                    <td>{c.wetGrams} g</td>
                    <td className="muted">{c.dryGrams} g</td>
                    <td className="cell-wide">{c.materials.length ? c.materials.map((m) => `${pct(m.percent)} ${m.material}`).join(' + ') : <span className="muted">Base only</span>}</td>
                    <td className="cell-actions">
                      {c.needsGlaze && <span className="badge badge-bad">Needs glaze</span>}
                      <button className="btn btn-sm btn-secondary" onClick={() => setDialog({ kind: 'refill', cup: c.number })} disabled={!!current?.id || !!e.deletedAt}>
                        Fresh glaze
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">History</h2>
          </div>
          {e.history.length === 0 ? (
            <Empty icon="clock" title="Nothing yet" text="Steps show here once the tiles are dipped." />
          ) : (
            <ul className="item-list card-list">
              {[...e.history].reverse().map((s) => (
                <li key={s.id}>
                  <span className="recipe-label">
                    <span className="cell-strong">{stepTitle(s)}</span>
                    <span className="muted">
                      {s.kind === 'refill'
                        ? `${s.cups[0]?.freshDryGrams} g dry + ${s.cups[0]?.freshWaterGrams} g water, with ${(s.cups[0]?.refillAdds ?? []).map((a) => `${a.grams} g ${a.material}`).join(', ') || 'nothing else'}`
                        : `${s.cups.filter((c) => !c.skipped).length} recipes (${s.cups.find((c) => c.recipeCode)?.recipeCode ?? ''}…) · cup ${s.weighedCup} weighed ${s.weighedGrams} g, ${Math.round((1 - (s.retention ?? 1)) * 100)}% used`}
                    </span>
                  </span>
                  <span className="muted">
                    {s.actorUsername ? `@${s.actorUsername} · ` : ''}
                    {formatDateTime(s.dippedAt ?? s.startedAt ?? '')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {dialog?.kind === 'stages' && <EditStagesModal experiment={e} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'refill' && <RefillModal experiment={e} cup={dialog.cup} onClose={() => setDialog(null)} />}
    </>
  );
}

// ─── List ─────────────────────────────────────────────────────────────────────

function ExperimentList() {
  const navigate = useNavigate();
  const [showDeleted, setShowDeleted] = useState(false);
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['experiments', { deleted: showDeleted }], queryFn: () => experimentsApi.list({ deleted: showDeleted || undefined }) });
  const items = list.data ?? [];
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Cup experiments</h1>
          <p className="page-sub">
            Many recipes from a few cups of glaze. A participant adds materials stage by stage, dipping tiles after every change; Glazion gives the grams from what is
            left in each cup and a code for every recipe.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={18} />
          New experiment
        </button>
      </header>
      <div className="content">
        <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="Show">
            <button role="tab" aria-selected={!showDeleted} className={!showDeleted ? 'is-active' : ''} onClick={() => setShowDeleted(false)}>
              Experiments
            </button>
            <button role="tab" aria-selected={showDeleted} className={showDeleted ? 'is-active' : ''} onClick={() => setShowDeleted(true)}>
              Deleted
            </button>
          </div>
        </div>
        <div className="card">
          {list.isPending ? (
            <Loading />
          ) : list.isError ? (
            <LoadError error={list.error} onRetry={() => list.refetch()} />
          ) : items.length === 0 ? (
            <Empty
              icon="flask"
              title={showDeleted ? 'Nothing deleted' : 'No experiments yet'}
              text={showDeleted ? 'Experiments you delete wait here.' : 'Set one up: a base, a participant, the cups and the stages.'}
            />
          ) : (
            <div className="table-wrap">
              <table className="table table-clickable">
                <thead>
                  <tr>
                    <th>Experiment</th>
                    <th>Participant</th>
                    <th>Progress</th>
                    <th>Recipes</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id} onClick={() => navigate(`/experiments/${e.id}`)}>
                      <td className="cell-wide">
                        <div className="cell-strong">{e.name}</div>
                        <div className="muted">
                          {e.baseCode} · {e.cupCount} cups · {e.stages.map((s) => s.material).join(', ')}
                        </div>
                      </td>
                      <td>{e.participantDisplayName ?? `@${e.participantUsername}`}</td>
                      <td>
                        <span className={toneClass(e.finished ? 'ok' : e.cups.some((c) => c.needsGlaze) ? 'bad' : e.progress.stepsDone > 0 ? 'warn' : 'neutral')}>
                          {e.finished ? 'Finished' : `${e.progress.stepsDone} of ${e.progress.stepsTotal} steps`}
                        </span>
                      </td>
                      <td>{e.progress.recipes}</td>
                      <td className="muted">{formatRelativeTime(e.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {creating && <NewExperimentModal onClose={() => setCreating(false)} onCreated={(e) => navigate(`/experiments/${e.id}`)} />}
    </>
  );
}

/** /experiments lists them; /experiments/:id is one, with its stages, cups and steps. */
export default function ExperimentsPage() {
  const { id } = useParams();
  return id ? <Experiment key={id} id={id} /> : <ExperimentList />;
}

/** Every cup of one stage: what this stage adds and the whole mix the cup holds once it is in. */
function StageCups({ experiment: e, stageIndex }: { experiment: ExperimentDto; stageIndex: number }) {
  const stage = e.stages[stageIndex];
  const cups = Array.from({ length: e.cupCount }, (_, k) => k + 1);
  return (
    <div className="table-wrap exp-stage-cups">
      <table className="table">
        <thead>
          <tr>
            <th>Cup</th>
            <th>{stage.material}</th>
            <th>Combination after stage {stage.number}</th>
          </tr>
        </thead>
        <tbody>
          {cups.map((cup) => {
            const parts = e.stages
              .slice(0, stageIndex + 1)
              .map((s) => ({ material: s.material, pct: stageAmount(s, cup) }))
              .filter((p) => p.pct > 0);
            return (
              <tr key={cup}>
                <td className="cell-strong">Cup {cup}</td>
                <td>{amountText(stageAmount(stage, cup))}%</td>
                <td>{parts.length ? parts.map((p) => `${amountText(p.pct)}% ${p.material}`).join(' + ') : 'Nothing added'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
