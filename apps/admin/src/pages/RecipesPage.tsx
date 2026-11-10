import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage, recipesApi } from '@glazion/api-client';
import { CLAY_BODIES, type MaterialRow, type RecipeDto, type TileTaskDto, type TileTaskStage } from '@glazion/types';
import { Icon, Modal, clayBodyLabel, formatRelativeTime, recipeTitle, toast, toneClass } from '@glazion/ui';
import AssignTasksModal from '../components/AssignTasksModal';
import EditRecipeModal from '../components/EditRecipeModal';
import { Empty, LoadError, LoadMore, Loading } from '../components/ListState';
import MaterialRows from '../components/MaterialRows';
import { AddVariationModal, AddVariationsModal, PromoteModal, useAllBases } from '../components/VariationModals';
import { useDebounced } from '../hooks/useDebounced';
import { PAGE_SIZE, usePagedList } from '../hooks/usePagedList';
import { draftRow, readDraftRows, type DraftRow } from '../lib/materials';
import { STAGE_LABEL, isOpen, stageBadge, useAssignees, userLabel } from '../lib/tasks';
import { ReassignModal } from '../components/TaskModals';

/** The recipe data a recipe without a code is stored with: its materials and amounts. */
function recipeJsonFor(rows: MaterialRow[]): string | null {
  return rows.length ? JSON.stringify({ materials: rows.map((row) => ({ name: row.rawName, amount: row.amount })) }) : null;
}

function CreateRecipeModal({ onClose, onCreated }: { onClose: () => void; onCreated: (recipe: RecipeDto) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<DraftRow[]>(() => [draftRow(), draftRow(), draftRow()]);
  const [tried, setTried] = useState(false);

  const create = useMutation({
    mutationFn: recipesApi.create,
    onSuccess: (recipe) => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      toast('Recipe created');
      // Straight on to who should make it; "Not now" closes.
      onCreated(recipe);
    },
  });

  const materials = readDraftRows(rows, { allowZero: false });
  const problem = !name.trim() ? 'Give the recipe a name.' : materials.problem;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (problem || create.isPending) return;
    create.mutate({
      name: name.trim(),
      description: description.trim() || null,
      recipeJson: recipeJsonFor(materials.rows),
    });
  }

  return (
    <Modal
      title="New recipe"
      description="A recipe without a tile code. To give it a code, add it as a variation in Base glazes instead."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="create-recipe" type="submit" disabled={create.isPending || (tried && !!problem)}>
            {create.isPending && <span className="spinner" />}
            Create recipe
          </button>
        </>
      }
    >
      <form id="create-recipe" className="form" onSubmit={handleSubmit}>
        {(create.isError || (tried && problem)) && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{create.isError ? errorMessage(create.error) : problem}</span>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="recipe-name">
            Name
          </label>
          <input id="recipe-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </div>
        <div className="field">
          <label className="label" htmlFor="recipe-desc">
            Notes <span className="muted">(optional)</span>
          </label>
          <textarea
            id="recipe-desc"
            className="textarea"
            placeholder="Cone, atmosphere, application, anything the photographer should know"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="field">
          <span className="label">
            Materials <span className="muted">(optional)</span>
          </span>
          <MaterialRows rows={rows} onChange={setRows} addLabel="Add material" showTotal />
          <span className="hint">Search by name or by what potters call it, such as EPK or Whiting.</span>
        </div>
      </form>
    </Modal>
  );
}

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; recipe: RecipeDto }
  | { kind: 'variation'; from?: RecipeDto }
  | { kind: 'series' }
  | { kind: 'promote'; recipe: RecipeDto }
  | { kind: 'assign'; recipes: RecipeDto[] }
  | { kind: 'reassign'; tasks: TileTaskDto[] }
  | null;

/** Status filter: who has a recipe and how far its tiles have got. */
type TaskFilter = '' | 'unassigned' | 'overdue' | Exclude<TileTaskStage, 'Cancelled'>;

const TASK_FILTERS: { value: TaskFilter; label: string }[] = [
  { value: '', label: 'Any progress' },
  { value: 'unassigned', label: 'Not given to anyone' },
  { value: 'Assigned', label: STAGE_LABEL.Assigned },
  { value: 'Started', label: STAGE_LABEL.Started },
  { value: 'Done', label: STAGE_LABEL.Done },
  { value: 'AwaitingPhoto', label: STAGE_LABEL.AwaitingPhoto },
  { value: 'InReview', label: STAGE_LABEL.InReview },
  { value: 'Approved', label: STAGE_LABEL.Approved },
  { value: 'overdue', label: 'Overdue' },
];

/** Who has the recipe: everyone with a live task for it, usually one person. */
function Assignees({ tasks }: { tasks: TileTaskDto[] }) {
  const people = [...new Map(tasks.map((t) => [t.assignedUserId, t])).values()];
  if (people.length === 0) return <span className="muted">Not given to anyone</span>;
  return (
    <span className="recipe-label">
      {people.map((t) => (
        <span key={t.assignedUserId}>
          {t.participantCode && <span className="muted">{t.participantCode} · </span>}
          {t.assignedDisplayName ?? `@${t.assignedUsername}`}
        </span>
      ))}
    </span>
  );
}

/** One line per clay body: how far that tile has got, so a missing photo or a done tile shows at a glance. */
function TileProgress({ tasks }: { tasks: TileTaskDto[] }) {
  if (tasks.length === 0) return <span className="muted">—</span>;
  const order = (t: TileTaskDto) => CLAY_BODIES.findIndex((c) => c.value === t.clayBody);
  return (
    <span className="tile-progress">
      {[...tasks]
        .sort((a, b) => order(a) - order(b))
        .map((t) => {
          const badge = stageBadge(t);
          return (
            <span key={t.id} className="tile-progress-row" title={t.retakeReason ?? undefined}>
              <span className="muted">{clayBodyLabel(t.clayBody)}</span>
              <span className={toneClass(badge.tone)}>{badge.label}</span>
              {t.overdue && <span className="badge badge-bad">Overdue</span>}
            </span>
          );
        })}
    </span>
  );
}

export default function RecipesPage() {
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<Dialog>(null);
  // Which variations already became a base, so they link to it instead of offering it again.
  const bases = useAllBases();
  const becameBase = (recipe: RecipeDto) => (bases.data ?? []).find((b) => b.promotedFromRecipeCode === recipe.code);
  // All, active only, or the deleted ones (to restore).
  const [show, setShow] = useState<'all' | 'active' | 'deleted'>('all');
  const activeOnly = show === 'active';
  const deleted = show === 'deleted';
  const queryClient = useQueryClient();
  const restore = useMutation({
    mutationFn: (recipe: RecipeDto) => recipesApi.restore(recipe.id),
    onSuccess: (recipe) => {
      for (const key of ['recipes', 'base-glazes', 'tasks', 'overview']) queryClient.invalidateQueries({ queryKey: [key] });
      toast(`${recipe.code ?? 'Recipe'} restored, with its tiles`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const [search, setSearch] = useState('');
  const [baseCode, setBaseCode] = useState('');
  const [userId, setUserId] = useState('');
  const [progress, setProgress] = useState<TaskFilter>('');
  const term = useDebounced(search.trim());
  const { assignees } = useAssignees();
  const filtered = !!(term || baseCode || userId || progress);

  const recipes = usePagedList<RecipeDto>(['recipes', { term, show, baseCode, userId, progress }], (cursor) =>
    recipesApi.list({
      search: term || undefined,
      activeOnly: activeOnly || undefined,
      deleted: deleted || undefined,
      baseCode: baseCode || undefined,
      assignedUserId: userId || undefined,
      assigned: progress === 'unassigned' ? false : undefined,
      taskStage: progress && progress !== 'unassigned' && progress !== 'overdue' ? progress : undefined,
      overdue: progress === 'overdue' || undefined,
      cursor,
      pageSize: PAGE_SIZE,
    }),
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Tile recipes</h1>
          <p className="page-sub">
            Every glaze that goes on a tile, one per tile code: a base glaze plus what was added to it. Who has each one and how far its tiles have got.
            Recipes imported from before the base-glaze register are here too.
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => setDialog({ kind: 'series' })}>
            Add a series
          </button>
          <button className="btn btn-secondary" onClick={() => setDialog({ kind: 'variation' })}>
            Add variation
          </button>
          <button className="btn btn-primary" onClick={() => setDialog({ kind: 'create' })}>
            <Icon name="plus" size={18} />
            New recipe
          </button>
        </div>
      </header>

      <div className="content">
        <div className="toolbar">
          <div className="search">
            <Icon name="search" size={16} />
            <input className="input" placeholder="Search by code, name or base glaze" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search recipes" />
          </div>
          <div className="segmented" role="tablist" aria-label="Filter recipes">
            {(['all', 'active', 'deleted'] as const).map((value) => (
              <button key={value} role="tab" aria-selected={show === value} className={show === value ? 'is-active' : ''} onClick={() => setShow(value)}>
                {value === 'all' ? 'All' : value === 'active' ? 'Active' : 'Deleted'}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar">
          <select className="select toolbar-select" value={baseCode} onChange={(e) => setBaseCode(e.target.value)} aria-label="Base glaze">
            <option value="">All base glazes</option>
            {(bases.data ?? []).map((b) => (
              <option key={b.id} value={b.code ?? ''}>
                {b.code}
                {b.name ? ` · ${b.name}` : ''}
              </option>
            ))}
          </select>
          <select className="select toolbar-select" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Given to">
            <option value="">Given to anyone</option>
            {assignees.map((u) => (
              <option key={u.id} value={u.id}>
                {userLabel(u)}
              </option>
            ))}
          </select>
          <select className="select toolbar-select" value={progress} onChange={(e) => setProgress(e.target.value as TaskFilter)} aria-label="Progress">
            {TASK_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card">
          {recipes.isPending ? (
            <Loading />
          ) : recipes.isError ? (
            <LoadError error={recipes.error} onRetry={() => recipes.refetch()} />
          ) : recipes.items.length === 0 ? (
            filtered ? (
              <Empty icon="search" title="No matches" text={term ? `No recipe matches “${term}” with these filters.` : 'No recipe matches these filters.'} />
            ) : deleted ? (
              <Empty icon="trash" title="Nothing deleted" text="Recipes you delete wait here, so you can bring them back with their tiles." />
            ) : (
              <Empty
                icon="flask"
                title={activeOnly ? 'No active recipes' : 'No recipes yet'}
                text="Register a base glaze and add its variations, or create a recipe without a code."
                action={
                  <Link className="btn btn-primary" to="/base-glazes">
                    Go to base glazes
                  </Link>
                }
              />
            )
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Recipe</th>
                    <th>Given to</th>
                    <th>Tiles</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {recipes.items.map((recipe) => {
                    const tasks = recipe.tasks ?? [];
                    const open = tasks.filter(isOpen);
                    return (
                      <tr key={recipe.id}>
                        <td>{recipe.code ? <span className="tile-code">{recipe.code}</span> : <span className="muted">—</span>}</td>
                        <td className="cell-wide">
                          <div className="cell-strong">{recipeTitle(recipe)}</div>
                          {recipe.baseName && <div className="muted">Base: {recipe.baseName}</div>}
                          {(recipe.outcomeNote ?? recipe.description) && <div className="muted cell-clamp">{recipe.outcomeNote ?? recipe.description}</div>}
                        </td>
                        <td>
                          <Assignees tasks={tasks} />
                        </td>
                        <td>
                          <TileProgress tasks={tasks} />
                        </td>
                        <td>
                          {recipe.deletedAt ? (
                            <>
                              <span className="badge badge-bad">Deleted</span>
                              <div className="muted">{formatRelativeTime(recipe.deletedAt)}</div>
                            </>
                          ) : (
                            <>
                              <span className={recipe.isActive ? 'badge badge-ok' : 'badge'}>{recipe.isActive ? 'Active' : 'Inactive'}</span>
                              <div className="muted">{formatRelativeTime(recipe.createdAt)}</div>
                            </>
                          )}
                        </td>
                        <td className="cell-actions">
                          {recipe.deletedAt ? (
                            <button className="btn btn-sm btn-secondary" onClick={() => restore.mutate(recipe)} disabled={restore.isPending}>
                              Restore
                            </button>
                          ) : (
                            <div className="recipe-actions">
                              {recipe.baseCode && recipe.code && (
                                <>
                                  {becameBase(recipe) ? (
                                    <button
                                      className="btn btn-sm btn-ghost"
                                      onClick={() => navigate(`/base-glazes?base=${encodeURIComponent(becameBase(recipe)!.code!)}`)}
                                      title="Open the base it became"
                                    >
                                      Became {becameBase(recipe)!.code}
                                    </button>
                                  ) : (
                                    <button className="btn btn-sm btn-ghost" onClick={() => setDialog({ kind: 'promote', recipe })}>
                                      Make base
                                    </button>
                                  )}
                                  <button
                                    className="btn btn-sm btn-ghost"
                                    onClick={() => setDialog({ kind: 'variation', from: recipe })}
                                    title="A new variation starting from this one"
                                  >
                                    Tweak
                                  </button>
                                </>
                              )}
                              {recipe.isActive && tasks.length < CLAY_BODIES.length && (
                                <button
                                  className="btn btn-sm btn-ghost"
                                  onClick={() => setDialog({ kind: 'assign', recipes: [recipe] })}
                                  title="Give it to a participant to make"
                                >
                                  Assign
                                </button>
                              )}
                              {open.length > 0 && (
                                <button
                                  className="btn btn-sm btn-ghost"
                                  onClick={() => setDialog({ kind: 'reassign', tasks: open })}
                                  title="Give its tiles to someone else"
                                >
                                  Reassign
                                </button>
                              )}
                              <button className="btn btn-sm btn-secondary" onClick={() => setDialog({ kind: 'edit', recipe })}>
                                Edit
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <LoadMore
            shown={recipes.items.length}
            total={recipes.total}
            hasMore={!!recipes.hasNextPage}
            loading={recipes.isFetchingNextPage}
            onLoadMore={() => recipes.fetchNextPage()}
          />
        </div>
      </div>

      {dialog?.kind === 'create' && (
        <CreateRecipeModal onClose={() => setDialog(null)} onCreated={(recipe) => setDialog({ kind: 'assign', recipes: [recipe] })} />
      )}
      {dialog?.kind === 'edit' && <EditRecipeModal recipe={dialog.recipe} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'variation' && (
        <AddVariationModal from={dialog.from} onClose={() => setDialog(null)} onCreated={(recipes) => setDialog({ kind: 'assign', recipes })} />
      )}
      {dialog?.kind === 'series' && <AddVariationsModal onClose={() => setDialog(null)} onCreated={(recipes) => setDialog({ kind: 'assign', recipes })} />}
      {dialog?.kind === 'assign' && <AssignTasksModal recipes={dialog.recipes} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'reassign' && <ReassignModal tasks={dialog.tasks} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'promote' && <PromoteModal recipe={dialog.recipe} onClose={() => setDialog(null)} onPromoted={() => setDialog(null)} />}
    </>
  );
}
