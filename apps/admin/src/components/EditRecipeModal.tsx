import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, recipesApi } from '@glazion/api-client';
import type { MaterialRow, RecipeDto } from '@glazion/types';
import { Icon, Modal, recipeTitle, toast } from '@glazion/ui';
import { describeRows, formatQuantity, readDraftRows, recipeMixture, toDraftRows, type DraftRow } from '../lib/materials';
import { FiringFields, coneValue, firingLabel } from './FiringFields';
import Formulation from './Formulation';
import MaterialRows from './MaterialRows';

/** "B2 + 1% Copper Carbonate", the client's naming, from the base code ("P01-B2") and the additions. */
function autoName(baseCode: string, additions: MaterialRow[]): string {
  const short = baseCode.split('-').pop() ?? baseCode;
  return `${short} + ${additions.length ? additions.map((r) => `${formatQuantity(r)} ${r.rawName}`).join(' + ') : 'nothing added'}`;
}

const sameRows = (a: MaterialRow[], b: MaterialRow[]) =>
  JSON.stringify(a.map((r) => [r.rawName, r.amount, r.unit ?? '%'])) === JSON.stringify(b.map((r) => [r.rawName, r.amount, r.unit ?? '%']));

/**
 * One recipe. Until an admin checks and approves a tile of it, everything can change (meeting 2026-11-02), including a
 * variation's colorants; participants who already started it are told. It can be deleted, and restored later.
 */
export default function EditRecipeModal({ recipe: listed, onClose }: { recipe: RecipeDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  // The list doesn't say whether it is still editable; this recipe's own answer does.
  const one = useQuery({ queryKey: ['recipes', 'one', listed.id], queryFn: () => recipesApi.getOne(listed.id) });
  const recipe = one.data ?? listed;
  const mixEditable = one.data?.mixEditable === true;
  const locks = one.data?.mixLockedBecause ?? [];
  const mixture = recipeMixture(recipe);
  const isVariation = !!recipe.baseCode && mixture.base.length > 0;

  const [name, setName] = useState(listed.name ?? '');
  const [description, setDescription] = useState(listed.description ?? '');
  const [isActive, setIsActive] = useState(listed.isActive);
  const [outcomeNote, setOutcomeNote] = useState(listed.outcomeNote ?? '');
  // Its own firing; empty follows its base.
  const [cone, setCone] = useState(listed.cone ?? '');
  const [atmosphere, setAtmosphere] = useState(listed.atmosphere ?? '');
  const [rows, setRows] = useState<DraftRow[]>(() => toDraftRows(recipeMixture(listed).additions));
  // Only colorants the admin has touched are checked and sent.
  const [touched, setTouched] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const firingChanged = coneValue(cone) !== (recipe.cone ?? '') || atmosphere !== (recipe.atmosphere ?? '');
  const baseFiring = recipe.baseCode && !recipe.cone && !recipe.atmosphere ? firingLabel(recipe.firingCone, recipe.firingAtmosphere) : null;
  // 0% is allowed: a series usually starts with none of it.
  const additions = readDraftRows(rows, { allowZero: true });
  const additionsChanged = touched && isVariation && mixEditable && !additions.problem && !sameRows(additions.rows, mixture.additions);
  // A name that only says what is added follows the new amounts.
  const followsAdditions = !!recipe.baseCode && name.trim() === autoName(recipe.baseCode, mixture.additions);
  const shownName = additionsChanged && followsAdditions ? autoName(recipe.baseCode!, additions.rows) : name;

  function refresh() {
    for (const key of ['recipes', 'base-glazes', 'code-recipes', 'overview', 'tasks']) queryClient.invalidateQueries({ queryKey: [key] });
  }

  const save = useMutation({
    mutationFn: async () => {
      if (touched && isVariation && mixEditable && additions.problem) throw new Error(additions.problem);
      const details = { name: shownName.trim() || null, description: description.trim() || null, isActive };
      if (details.name !== recipe.name || details.description !== recipe.description || isActive !== recipe.isActive || firingChanged || additionsChanged) {
        // "" clears the firing; left out, it stays. Refused once a tile of it has been checked and approved.
        await recipesApi.update(recipe.id, {
          ...details,
          ...(firingChanged ? { cone: coneValue(cone), atmosphere } : {}),
          ...(additionsChanged ? { additions: additions.rows } : {}),
        });
      }
      // The outcome belongs to a coded test, so it's saved through the code.
      const note = outcomeNote.trim() || null;
      if (recipe.code && note !== recipe.outcomeNote) await recipesApi.updateByCode(recipe.code, { outcomeNote: note });
    },
    onSuccess: () => {
      refresh();
      const started = (recipe.tasks ?? []).filter((t) => t.stage !== 'Assigned').length;
      toast(
        additionsChanged && started
          ? `${recipe.code ?? 'Recipe'} saved. Whoever has started it sees that the recipe changed.`
          : `${recipe.code ?? 'Recipe'} saved`,
      );
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () => recipesApi.remove(recipe.id),
    onSuccess: () => {
      refresh();
      toast(`${recipe.code ?? 'Recipe'} deleted. Restore it from Tile recipes → Deleted.`);
      onClose();
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!save.isPending) save.mutate();
  }

  const givenTo = (recipe.tasks ?? []).map((t) => `@${t.assignedUsername}`);

  return (
    <Modal
      title={recipe.code ?? recipeTitle(recipe)}
      description={recipe.baseCode ? `A variation of base ${recipe.baseCode}.` : undefined}
      onClose={onClose}
      size={isVariation && mixEditable ? 'lg' : undefined}
      footer={
        confirmDelete ? (
          <>
            <span className="modal-foot-start muted">
              Delete {recipe.code ?? 'this recipe'}
              {givenTo.length ? ` and take it back from ${[...new Set(givenTo)].join(', ')}` : ''}?
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
            {one.data && mixEditable && (
              <button className="btn btn-danger modal-foot-start" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )}
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" form="edit-recipe" type="submit" disabled={save.isPending}>
              {save.isPending && <span className="spinner" />}
              Save
            </button>
          </>
        )
      }
    >
      <form id="edit-recipe" className="form" onSubmit={handleSubmit}>
        {(save.isError || remove.isError) && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{errorMessage(save.error ?? remove.error)}</span>
          </div>
        )}
        <section className="mixture" aria-label="What it’s made of">
          <h3 className="section-label">What it’s made of</h3>
          {mixture.base.length > 0 ? (
            <>
              <div className="note-label">
                Base {recipe.baseCode}
                {recipe.baseName ? ` · ${recipe.baseName}` : ''}
              </div>
              <Formulation rows={mixture.base} />
              <div className="note-label">Added</div>
              {mixEditable ? (
                <>
                  <MaterialRows
                    rows={rows}
                    onChange={(next) => {
                      setRows(next);
                      setTouched(true);
                    }}
                    addLabel="Add colorant"
                  />
                  <span className="hint">
                    {givenTo.length
                      ? 'You can change this until you check and approve a tile of it. Whoever has started it sees that the recipe changed.'
                      : 'You can change this until you check and approve a tile of it.'}{' '}
                    The base’s own materials are changed on Base glazes.
                  </span>
                </>
              ) : mixture.additions.length > 0 ? (
                <Formulation rows={mixture.additions} totalLabel="Added on top of the base" />
              ) : (
                <p className="muted">Nothing added: the base as it is.</p>
              )}
            </>
          ) : recipe.baseCode ? (
            // A variation stored without its base's formulation: the additions are all it records.
            <p>
              {recipe.baseCode} + {mixture.additions.length > 0 ? describeRows(mixture.additions) : 'nothing added'}
            </p>
          ) : mixture.materials.length > 0 ? (
            <Formulation rows={mixture.materials} />
          ) : (
            <p className="muted">{mixture.umfOnly ? 'Imported with its chemistry (UMF) only; its materials weren’t recorded.' : 'No materials recorded.'}</p>
          )}
          {one.data && !mixEditable && (
            <>
              {locks.length > 0 && (
                <ul className="hint locked-because">
                  {locks.slice(0, 3).map((why) => (
                    <li key={why}>{why}</li>
                  ))}
                </ul>
              )}
              <p className="hint">
                {recipe.code
                  ? `Locked: a tile of ${recipe.code} has been checked and approved, so it always means this glaze. To try a change, use Tweak on Base glazes: it makes a new recipe with its own number.`
                  : 'Saved with the recipe and can’t be changed here. To try different materials, add a new recipe.'}
              </p>
            </>
          )}
        </section>
        <h3 className="section-label">Details</h3>
        <div className="field">
          <label className="label" htmlFor="edit-name">
            Name {recipe.code && <span className="muted">(optional)</span>}
          </label>
          <input id="edit-name" className="input" value={shownName} onChange={(e) => setName(e.target.value)} />
          {additionsChanged && followsAdditions && <span className="hint">The name follows the new amounts.</span>}
        </div>
        <div className="field">
          <label className="label" htmlFor="edit-desc">
            Notes <span className="muted">(optional)</span>
          </label>
          <textarea id="edit-desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <span className="label">Firing</span>
          <FiringFields
            idPrefix="edit-recipe"
            cone={cone}
            atmosphere={atmosphere}
            onCone={setCone}
            onAtmosphere={setAtmosphere}
            disabled={!!one.data && !mixEditable}
            emptyLabel={recipe.baseCode ? `As the base${baseFiring ? `: ${baseFiring}` : ''}` : 'Not set'}
          />
          <span className="hint">Locked, like the materials, once a tile of it is checked and approved.</span>
        </div>
        {recipe.code && (
          <div className="field">
            <label className="label" htmlFor="edit-outcome">
              Outcome <span className="muted">(optional)</span>
            </label>
            <textarea
              id="edit-outcome"
              className="textarea"
              placeholder="How the test came out, e.g. crawled at the rim, too runny at cone 6"
              value={outcomeNote}
              onChange={(e) => setOutcomeNote(e.target.value)}
            />
            <span className="hint">A failed test keeps its number for good, so note what happened here.</span>
          </div>
        )}
        <label className="switch">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span>
            <span className="cell-strong">Active</span>
            <span className="muted">Inactive recipes can’t be added to capture codes and don’t show in the Capture app.</span>
          </span>
        </label>
      </form>
    </Modal>
  );
}
