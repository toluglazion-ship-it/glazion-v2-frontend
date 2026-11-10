import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { baseGlazesApi, errorMessage, experimentsApi } from '@glazion/api-client';
import {
  CLAY_BODIES,
  MAX_VARIATIONS_PER_BASE,
  type BaseGlazeDto,
  type ClayBody,
  type ExperimentDto,
  type RecipeDto,
  type UpdateExperimentRequest,
  type UserDto,
} from '@glazion/types';
import { Icon, Modal, formatDate, formatRelativeTime, recipeTitle, toast, toneClass } from '@glazion/ui';
import EditRecipeModal from '../components/EditRecipeModal';
import { FiringFields, coneValue, firingLabel } from '../components/FiringFields';
import Formulation from '../components/Formulation';
import { Empty, LoadError, Loading } from '../components/ListState';
import MaterialRows from '../components/MaterialRows';
import AssignTasksModal from '../components/AssignTasksModal';
import { AddVariationModal, AddVariationsModal, PromoteModal, nextCode, numbersLeft, useAllBases, useParticipants } from '../components/VariationModals';
import StageRows, { StageVariations, readStageRows, stageRecipes, stageRow, stageRowsFrom, type StageRow } from '../components/StageRows';
import { describeRows, draftRow, parseRows, readDraftRows, toDraftRows, type DraftRow } from '../lib/materials';
import { useAssignees } from '../lib/tasks';

function personFor(users: UserDto[], participantCode: string | null): string | null {
  const user = users.find((u) => u.participantCode === participantCode);
  return user ? (user.displayName ?? `@${user.username}`) : null;
}

// ─── Register or edit a base ──────────────────────────────────────────────────

const pad3 = (n: number) => String(n).padStart(3, '0');
/** The cups as the client set them out (meeting 2026-11-09): not on the form, the same for every base. */
const CUP_DEFAULTS = { dryGrams: 100, waterGrams: 60, tilesPerStep: 3, minReserveGrams: 10 };
/** A cup box's number, or the default when it is left blank (the client's ask: always fall back to 100 g, 60 g, 3 tiles). */
const orDefault = (text: string, fallback: number) => {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(n) ? fallback : n;
};

/**
 * Registers a base, or edits one, with the same form (the client's ask: editing is like adding). The base materials, then
 * the colorants, one stage each: they go into the participant's cups one after another, so registering a base with
 * colorants also sets up its cup experiment, and Edit shows them again from it. Opens once the base's experiment is loaded.
 */
function BaseFormModal(props: {
  base?: BaseGlazeDto;
  from?: BaseGlazeDto;
  onClose: () => void;
  onSaved: (base: BaseGlazeDto) => void;
  onNewFrom?: () => void;
  onEditVariation?: (recipe: RecipeDto) => void;
}) {
  const code = props.base?.code ?? null;
  const experiments = useQuery({
    queryKey: ['experiments', { baseCode: code }],
    queryFn: () => experimentsApi.list({ baseCode: code! }),
    enabled: !!code,
  });
  if (code && !experiments.isSuccess)
    return (
      <Modal title={`Edit ${code}`} onClose={props.onClose} size="lg">
        {experiments.isError ? <LoadError error={experiments.error} onRetry={() => experiments.refetch()} /> : <Loading />}
      </Modal>
    );
  return <BaseForm {...props} experiment={experiments.data?.[0] ?? null} />;
}

function BaseForm({
  base,
  from,
  experiment,
  onClose,
  onSaved,
  onNewFrom,
  onEditVariation,
}: {
  base?: BaseGlazeDto;
  from?: BaseGlazeDto;
  experiment: ExperimentDto | null;
  onClose: () => void;
  onSaved: (base: BaseGlazeDto) => void;
  onNewFrom?: () => void;
  onEditVariation?: (recipe: RecipeDto) => void;
}) {
  const queryClient = useQueryClient();
  const editing = !!base;
  const { participants, isPending: loadingPeople } = useParticipants();
  const { assignees } = useAssignees();
  const source = base ?? from;
  const [participantCode, setParticipantCode] = useState(source?.participantCode ?? '');
  const [derivedFrom, setDerivedFrom] = useState(base ? (base.derivedFromBaseCode ?? '') : (from?.code ?? ''));
  const [name, setName] = useState(base?.name ?? '');
  const [description, setDescription] = useState(base?.description ?? '');
  const [changeNote, setChangeNote] = useState(base?.changeNote ?? '');
  // A base made from another fires the same way unless changed here.
  const [cone, setCone] = useState(source?.cone ?? '');
  const [atmosphere, setAtmosphere] = useState(source?.atmosphere ?? '');
  const [rows, setRows] = useState<DraftRow[]>(() => (source?.formulation?.length ? toDraftRows(source.formulation) : [draftRow(), draftRow(), draftRow()]));
  const [stageRows, setStageRows] = useState<StageRow[]>(() => (experiment ? stageRowsFrom(experiment) : [stageRow()]));
  const [tried, setTried] = useState(false);

  // The materials lock once a tile of the base is checked and approved; the cups once the participant starts.
  const editable = !base || base.formulationEditable !== false;
  const started = !!experiment && (experiment.history.length > 0 || !!experiment.current?.id);
  // Until stage 1 starts (no recipe has its code yet) the base can go to another participant, taking their next number.
  const movable = !!base && !started && base.variationCount === 0 && (base.nextRecipeNumber ?? 1) <= 1;
  // The glaze in each cup and the tiles a stage: prefilled with the defaults, blank means the default.
  const [dry, setDry] = useState(String(experiment?.dryGrams ?? CUP_DEFAULTS.dryGrams));
  const [water, setWater] = useState(String(experiment?.waterGrams ?? CUP_DEFAULTS.waterGrams));
  const [tiles, setTiles] = useState(String(experiment?.tilesPerStep ?? CUP_DEFAULTS.tilesPerStep));

  // Their existing bases: what a new one can be a change of, and how the next number is worked out.
  const theirBases = useQuery({
    queryKey: ['base-glazes', { participantCode }],
    queryFn: () => baseGlazesApi.list(participantCode),
    enabled: !!participantCode && (!editing || participantCode !== base?.participantCode),
  });
  // A deleted base keeps its number, so the next one counts those too (as the API does).
  const deletedBases = useQuery({
    queryKey: ['base-glazes', { deleted: true }],
    queryFn: () => baseGlazesApi.deleted(),
    enabled: !!participantCode && (!editing || participantCode !== base?.participantCode),
  });
  const existing = theirBases.data ?? [];
  const numbered = [...existing, ...(deletedBases.data ?? []).filter((b) => b.participantCode === participantCode)];
  const moving = !!base && participantCode !== base.participantCode;
  const baseNumber = base && !moving ? base.baseNumber : numbered.reduce((n, b) => Math.max(n, b.baseNumber), 0) + 1;
  const baseCode = base && !moving ? base.code : participantCode && theirBases.isSuccess && deletedBases.isSuccess ? `${participantCode}-B${baseNumber}` : null;
  const owner = participants.find((u) => u.participantCode === participantCode);
  // The base's own participant mixes the cups (meeting 2026-11-09: no cup settings on this form).
  const maker = (!moving && experiment?.participantUserId) || (owner && assignees.some((u) => u.id === owner.id) ? owner.id : '');

  const formulation = readDraftRows(rows, { allowZero: false });
  const stages = readStageRows(stageRows);
  const hasStages = stages.stages.length > 0;
  const tilesPerStep = Math.round(orDefault(tiles, CUP_DEFAULTS.tilesPerStep));
  const groups = hasStages && !stages.problem ? stageRecipes(stages.stages, stages.cups, baseNumber) : [];
  const recipeCount = groups.reduce((n, g) => n + g.length, 0);

  // Each recipe's code: the real one once its step has started, else the next free numbers in order.
  const steps = [...(experiment?.history ?? []), ...(experiment?.current?.id ? [experiment.current] : [])].filter((s) => s.kind === 'mix');
  const actual = new Map<string, string>();
  for (const s of steps) for (const c of s.cups) if (c.recipeCode) actual.set(`${s.stageIndex}-${s.level}-${c.number}`, c.recipeCode);
  const codes = new Map<string, string>();
  let free = base ? (base.nextRecipeNumber ?? base.variationCount + 1) : 1;
  for (const group of groups)
    for (const r of group) {
      const key = `${r.stageIndex}-${r.level}-${r.cup}`;
      const real = actual.get(key);
      codes.set(key, real ?? (baseCode ? `${baseCode}-${pad3(free++)}` : '—'));
    }
  // Variations that aren't from the stages: made before them, or added one by one.
  const fromStages = new Set(steps.flatMap((s) => s.cups.map((c) => c.recipeId)).filter(Boolean));
  const others = [...(base?.recipes ?? [])].filter((r) => !fromStages.has(r.id)).sort((a, b) => (a.recipeNumber ?? 0) - (b.recipeNumber ?? 0));

  // The name and the notes are compulsory (meeting 2026-11-09): the notes explain the glaze for the search to come.
  const problem = !participantCode
    ? 'Choose whose base this is.'
    : !name.trim()
      ? 'Give the base a name.'
      : ((editable ? (formulation.problem ?? (formulation.rows.length === 0 ? 'Add the materials in the base.' : null)) : null) ??
        (derivedFrom && !changeNote.trim()
          ? 'Say what changed from the earlier base.'
          : (stages.problem ??
            (hasStages && !maker
              ? `${owner ? (owner.displayName ?? `@${owner.username}`) : 'This participant'} can’t take a cup experiment: their account isn’t active.`
              : !description.trim()
                ? 'Write the notes: what this base is, what is being tested and why. They are how it will be found later.'
                : hasStages && !(orDefault(dry, CUP_DEFAULTS.dryGrams) > 0)
                  ? 'Give the dry glaze per cup in grams, or leave it blank for 100 g.'
                  : hasStages && !(tilesPerStep >= 1 && tilesPerStep <= 12)
                    ? 'Dip 1 to 12 tiles a stage, or leave it blank for 3.'
                    : null))));

  const cupSettings = {
    tilesPerStep,
    clayBodies: (experiment?.clayBodies as ClayBody[] | undefined) ?? CLAY_BODIES.map((c) => c.value as ClayBody),
    minReserveGrams: experiment?.minReserveGrams ?? CUP_DEFAULTS.minReserveGrams,
  };
  const cupMix = { cups: stages.cups, dryGrams: orDefault(dry, CUP_DEFAULTS.dryGrams), waterGrams: orDefault(water, CUP_DEFAULTS.waterGrams) };
  const refresh = () => ['base-glazes', 'recipes', 'tasks', 'overview', 'experiments'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

  const register = useMutation({
    mutationFn: () =>
      baseGlazesApi.registerWithVariations({
        base: {
          participantCode,
          userId: owner?.id ?? null,
          name: name.trim() || null,
          description: description.trim() || null,
          formulation: formulation.rows,
          derivedFromBaseCode: derivedFrom || null,
          changeNote: derivedFrom ? changeNote.trim() : null,
          cone: coneValue(cone) || null,
          atmosphere: atmosphere || null,
        },
        variations: [],
        experiment: hasStages ? { participantUserId: maker, ...cupMix, ...cupSettings, stages: stages.stages } : null,
      }),
    onSuccess: (result) => {
      refresh();
      const e = result.experiment;
      toast(
        `Registered ${result.base.code ?? 'the base'}` +
          (e ? `. Its cups are ready for @${e.participantUsername}: ${e.stages.length} ${e.stages.length === 1 ? 'stage' : 'stages'}, ${recipeCount} recipes.` : ''),
      );
      onSaved(result.base);
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const b = base!;
      // The stages first: they are what is most likely to be refused (a stage the participant has just started).
      let e = experiment;
      if (hasStages) {
        const body: UpdateExperimentRequest = { stages: stages.stages, ...cupSettings, ...(started ? {} : { ...cupMix, participantUserId: maker }) };
        if (e) {
          // An experiment named after its base follows the base's name.
          if (e.name === (b.name ?? '') && name.trim() && name.trim() !== e.name) body.name = name.trim();
          e = await experimentsApi.update(e.id, body);
        } else {
          e = await experimentsApi.create({ name: name.trim() || b.name || null, baseCode: b.code!, participantUserId: maker, ...cupMix, ...cupSettings, stages: stages.stages });
        }
      } else if (e && !started) {
        await experimentsApi.remove(e.id);
        e = null;
      }
      const sameRows =
        JSON.stringify(formulation.rows) === JSON.stringify((b.formulation ?? []).map((r) => ({ rawName: r.rawName, amount: r.amount, unit: r.unit ?? '%' })));
      const firingChanged = coneValue(cone) !== (b.cone ?? '') || atmosphere !== (b.atmosphere ?? '');
      const result = await baseGlazesApi.update(b.code!, {
        name: name.trim() || null,
        description: description.trim(),
        changeNote: b.derivedFromBaseCode || changeNote.trim() ? changeNote.trim() : null,
        formulation: editable && !sameRows ? formulation.rows : null,
        // "" clears it; left out, unchanged.
        ...(editable && firingChanged ? { cone: coneValue(cone), atmosphere } : {}),
        ...(moving ? { participantCode } : {}),
      });
      return { result, experiment: e };
    },
    onSuccess: ({ result, experiment: e }) => {
      refresh();
      const n = result.variationsRebuilt;
      toast(
        (result.base.code !== base!.code ? `${base!.code} is now ${result.base.code}.` : `Saved ${base!.code}.`) +
          (n ? ` ${n} ${n === 1 ? 'variation now uses' : 'variations now use'} the corrected base.` : '') +
          (e ? ` ${e.stages.length} ${e.stages.length === 1 ? 'stage' : 'stages'} for @${e.participantUsername}.` : ''),
      );
      if (result.recalculationFailed.length)
        toast.error(
          `The chemistry of ${result.recalculationFailed.map((f) => f.recipeCode ?? 'a variation').join(', ')} could not be worked out again: ${result.recalculationFailed[0].message}`,
        );
      onSaved(result.base);
    },
  });
  const busy = register.isPending || save.isPending;
  const failed = register.isError ? register.error : save.isError ? save.error : null;

  function pickDerived(code: string) {
    setDerivedFrom(code);
    // Start from the earlier base's formulation, so only the change needs typing.
    const earlier = existing.find((b) => b.code === code);
    if (earlier?.formulation?.length) setRows(toDraftRows(earlier.formulation));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (problem || busy) return;
    if (editing) save.mutate();
    else register.mutate();
  }

  const person = owner ? `${owner.participantCode} · ${owner.displayName ?? `@${owner.username}`}` : participantCode;
  const totals =
    hasStages && !stages.problem
      ? `${stages.stages.length} ${stages.stages.length === 1 ? 'stage' : 'stages'} · ${stages.cups} ${stages.cups === 1 ? 'cup' : 'cups'} · ${recipeCount} recipes · ${recipeCount * tilesPerStep} tiles`
      : '';

  return (
    <Modal
      title={editing ? `Edit ${base!.code}${base!.name ? ` · ${base!.name}` : ''}` : 'Register a base glaze'}
      description={
        !editing
          ? 'Each colorant you add is a stage: it goes into the participant’s cups after the one before it. Once tiles of a base are made, a change is a new base: register it here and say what changed.'
          : editable
            ? 'The same as when you registered it. You can change anything until a tile is checked and approved. A stage locks once the participant starts it, because its colorant is already in the cups.'
            : 'A tile of this base has been checked and approved, so its materials stay as they are and its photos stay true. You can still fix the name and notes, and the stages that haven’t started.'
      }
      onClose={onClose}
      size="lg"
      footer={
        <>
          {totals && <span className="modal-foot-start muted">{totals}</span>}
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="base-form" type="submit" disabled={busy || (tried && !!problem)}>
            {busy && <span className="spinner" />}
            {editing ? 'Save changes' : baseCode ? `Register ${baseCode}` : 'Register base'}
          </button>
        </>
      }
    >
      <form id="base-form" className="form" onSubmit={handleSubmit}>
        {(failed || (tried && problem)) && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{failed ? errorMessage(failed) : problem}</span>
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="base-participant">
              Participant
            </label>
            {editing && !movable ? (
              <select id="base-participant" className="select" value={participantCode} disabled>
                <option value={participantCode}>{person}</option>
              </select>
            ) : (
              <select
                id="base-participant"
                className="select"
                value={participantCode}
                onChange={(e) => {
                  setParticipantCode(e.target.value);
                  if (!editing) setDerivedFrom('');
                }}
                disabled={!!from}
              >
                <option value="">{loadingPeople ? 'Loading…' : 'Choose a participant'}</option>
                {participants.map((u) => (
                  <option key={u.id} value={u.participantCode!}>
                    {u.participantCode} · {u.displayName ?? `@${u.username}`}
                  </option>
                ))}
              </select>
            )}
            {editing && (
              <span className="hint">
                {!movable
                  ? `${started ? 'Stage 1 has started: its' : 'Its'} recipes carry the code ${base!.code}, so it stays with ${base!.participantCode}.`
                  : moving
                    ? baseCode
                      ? `It becomes ${baseCode}, and ${owner ? (owner.displayName ?? `@${owner.username}`) : 'they'} will mix the cups.`
                      : 'Working out the new code…'
                    : 'You can give it to someone else until they start stage 1. It then takes their next number.'}
              </span>
            )}
            {!editing && !loadingPeople && participants.length === 0 && (
              <span className="hint">
                Nobody has a participant code yet. Add one on the <Link to="/users">Users</Link> page first.
              </span>
            )}
          </div>
          <div className="field">
            <label className="label" htmlFor="base-from">
              Changed from <span className="muted">(optional)</span>
            </label>
            {editing ? (
              <select id="base-from" className="select" value={derivedFrom} disabled>
                <option value={derivedFrom}>{derivedFrom || 'Nothing, it’s a new base'}</option>
              </select>
            ) : (
              <select id="base-from" className="select" value={derivedFrom} onChange={(e) => pickDerived(e.target.value)} disabled={!participantCode || !!from}>
                <option value="">Nothing, it’s a new base</option>
                {existing.map((b) => (
                  <option key={b.id} value={b.code ?? ''}>
                    {b.code}
                    {b.name ? ` · ${b.name}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {derivedFrom && (
          <div className="field">
            <label className="label" htmlFor="base-change">
              What changed from {derivedFrom}?
            </label>
            <input id="base-change" className="input" placeholder="e.g. Added 2% rutile" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} />
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="base-name">
            Name
          </label>
          <input
            id="base-name"
            className="input"
            placeholder={derivedFrom ? `e.g. ${derivedFrom.split('-').pop()} + 2% rutile` : 'e.g. Bamboo'}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <FiringFields idPrefix="base" cone={cone} atmosphere={atmosphere} onCone={setCone} onAtmosphere={setAtmosphere} disabled={!editable} />
        {!editable && <span className="hint">The firing stays as it is too, with the materials.</span>}

        <div className="field">
          <span className="label">Base materials</span>
          {editable ? (
            <>
              <MaterialRows rows={rows} onChange={setRows} addLabel="Add material" showTotal />
              <span className="hint">The base as it’s mixed, without the colorants below.</span>
            </>
          ) : (
            <>
              {base?.formulation?.length ? <Formulation rows={base.formulation} /> : <p className="muted">No formulation recorded.</p>}
              {(base?.formulationLockedBecause?.length ?? 0) > 0 && (
                <ul className="hint locked-because">
                  {base!.formulationLockedBecause!.slice(0, 5).map((why) => (
                    <li key={why}>{why}</li>
                  ))}
                  {base!.formulationLockedBecause!.length > 5 && <li>and {base!.formulationLockedBecause!.length - 5} more</li>}
                </ul>
              )}
              {onNewFrom && (
                <span className="hint">
                  To change the materials, register a new base from this one.{' '}
                  <button type="button" className="link-btn" onClick={onNewFrom}>
                    New base from {base!.code}
                  </button>
                </span>
              )}
            </>
          )}
        </div>

        <div className="field">
          <span className="label">Colorants</span>
          <StageRows rows={stageRows} onChange={setStageRows} />
          <span className="hint">
            Metallic oxides or stains, on top of the base. Each colorant is a stage, added to every cup after the one before. Series splits from–to into the steps,
            one amount per cup (0.5 to 5 in 10 steps is 0.5, 1 … 5); Fixed puts the same amount in every cup. Stage 1’s steps set the number of cups.
          </span>
        </div>

        <div className="field-row field-row-3">
          <div className="field">
            <label className="label" htmlFor="base-dry">
              Dry glaze per cup
            </label>
            <div className="input-unit">
              <input id="base-dry" className="input" inputMode="decimal" placeholder="100" value={dry} onChange={(e) => setDry(e.target.value)} disabled={started} />
              <span aria-hidden="true">g</span>
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="base-water">
              Water per cup
            </label>
            <div className="input-unit">
              <input id="base-water" className="input" inputMode="decimal" placeholder="60" value={water} onChange={(e) => setWater(e.target.value)} disabled={started} />
              <span aria-hidden="true">g</span>
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="base-tiles">
              Tiles each stage
            </label>
            <input
              id="base-tiles"
              className="input"
              inputMode="numeric"
              placeholder="3"
              value={tiles}
              onChange={(e) => /^[0-9]*$/.test(e.target.value) && setTiles(e.target.value)}
            />
          </div>
        </div>
        <span className="hint">
          {started
            ? 'The cups were filled when the first stage started, so the glaze in them stays as it is.'
            : 'Left blank, each cup gets 100 g of dry glaze and 60 g of water, and 3 tiles are dipped each stage.'}
        </span>

        {groups.length > 0 && (
          <div className="field">
            <span className="label">
              Variations, stage by stage <span className="muted">{recipeCount}</span>
            </span>
            <StageVariations stages={stages.stages} groups={groups} code={(r) => codes.get(`${r.stageIndex}-${r.level}-${r.cup}`) ?? null} collapsed={editing} />
            <span className="hint">What goes into each cup at every stage. Each recipe keeps everything added before it; the codes are given as the participant starts each stage.</span>
          </div>
        )}

        {experiment && (
          <p className="hint">
            <Link to={`/experiments/${experiment.id}`}>Open the cup experiment</Link> to follow it stage by stage.
          </p>
        )}

        {others.length > 0 && (
          <div className="field">
            <span className="label">
              Other variations <span className="muted">{others.length}</span>
            </span>
            <ul className="item-list">
              {others.map((recipe) => {
                const added = parseRows(recipe.additionsJson);
                return (
                  <li key={recipe.id}>
                    <span className="recipe-label">
                      <span className="recipe-label-head">
                        <span className="tile-code">{recipe.code}</span>
                        <span className="cell-strong">{recipeTitle(recipe)}</span>
                      </span>
                      <span className="muted">{added.length ? `+ ${describeRows(added)}` : 'The base as it is'}</span>
                    </span>
                    {onEditVariation && (
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => onEditVariation(recipe)}>
                        Edit colorants
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <span className="hint">Made before the stages, or added one by one. Each one’s colorants can be changed until a tile of it is checked and approved.</span>
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="base-desc">
            Notes
          </label>
          <textarea
            id="base-desc"
            className="textarea"
            placeholder="What this base is, what you are testing and why, e.g. how titanium changes this stain. Clay body, application."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <span className="hint">Required. The notes explain the glaze, so it can be searched and understood later.</span>
        </div>
      </form>
    </Modal>
  );
}

// ─── One base ─────────────────────────────────────────────────────────────────

function BaseModal({
  code,
  people,
  onClose,
  onOpenBase,
  onAddVariation,
  onAddSeries,
  onTweak,
  onPromote,
  onNewFrom,
}: {
  code: string;
  people: UserDto[];
  onClose: () => void;
  onOpenBase: (code: string) => void;
  onAddVariation: () => void;
  onAddSeries: () => void;
  onTweak: (recipe: RecipeDto) => void;
  onPromote: (recipe: RecipeDto) => void;
  onNewFrom: (base: BaseGlazeDto) => void;
}) {
  const base = useQuery({ queryKey: ['base-glazes', code], queryFn: () => baseGlazesApi.getOne(code) });
  // Its cup experiment: the colorant stages it was registered with.
  const experiments = useQuery({ queryKey: ['experiments', { baseCode: code }], queryFn: () => experimentsApi.list({ baseCode: code }) });
  const experiment = experiments.data?.[0];
  const allBases = useAllBases();
  const [editing, setEditing] = useState<RecipeDto | null>(null);
  const [editingBase, setEditingBase] = useState(false);
  const data = base.data;
  const variations = [...(data?.recipes ?? [])].sort((a, b) => (a.recipeNumber ?? 0) - (b.recipeNumber ?? 0));
  const person = data ? personFor(people, data.participantCode) : null;
  // The family: bases made from this one, and which of its variations became a base.
  const children = (allBases.data ?? []).filter((b) => b.derivedFromBaseCode === code);
  const becameBase = (recipe: RecipeDto) => (allBases.data ?? []).find((b) => b.promotedFromRecipeCode === recipe.code);
  const left = data ? numbersLeft(data) : 0;
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () => ['base-glazes', 'recipes', 'tasks', 'overview'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  const remove = useMutation({
    mutationFn: () => baseGlazesApi.remove(code),
    onSuccess: () => {
      refresh();
      toast(`${code} deleted with its variations. Restore it from Base glazes → Deleted.`);
      onClose();
    },
    onError: (err) => {
      setConfirmDelete(false);
      toast.error(errorMessage(err));
    },
  });
  const restore = useMutation({
    mutationFn: () => baseGlazesApi.restore(code),
    onSuccess: () => {
      refresh();
      toast(`${code} restored with its variations`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (editing) return <EditRecipeModal recipe={editing} onClose={() => setEditing(null)} />;
  if (editingBase && data)
    return (
      <BaseFormModal
        base={data}
        onClose={() => setEditingBase(false)}
        onSaved={(saved) => {
          setEditingBase(false);
          // Given to another participant: it has a new code, so open it under that.
          if (saved.code && saved.code !== code) onOpenBase(saved.code);
        }}
        onNewFrom={() => onNewFrom(data)}
        onEditVariation={(recipe) => {
          setEditingBase(false);
          setEditing(recipe);
        }}
      />
    );

  return (
    <Modal
      title={data ? `${data.code}${data.name ? ` · ${data.name}` : ''}` : code}
      description={data ? `${person ? `${person} (${data.participantCode})` : `Participant ${data.participantCode}`}. Registered ${formatDate(data.createdAt)}.` : undefined}
      onClose={onClose}
      size="lg"
      footer={
        data &&
        (data.deletedAt ? (
          <>
            <span className="modal-foot-start muted">Deleted {formatRelativeTime(data.deletedAt)}, with its variations.</span>
            <button className="btn btn-primary" onClick={() => restore.mutate()} disabled={restore.isPending}>
              {restore.isPending && <span className="spinner" />}
              Restore
            </button>
          </>
        ) : confirmDelete ? (
          <>
            <span className="modal-foot-start muted">
              Delete {data.code} and its {data.variationCount} {data.variationCount === 1 ? 'variation' : 'variations'}? Their tiles are taken back from whoever
              has them.
            </span>
            <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
            <button className="btn btn-danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending && <span className="spinner" />}
              Delete
            </button>
          </>
        ) : (
          <>
            {data.formulationEditable !== false && (
              <button className="btn btn-danger modal-foot-start" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => setEditingBase(true)}>
              Edit base
            </button>
            <button className="btn btn-secondary" onClick={() => onNewFrom(data)}>
              New base from this
            </button>
            <button className="btn btn-secondary" onClick={onAddSeries} disabled={left === 0}>
              Add a series
            </button>
            <button className="btn btn-primary" onClick={onAddVariation} disabled={left === 0}>
              <Icon name="plus" size={18} />
              Add variation
            </button>
          </>
        ))
      }
    >
      {base.isError ? (
        <LoadError error={base.error} onRetry={() => base.refetch()} />
      ) : !data ? (
        <Loading />
      ) : (
        <div className="base-detail">
          {data.promotedFromRecipeCode ? (
            <div className="note">
              <div className="note-label">
                Made from the variation <span className="tile-code">{data.promotedFromRecipeCode}</span>
                {data.derivedFromBaseCode && (
                  <>
                    {' '}
                    of{' '}
                    <button className="link-btn" onClick={() => onOpenBase(data.derivedFromBaseCode!)}>
                      {data.derivedFromBaseCode}
                    </button>
                  </>
                )}
              </div>
              {data.changeNote ?? 'A variation that came out well, now a base of its own.'}
            </div>
          ) : (
            data.derivedFromBaseCode && (
              <div className="note">
                <div className="note-label">
                  Changed from{' '}
                  <button className="link-btn" onClick={() => onOpenBase(data.derivedFromBaseCode!)}>
                    {data.derivedFromBaseCode}
                  </button>
                </div>
                {data.changeNote ?? 'No note on what changed.'}
              </div>
            )
          )}
          {left === 0 && (
            <div className="alert alert-warn">
              <Icon name="alert" size={18} />
              <span>All {MAX_VARIATIONS_PER_BASE} variation numbers are used. Make a good variation a base to keep testing from it.</span>
            </div>
          )}
          {data.description && <p className="muted">{data.description}</p>}

          <section>
            <h3 className="section-label">Firing</h3>
            <p className={firingLabel(data.cone, data.atmosphere) ? undefined : 'muted'}>{firingLabel(data.cone, data.atmosphere) ?? 'Not recorded. Edit the base to add its cone and atmosphere.'}</p>
          </section>

          <section>
            <h3 className="section-label">Formulation</h3>
            {data.formulation?.length ? <Formulation rows={data.formulation} /> : <p className="muted">No formulation recorded.</p>}
          </section>

          {experiment && (
            <section>
              <h3 className="section-label">
                Colorant stages <span className="muted">{experiment.stages.length}</span>
              </h3>
              <ul className="item-list">
                {experiment.stages.map((s) => (
                  <li key={s.index}>
                    <span className="recipe-label">
                      <span className="cell-strong">
                        Stage {s.number} · {s.material}
                      </span>
                      <span className="muted">{s.summary}</span>
                    </span>
                    <span className={toneClass(s.stepsDone >= s.stepsTotal ? 'ok' : !s.editable ? 'warn' : 'neutral')}>
                      {s.stepsDone >= s.stepsTotal ? 'Done' : s.editable ? 'Not started' : s.stepsTotal > 1 ? `${s.stepsDone} of ${s.stepsTotal} steps` : 'Being mixed'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted">
                {experiment.cupCount} cups for {experiment.participantDisplayName ?? `@${experiment.participantUsername}`} · {experiment.progress.stepsDone} of{' '}
                {experiment.progress.stepsTotal} steps done · <Link to={`/experiments/${experiment.id}`}>Open the cup experiment</Link>
              </p>
            </section>
          )}

          <section>
            <h3 className="section-label">
              Variations <span className="muted">{variations.length}</span>
              {left > 0 && left < 100 && <span className="muted"> · {left} numbers left</span>}
            </h3>
            {variations.length === 0 ? (
              <p className="muted">None yet. The first one will be {nextCode(data) ?? `${data.code}-001`}.</p>
            ) : (
              <ul className="item-list">
                {variations.map((recipe) => {
                  const added = parseRows(recipe.additionsJson);
                  const became = becameBase(recipe);
                  return (
                    <li key={recipe.id}>
                      <span className="recipe-label">
                        <span className="recipe-label-head">
                          <span className="tile-code">{recipe.code}</span>
                          <span className="cell-strong">{recipeTitle(recipe)}</span>
                        </span>
                        <span className="muted">{added.length ? `+ ${describeRows(added)}` : 'The base as it is'}</span>
                        {recipe.outcomeNote && <span className="outcome">{recipe.outcomeNote}</span>}
                      </span>
                      {!recipe.isActive && <span className="badge">Inactive</span>}
                      {became ? (
                        <button className="btn btn-sm btn-ghost" onClick={() => became.code && onOpenBase(became.code)} title="Open the base it became">
                          Became {became.code}
                        </button>
                      ) : (
                        <button className="btn btn-sm btn-ghost" onClick={() => onPromote(recipe)} disabled={!recipe.code}>
                          Make base
                        </button>
                      )}
                      <button className="btn btn-sm btn-ghost" onClick={() => onTweak(recipe)} disabled={left === 0} title="A new variation starting from this one">
                        Tweak
                      </button>
                      <button className="btn btn-sm btn-secondary" onClick={() => setEditing(recipe)}>
                        Edit
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {children.length > 0 && (
            <section>
              <h3 className="section-label">
                Bases made from this <span className="muted">{children.length}</span>
              </h3>
              <ul className="item-list">
                {children.map((child) => (
                  <li key={child.id}>
                    <span className="recipe-label">
                      <span className="recipe-label-head">
                        <span className="tile-code">{child.code}</span>
                        <span className="cell-strong">{child.name ?? '—'}</span>
                      </span>
                      <span className="muted">{child.promotedFromRecipeCode ? `From the variation ${child.promotedFromRecipeCode}` : (child.changeNote ?? 'Changed base')}</span>
                    </span>
                    <button className="btn btn-sm btn-secondary" onClick={() => child.code && onOpenBase(child.code)}>
                      Open
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Dialog =
  | { kind: 'register'; from?: BaseGlazeDto }
  | { kind: 'base'; code: string }
  | { kind: 'variation'; code: string; from?: RecipeDto }
  | { kind: 'series'; code: string }
  | { kind: 'promote'; code: string; recipe: RecipeDto }
  | { kind: 'assign'; code: string; recipes: RecipeDto[] }
  | null;

/**
 * The family tree as rows: each base followed by the bases made from it (changed bases and
 * promoted variations), indented. A base whose parent isn't in the list starts its own tree.
 */
function familyRows(list: BaseGlazeDto[]): { base: BaseGlazeDto; depth: number }[] {
  const codes = new Set(list.map((b) => b.code));
  const byParent = new Map<string | null, BaseGlazeDto[]>();
  for (const b of list) {
    const parent = b.derivedFromBaseCode && codes.has(b.derivedFromBaseCode) ? b.derivedFromBaseCode : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), b]);
  }
  const rows: { base: BaseGlazeDto; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const b of byParent.get(parent) ?? []) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      rows.push({ base: b, depth });
      if (b.code) walk(b.code, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

export default function BaseGlazesPage() {
  const [participant, setParticipant] = useState('');
  // "Became P01-B2" on Tile recipes links here with ?base=P01-B2, which opens that base.
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<Dialog>(() => {
    const code = params.get('base');
    return code ? { kind: 'base', code } : null;
  });
  useEffect(() => {
    if (params.has('base')) setParams({}, { replace: true });
  }, [params, setParams]);
  const { participants } = useParticipants();

  // The register, or the deleted bases (to restore).
  const [showDeleted, setShowDeleted] = useState(false);
  const bases = useQuery({
    queryKey: ['base-glazes', { participantCode: participant, deleted: showDeleted }],
    queryFn: () => (showDeleted ? baseGlazesApi.deleted() : baseGlazesApi.list(participant || undefined)),
  });
  const list = (bases.data ?? []).filter((b) => !showDeleted || !participant || b.participantCode === participant);
  const rows = familyRows(list);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Base glazes</h1>
          <p className="page-sub">The register behind every tile code: participant, base, then variation, as in P01-B1-002. Bases made from another sit under it.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setDialog({ kind: 'register' })}>
          <Icon name="plus" size={18} />
          Register base
        </button>
      </header>

      <div className="content">
        <div className="toolbar">
          <select className="select toolbar-select" value={participant} onChange={(e) => setParticipant(e.target.value)} aria-label="Participant">
            <option value="">All participants</option>
            {participants.map((u) => (
              <option key={u.id} value={u.participantCode!}>
                {u.participantCode} · {u.displayName ?? `@${u.username}`}
              </option>
            ))}
          </select>
          <div className="segmented" role="tablist" aria-label="Show">
            <button role="tab" aria-selected={!showDeleted} className={!showDeleted ? 'is-active' : ''} onClick={() => setShowDeleted(false)}>
              Register
            </button>
            <button role="tab" aria-selected={showDeleted} className={showDeleted ? 'is-active' : ''} onClick={() => setShowDeleted(true)}>
              Deleted
            </button>
          </div>
        </div>

        <div className="card">
          {bases.isPending ? (
            <Loading />
          ) : bases.isError ? (
            <LoadError error={bases.error} onRetry={() => bases.refetch()} />
          ) : list.length === 0 && showDeleted ? (
            <Empty icon="trash" title="Nothing deleted" text="Bases you delete wait here with their variations, so you can bring them back." />
          ) : list.length === 0 ? (
            <Empty
              icon="flask"
              title={participant ? `No bases for ${participant} yet` : 'No base glazes yet'}
              text="Register a participant’s base glaze with its full formulation, then add the variations to test on it."
              action={
                <button className="btn btn-primary" onClick={() => setDialog({ kind: 'register' })}>
                  Register base
                </button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table table-clickable">
                <thead>
                  <tr>
                    <th>Base</th>
                    <th>Name</th>
                    <th>Participant</th>
                    <th>Variations</th>
                    <th>Next code</th>
                    <th>Registered</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ base, depth }) => (
                    <tr key={base.id} onClick={() => base.code && setDialog({ kind: 'base', code: base.code })}>
                      <td>
                        <span className="tree-cell" style={{ paddingLeft: `${Math.min(depth, 6) * 20}px` }}>
                          {depth > 0 && (
                            <span className="tree-branch" aria-hidden="true">
                              └
                            </span>
                          )}
                          <span className="tile-code">{base.code}</span>
                        </span>
                      </td>
                      <td className="cell-wide">
                        <div className="cell-strong">{base.name ?? '—'}</div>
                        {base.promotedFromRecipeCode ? (
                          <div className="muted cell-clamp">From the variation {base.promotedFromRecipeCode}</div>
                        ) : (
                          base.derivedFromBaseCode && (
                            <div className="muted cell-clamp">
                              From {base.derivedFromBaseCode}
                              {base.changeNote ? `: ${base.changeNote}` : ''}
                            </div>
                          )
                        )}
                      </td>
                      <td>
                        <div>{base.participantCode ?? '—'}</div>
                        {personFor(participants, base.participantCode) && <div className="muted">{personFor(participants, base.participantCode)}</div>}
                      </td>
                      <td>{base.variationCount}</td>
                      <td className="mono muted">{nextCode(base) ?? (numbersLeft(base) === 0 ? 'Full' : '—')}</td>
                      <td className="muted">{base.deletedAt ? `Deleted ${formatRelativeTime(base.deletedAt)}` : formatRelativeTime(base.createdAt)}</td>
                      <td className="cell-actions">
                        {base.deletedAt ? (
                          <button className="btn btn-sm btn-secondary" onClick={() => base.code && setDialog({ kind: 'base', code: base.code })}>
                            Open to restore
                          </button>
                        ) : (
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (base.code) setDialog({ kind: 'variation', code: base.code });
                            }}
                            disabled={numbersLeft(base) === 0}
                          >
                            Add variation
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.length > 0 && (
            <div className="table-foot">
              <span className="muted">
                {list.length} {list.length === 1 ? 'base' : 'bases'}
              </span>
            </div>
          )}
        </div>
      </div>

      {dialog?.kind === 'register' && (
        <BaseFormModal
          from={dialog.from}
          onClose={() => setDialog(null)}
          onSaved={(base) => setDialog(base.code ? { kind: 'base', code: base.code } : null)}
        />
      )}
      {dialog?.kind === 'base' && (
        <BaseModal
          key={dialog.code}
          code={dialog.code}
          people={participants}
          onClose={() => setDialog(null)}
          onOpenBase={(code) => setDialog({ kind: 'base', code })}
          onAddVariation={() => setDialog({ kind: 'variation', code: dialog.code })}
          onAddSeries={() => setDialog({ kind: 'series', code: dialog.code })}
          onTweak={(recipe) => setDialog({ kind: 'variation', code: dialog.code, from: recipe })}
          onPromote={(recipe) => setDialog({ kind: 'promote', code: dialog.code, recipe })}
          onNewFrom={(base) => setDialog({ kind: 'register', from: base })}
        />
      )}
      {dialog?.kind === 'variation' && (
        <AddVariationModal
          code={dialog.code}
          from={dialog.from}
          onClose={() => setDialog({ kind: 'base', code: dialog.code })}
          onCreated={(recipes) => setDialog({ kind: 'assign', code: dialog.code, recipes })}
        />
      )}
      {dialog?.kind === 'series' && (
        <AddVariationsModal
          code={dialog.code}
          onClose={() => setDialog({ kind: 'base', code: dialog.code })}
          onCreated={(recipes) => setDialog({ kind: 'assign', code: dialog.code, recipes })}
        />
      )}
      {dialog?.kind === 'assign' && <AssignTasksModal recipes={dialog.recipes} onClose={() => setDialog({ kind: 'base', code: dialog.code })} />}
      {dialog?.kind === 'promote' && (
        <PromoteModal
          recipe={dialog.recipe}
          onClose={() => setDialog({ kind: 'base', code: dialog.code })}
          onPromoted={(base) => setDialog(base.code ? { kind: 'base', code: base.code } : null)}
        />
      )}
    </>
  );
}
