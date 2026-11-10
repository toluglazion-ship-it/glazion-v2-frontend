import { useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, recipesApi, tasksApi } from '@glazion/api-client';
import { CLAY_BODIES, type AssignTileTasksResponse, type ClayBody, type RecipeDto } from '@glazion/types';
import { Icon, Modal, clayBodyLabel, recipeTitle, toast } from '@glazion/ui';
import { Empty, LoadError, Loading } from './ListState';
import { useDebounced } from '../hooks/useDebounced';
import { todayIso, useAssignees, userLabel } from '../lib/tasks';

/** Coded recipes in code order, then the rest by name. */
function byCodeThenName(a: RecipeDto, b: RecipeDto): number {
  if (a.code && b.code) return a.code.localeCompare(b.code, undefined, { numeric: true });
  if (a.code || b.code) return a.code ? -1 : 1;
  return recipeTitle(a).localeCompare(recipeTitle(b));
}

function RecipeLine({ recipe }: { recipe: Pick<RecipeDto, 'code' | 'name'> }) {
  return (
    <span className="recipe-label-head">
      {recipe.code && <span className="tile-code">{recipe.code}</span>}
      <span className="cell-strong">{recipeTitle(recipe)}</span>
    </span>
  );
}

function Result({ result, onClose }: { result: AssignTileTasksResponse; onClose: () => void }) {
  const who = result.created[0]?.assignedUsername;
  return (
    <Modal
      title={result.created.length > 0 ? `${result.created.length} ${result.created.length === 1 ? 'tile' : 'tiles'} assigned` : 'Nothing new to assign'}
      description={who ? `@${who} sees them in the Capture app now.` : undefined}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      {!result.participantCanUpload && (
        <div className="alert alert-warn" role="status">
          <Icon name="alert" size={18} />
          <span>They have no active capture code, so they can’t send photos yet. Create one for them under Capture codes.</span>
        </div>
      )}
      {result.skipped.length > 0 && (
        <>
          <p className="modal-note">These tiles were left as they are, because someone already has them:</p>
          <ul className="item-list">
            {result.skipped.map((s) => (
              <li key={`${s.recipeId}-${s.clayBody}`}>
                <span className="recipe-label">
                  <RecipeLine recipe={{ code: s.recipeCode, name: s.recipeName }} />
                  <span className="muted">
                    {clayBodyLabel(s.clayBody)} · with @{s.assignedUsername}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="hint">To move one of them, reassign it from Tasks.</p>
        </>
      )}
    </Modal>
  );
}

/**
 * Gives a participant recipes to make, one task per recipe and clay body, with a due date. With `recipes` it assigns
 * those (straight after creating them, say); without, it lets you pick from all active recipes.
 */
export default function AssignTasksModal({ recipes: fixed, onClose }: { recipes?: RecipeDto[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>(() => fixed?.map((r) => r.id) ?? []);
  const [bodies, setBodies] = useState<ClayBody[]>(CLAY_BODIES.map((c) => c.value));
  const [userId, setUserId] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim());

  const { assignees, ...users } = useAssignees();
  const recipes = useQuery({
    queryKey: ['recipes', 'options', term],
    queryFn: () => recipesApi.list({ activeOnly: true, search: term || undefined, pageSize: 100 }),
    placeholderData: keepPreviousData,
    enabled: !fixed,
  });
  const options = (recipes.data?.items ?? []).filter((r) => r.isActive).sort(byCodeThenName);

  const assign = useMutation({
    mutationFn: () => tasksApi.assign({ recipeIds: selected, clayBodies: bodies, assignedUserId: userId, dueOn: dueOn || null, note: note.trim() || null }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      // Straight to the toast when everything went as asked; the summary only when something needs reading.
      if (result.skipped.length === 0 && result.participantCanUpload) {
        toast(`${result.created.length} ${result.created.length === 1 ? 'tile' : 'tiles'} assigned to @${result.created[0]?.assignedUsername ?? 'them'}`);
        onClose();
      }
    },
  });

  const count = selected.length * bodies.length;
  const problem = selected.length === 0 ? 'Choose at least one recipe.' : bodies.length === 0 ? 'Choose at least one clay body.' : !userId ? 'Choose who makes them.' : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (problem || assign.isPending) return;
    assign.mutate();
  }

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  if (assign.data && (assign.data.skipped.length > 0 || !assign.data.participantCanUpload)) return <Result result={assign.data} onClose={onClose} />;

  return (
    <Modal
      title={fixed ? 'Assign to a participant' : 'Assign tiles'}
      description="Each recipe becomes one task per clay body. The participant marks a tile done, then photographs it."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            {fixed ? 'Not now' : 'Cancel'}
          </button>
          <button className="btn btn-primary" form="assign-tasks" type="submit" disabled={!!problem || assign.isPending}>
            {assign.isPending && <span className="spinner" />}
            {count > 0 ? `Assign ${count} ${count === 1 ? 'tile' : 'tiles'}` : 'Assign'}
          </button>
        </>
      }
    >
      <form id="assign-tasks" className="form" onSubmit={submit}>
        {assign.isError && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{errorMessage(assign.error)}</span>
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="task-user">
              Participant
            </label>
            <select id="task-user" className="select" value={userId} onChange={(e) => setUserId(e.target.value)} required>
              <option value="">{users.isPending ? 'Loading people…' : 'Choose a participant'}</option>
              {assignees.map((u) => (
                <option key={u.id} value={u.id}>
                  {userLabel(u)}
                </option>
              ))}
            </select>
            {users.isSuccess && assignees.length === 0 && <span className="hint">There are no active participants. Create or activate one under Users.</span>}
          </div>
          <div className="field">
            <label className="label" htmlFor="task-due">
              Due <span className="muted">(optional)</span>
            </label>
            <input id="task-due" className="input" type="date" min={todayIso()} value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </div>
        </div>

        <div className="field" role="group" aria-labelledby="task-bodies">
          <span className="label" id="task-bodies">
            Clay bodies
          </span>
          <div className="toolbar">
            {CLAY_BODIES.map((c) => (
              <label key={c.value} className="toolbar-check">
                <input type="checkbox" checked={bodies.includes(c.value)} onChange={() => setBodies((b) => toggle(b, c.value))} />
                {c.label}
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="task-note">
            Instructions <span className="muted">(optional)</span>
          </label>
          <textarea id="task-note" className="textarea" maxLength={500} placeholder="Application, number of coats, anything they should know" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="field">
          <span className="label">Recipes</span>
          {fixed ? (
            <ul className="item-list">
              {fixed.map((r) => (
                <li key={r.id}>
                  <RecipeLine recipe={r} />
                </li>
              ))}
            </ul>
          ) : (
            <>
              <div className="search">
                <Icon name="search" size={16} />
                <input className="input" placeholder="Search by code or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search recipes" />
              </div>
              {recipes.isPending ? (
                <Loading />
              ) : recipes.isError ? (
                <LoadError error={recipes.error} onRetry={() => recipes.refetch()} />
              ) : options.length === 0 ? (
                <Empty icon="flask" title={term ? 'No matches' : 'No active recipes'} text={term ? `No active recipe matches “${term}”.` : 'Create a recipe or a variation first.'} />
              ) : (
                <ul className="checklist">
                  {options.map((r) => (
                    <li key={r.id}>
                      <label className="check">
                        <input type="checkbox" checked={selected.includes(r.id)} onChange={() => setSelected((s) => toggle(s, r.id))} />
                        <span className="recipe-label">
                          <RecipeLine recipe={r} />
                          {r.description && <span className="muted cell-clamp">{r.description}</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {selected.length > 0 && <span className="hint">{selected.length} chosen.</span>}
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
