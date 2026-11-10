import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, myExperimentsApi } from '@glazion/api-client';
import type { ExperimentDto, ExperimentStageDto, ExperimentStepDto } from '@glazion/types';
import { Icon, clayBodyLabel, toast } from '@glazion/ui';

const pct = (n: number | null | undefined) => (n == null ? '—' : `${Number(n.toFixed(4))}%`);
const grams = (n: number | null | undefined) => (n == null ? '—' : `${Number(n.toFixed(3))} g`);

/** "Stage 2: Titanium Dioxide". */
function stepLabel(s: ExperimentStepDto): string {
  return `Stage ${s.stageNumber}: ${s.material}`;
}

/** The % of a stage's colorant in a cup: its own place in a series, or the fixed amount. */
const amountIn = (s: ExperimentStageDto, cup: number) => (s.mode === 'constant' ? s.constant : s.start + s.step * (cup - 1));

/**
 * Every stage, each opening to what goes into every cup (meeting 2026-11-09): the participant can look ahead at any
 * stage, but only starts the one that is next. Codes show once a stage has started.
 */
function StageList({ e }: { e: ExperimentDto }) {
  const steps = [...e.history, ...(e.current?.id ? [e.current] : [])].filter((s) => s.kind === 'mix');
  const shortBase = e.baseCode.split('-').pop(); // "B3", as recipe names start
  return (
    <div className="exp-stages">
      {e.stages.map((s) => {
        const done = s.stepsDone >= s.stepsTotal;
        const now = e.current?.stageIndex === s.index;
        const step = steps.find((x) => x.stageIndex === s.index);
        return (
          <details key={s.index} className={`exp-stage${done ? ' is-done' : now ? ' is-current' : ''}`}>
            <summary>
              <span className="exp-stage-number">{done ? <Icon name="check" size={14} /> : s.number}</span>
              <span className="exp-stage-text">
                <strong>
                  Stage {s.number}: {s.material}
                </strong>
                <span className="muted"> · {s.summary}</span>
              </span>
              <span className="exp-stage-state">{done ? 'Completed' : now ? (e.current?.id ? 'Now' : 'Next') : 'Later'}</span>
            </summary>
            <ul className="list">
              {Array.from({ length: e.cupCount }, (_, k) => {
                const cup = k + 1;
                const code = step?.cups.find((c) => c.number === cup)?.recipeCode;
                const mix = e.stages
                  .slice(0, s.index + 1)
                  .map((t) => ({ material: t.material, p: amountIn(t, cup) }))
                  .filter((x) => x.p > 0)
                  .map((x) => `${pct(x.p)} ${x.material}`)
                  .join(' + ');
                return (
                  <li key={cup} className="row row-static">
                    <span className="row-body">
                      <span className="row-title">
                        Cup {cup} {code && <span className="tile-code row-code">{code}</span>}
                      </span>
                      <span className="row-text">
                        {shortBase} + {mix}
                      </span>
                    </span>
                    <span className="exp-grams">
                      {pct(amountIn(s, cup))}
                      <span className="muted"> {s.material}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {!done && !now && <p className="hint">You can start this stage once the one before it is completed.</p>}
          </details>
        );
      })}
    </div>
  );
}

/** The fresh-glaze form for a cup that ran low (done with the admin). Shows the grams of each material to add after. */
function Refill({ experiment, cup, onDone }: { experiment: ExperimentDto; cup: number; onDone: (e: ExperimentDto) => void }) {
  const [dry, setDry] = useState(String(experiment.dryGrams));
  const [water, setWater] = useState(String(experiment.waterGrams));
  const refill = useMutation({
    mutationFn: () => myExperimentsApi.refill(experiment.id, cup, { dryGrams: Number(dry.replace(',', '.')), waterGrams: Number(water.replace(',', '.')) || 0 }),
    onSuccess: onDone,
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <form
      className="exp-refill"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!refill.isPending) refill.mutate();
      }}
    >
      <span className="row-text">With your admin, pour fresh glaze into cup {cup}, then say how much:</span>
      <div className="exp-inline">
        <label className="input-unit">
          <input className="input" inputMode="decimal" value={dry} onChange={(e) => setDry(e.target.value)} aria-label={`Cup ${cup}: fresh dry glaze, grams`} />
          <span>g dry</span>
        </label>
        <label className="input-unit">
          <input className="input" inputMode="decimal" value={water} onChange={(e) => setWater(e.target.value)} aria-label={`Cup ${cup}: water, grams`} />
          <span>g water</span>
        </label>
        <button className="btn btn-secondary btn-sm" disabled={refill.isPending || !(Number(dry.replace(',', '.')) > 0)}>
          {refill.isPending ? <span className="spinner" /> : 'Fresh glaze added'}
        </button>
      </div>
    </form>
  );
}

/**
 * One cup experiment, stage by stage (meetings 2026-11-02 and 11-09). Start the stage to see each cup's grams and its
 * new code, add and mix, write the code on the back of the tiles and dip them, then say the stage is completed; the
 * next one opens at once. No weighing for now: the app takes a set amount of glaze per tile.
 */
export default function ExperimentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['my-experiments', id], queryFn: () => myExperimentsApi.getOne(id) });
  const e = query.data;
  const [refilling, setRefilling] = useState<number | null>(null);

  function update(next: ExperimentDto) {
    queryClient.setQueryData(['my-experiments', id], next);
    queryClient.invalidateQueries({ queryKey: ['my-experiments'], exact: true });
    queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
  }
  const start = useMutation({ mutationFn: () => myExperimentsApi.start(id), onSuccess: update, onError: (err) => toast.error(errorMessage(err)) });
  const undo = useMutation({ mutationFn: () => myExperimentsApi.cancelStep(id), onSuccess: update, onError: (err) => toast.error(errorMessage(err)) });
  const dipped = useMutation({
    mutationFn: () => myExperimentsApi.dipped(id, {}),
    onSuccess: (next) => {
      update(next);
      toast(next.finished ? 'Last stage completed. Your admin checks the tiles next.' : `Stage ${next.current?.stageNumber ?? ''} is ready.`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (query.isPending)
    return (
      <main className="page">
        <div className="page-loading">
          <span className="spinner spinner-lg" />
        </div>
      </main>
    );
  if (!e)
    return (
      <main className="page">
        <div className="empty">
          <div className="empty-title">Couldn’t load this experiment</div>
          <p className="empty-text">{errorMessage(query.error)}</p>
          <Link className="btn btn-secondary" to="/">
            Back
          </Link>
        </div>
      </main>
    );

  const current = e.current;
  const open = !!current?.id;
  const included = current?.cups.filter((c) => !c.skipped) ?? [];
  const lastRefill = [...e.history].reverse().find((s) => s.kind === 'refill');
  const low = e.cups.filter((c) => c.needsGlaze);

  return (
    <>
      <header className="topbar">
        <button className="btn btn-ghost btn-icon" onClick={() => navigate('/')} aria-label="Back to your tasks">
          <Icon name="chevron-left" size={22} />
        </button>
        <h1 className="topbar-title truncate">{e.name}</h1>
        <span className="topbar-spacer topbar-count muted">
          {e.finished ? 'Done' : `Stage ${Math.min(e.progress.stepsDone + 1, e.progress.stepsTotal)} of ${e.progress.stepsTotal}`}
        </span>
      </header>

      <main className="page">
        <p className="page-sub">
          Base {e.baseCode}
          {e.baseName ? ` · ${e.baseName}` : ''} · {e.cupCount} cups · {e.progress.recipes} recipes so far
        </p>
        {/* Every stage, done or to come; each opens to what goes into every cup. */}
        <StageList e={e} />

        {e.finished || !current ? (
          <div className="empty">
            <div className="empty-icon">
              <Icon name="check" size={22} />
            </div>
            <div className="empty-title">Every stage is completed</div>
            <p className="empty-text">
              {e.progress.recipes} recipes, {e.progress.tiles} tiles. Your admin checks them; then they show under To photo.
            </p>
          </div>
        ) : (
          <section className="exp-step">
            <h2 className="section-title">{open ? 'Now' : 'Next'}: {stepLabel(current)}</h2>
            {!open ? (
              <>
                <p className="row-text">
                  Press Start to get a code for each cup. Then add the {current.material} below to each cup, mix, write its code on the back of {e.tilesPerStep}{' '}
                  {e.tilesPerStep === 1 ? 'tile' : 'tiles'} ({[...new Set(e.clayBodies)].map((c) => clayBodyLabel(c)?.toLowerCase()).join(', ')}) and dip them.
                </p>
                <ul className="list">
                  {current.cups.map((c) => (
                    <li key={c.number} className="row row-static">
                      <span className="row-body">
                        <span className="row-title">Cup {c.number}</span>
                        <span className="row-text">{c.skipped ? 'Too low: add fresh glaze first, or it sits this stage out.' : `${pct(c.targetPercent)} ${current.material}`}</span>
                      </span>
                      {!c.skipped && <span className="exp-grams">{grams(c.addGrams)}</span>}
                    </li>
                  ))}
                </ul>
                <button className="btn btn-primary btn-block" onClick={() => start.mutate()} disabled={start.isPending || included.length === 0}>
                  {start.isPending ? <span className="spinner" /> : <Icon name="flask" size={18} />}
                  Start stage {current.stageNumber}
                </button>
              </>
            ) : (
              <>
                <ol className="exp-howto">
                  <li>Add the {current.material} to each cup and mix well.</li>
                  <li>
                    Write each cup’s code on the back of its {e.tilesPerStep} {e.tilesPerStep === 1 ? 'tile' : 'tiles'} and dip them.
                  </li>
                  <li>Then press “Stage {current.stageNumber} completed”. The next stage opens straight away.</li>
                </ol>
                <ul className="list">
                  {current.cups.map((c) => (
                    <li key={c.number} className="row row-static">
                      <span className="row-body">
                        <span className="row-title">
                          Cup {c.number} {c.recipeCode && <span className="tile-code row-code">{c.recipeCode}</span>}
                        </span>
                        <span className="row-text">{c.skipped ? 'Sits this stage out (too low).' : c.recipeName}</span>
                      </span>
                      {!c.skipped && (
                        <span className="exp-grams">
                          + {grams(c.addGrams)}
                          <span className="muted"> {current.material}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <button className="btn btn-primary btn-block" onClick={() => dipped.mutate()} disabled={dipped.isPending}>
                  {dipped.isPending ? <span className="spinner" /> : <Icon name="check" size={18} />}
                  Stage {current.stageNumber} completed
                </button>
                <button className="btn btn-ghost btn-block" onClick={() => undo.mutate()} disabled={undo.isPending}>
                  Started by mistake? Undo this stage
                </button>
              </>
            )}
          </section>
        )}

        {low.length > 0 && (
          <section>
            <h2 className="section-title">Running low</h2>
            <ul className="list">
              {low.map((c) => (
                <li key={c.number} className="row row-static row-waiting">
                  <span className="row-body">
                    <span className="row-title">
                      Cup {c.number} · {grams(c.wetGrams)} left
                    </span>
                    {refilling === c.number ? (
                      <Refill
                        experiment={e}
                        cup={c.number}
                        onDone={(next) => {
                          update(next);
                          setRefilling(null);
                        }}
                      />
                    ) : (
                      <>
                        <span className="row-text">Too little for another dip. Ask your admin for fresh glaze.</span>
                        <span className="row-actions">
                          <button className="btn btn-secondary btn-sm" onClick={() => setRefilling(c.number)} disabled={open}>
                            Add fresh glaze
                          </button>
                        </span>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {lastRefill && lastRefill.cups[0] && (
          <div className="alert alert-info" role="note">
            <Icon name="info" size={18} />
            <span>
              Cup {lastRefill.cups[0].number}: with the fresh glaze, add{' '}
              {(lastRefill.cups[0].refillAdds ?? []).map((a) => `${grams(a.grams)} ${a.material}`).join(', ') || 'nothing else'}, so it stays the same recipe.
            </span>
          </div>
        )}

        <details className="tasks-sent">
          <summary>What’s in each cup</summary>
          <ul className="list">
            {e.cups.map((c) => (
              <li key={c.number} className="row row-static">
                <span className="row-body">
                  <span className="row-title">Cup {c.number}</span>
                  <span className="row-text">{c.materials.length ? c.materials.map((m) => `${pct(m.percent)} ${m.material}`).join(' + ') : 'Base only'}</span>
                </span>
                <span className="muted">{grams(c.wetGrams)}</span>
              </li>
            ))}
          </ul>
        </details>
      </main>
    </>
  );
}
