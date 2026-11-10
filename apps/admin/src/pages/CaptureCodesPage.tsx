import { useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { captureCodesApi, errorMessage, recipesApi, usersApi } from '@glazion/api-client';
import { AccountStatus, type CaptureCodeDto, type RecipeDto } from '@glazion/types';
import { Icon, Modal, formatDate, formatRelativeTime, recipeTitle, toast, type Tone, toneClass } from '@glazion/ui';
import { Empty, LoadError, LoadMore, Loading } from '../components/ListState';
import { useDebounced } from '../hooks/useDebounced';
import { PAGE_SIZE, usePagedList } from '../hooks/usePagedList';

function codeState(code: CaptureCodeDto): { label: string; tone: Tone } {
  if (code.revokedAt || !code.isActive) return { label: 'Revoked', tone: 'neutral' };
  if (code.expiresAt && new Date(code.expiresAt).getTime() < Date.now()) return { label: 'Expired', tone: 'warn' };
  return { label: 'Active', tone: 'ok' };
}

/** Coded recipes in code order, then the rest by name. */
function byCodeThenName(a: RecipeDto, b: RecipeDto): number {
  if (a.code && b.code) return a.code.localeCompare(b.code, undefined, { numeric: true });
  if (a.code || b.code) return a.code ? -1 : 1;
  return recipeTitle(a).localeCompare(recipeTitle(b));
}

function RecipeLabel({ recipe, note }: { recipe: RecipeDto; note?: string }) {
  return (
    <span className="recipe-label">
      <span className="recipe-label-head">
        {recipe.code && <span className="tile-code">{recipe.code}</span>}
        <span className="cell-strong">{recipeTitle(recipe)}</span>
      </span>
      {(note ?? recipe.description) && <span className="muted cell-clamp">{note ?? recipe.description}</span>}
    </span>
  );
}

function CreateCodeModal({ onClose, onAssign }: { onClose: () => void; onAssign: (code: CaptureCodeDto) => void }) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState('');
  const [labelPrefix, setLabelPrefix] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [copied, setCopied] = useState(false);

  const users = useQuery({ queryKey: ['users', 'options'], queryFn: () => usersApi.list({ pageSize: 100 }) });
  const assignable = (users.data?.items ?? []).filter((u) => u.accountStatus === AccountStatus.Active);

  const create = useMutation({
    mutationFn: captureCodesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capture-codes'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
  });
  const created = create.data;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId || create.isPending) return;
    create.mutate({
      assignedUserId: userId,
      labelPrefix: labelPrefix.trim() || null,
      // End of the chosen day, so "expires 12 Oct" still works on the 12th.
      expiresAt: expiresOn ? new Date(`${expiresOn}T23:59:59`).toISOString() : null,
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the code is still on screen to copy by hand.
    }
  }

  if (created) {
    return (
      <Modal
        title="Capture code created"
        description={`Assigned to @${created.assignedUsername ?? 'user'}.`}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-secondary" onClick={onClose}>
              Done
            </button>
            <button className="btn btn-primary" onClick={() => onAssign(created)}>
              Add recipes
            </button>
          </>
        }
      >
        {created.plainCode ? (
          <>
            <div className="code-reveal">
              <span className="mono">{created.plainCode}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => copy(created.plainCode!)}>
                <Icon name={copied ? 'check' : 'copy'} size={16} />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="hint">This is the only time the full code is shown. Afterwards only the last characters are visible.</p>
          </>
        ) : (
          <p className="hint">The code ends in {created.maskedSuffix ?? '––––'}.</p>
        )}
        <p className="modal-note">The code has no recipes yet, so the user won’t see anything to photograph until you add some.</p>
      </Modal>
    );
  }

  return (
    <Modal
      title="New capture code"
      description="A code ties one user to the recipes they should photograph."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="create-code" type="submit" disabled={!userId || create.isPending}>
            {create.isPending && <span className="spinner" />}
            Create code
          </button>
        </>
      }
    >
      <form id="create-code" className="form" onSubmit={handleSubmit}>
        {create.isError && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{errorMessage(create.error)}</span>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="code-user">
            Assign to
          </label>
          <select id="code-user" className="select" value={userId} onChange={(e) => setUserId(e.target.value)} required>
            <option value="">{users.isPending ? 'Loading users…' : 'Choose a user'}</option>
            {assignable.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName ? `${u.displayName} (@${u.username})` : `@${u.username}`}
              </option>
            ))}
          </select>
          {users.isSuccess && assignable.length === 0 && <span className="hint">There are no active users. Create one first.</span>}
        </div>
        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="code-label">
              Label prefix <span className="muted">(optional)</span>
            </label>
            <input id="code-label" className="input" placeholder="e.g. LAB-A" value={labelPrefix} onChange={(e) => setLabelPrefix(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="code-expiry">
              Expires <span className="muted">(optional)</span>
            </label>
            <input
              id="code-expiry"
              className="input"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}

function AssignRecipesModal({ code, onClose }: { code: CaptureCodeDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim());

  const current = useQuery({ queryKey: ['code-recipes', code.id], queryFn: () => captureCodesApi.listRecipes(code.id) });
  const recipes = useQuery({
    queryKey: ['recipes', 'options', term],
    queryFn: () => recipesApi.list({ activeOnly: true, search: term || undefined, pageSize: 100 }),
    placeholderData: keepPreviousData,
  });
  const onCode = new Set((current.data ?? []).map((r) => r.id));
  const options = (recipes.data?.items ?? []).filter((r) => r.isActive).sort(byCodeThenName);

  const assign = useMutation({
    // The call adds to the code's recipes, so only the new ones go. Re-sending the old ones would
    // also fail the whole call if any of them has since been switched off.
    mutationFn: () => captureCodesApi.assignRecipes(code.id, { recipeIds: selected }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capture-codes'] });
      queryClient.invalidateQueries({ queryKey: ['code-recipes', code.id] });
      toast(`${selected.length} ${selected.length === 1 ? 'recipe' : 'recipes'} added for @${code.assignedUsername ?? 'user'}`);
      onClose();
    },
  });

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <Modal
      title="Add recipes"
      description={`Code ending ${code.maskedSuffix ?? '––––'}, assigned to @${code.assignedUsername ?? 'user'}.`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => assign.mutate()} disabled={selected.length === 0 || assign.isPending}>
            {assign.isPending && <span className="spinner" />}
            {selected.length > 0 ? `Add ${selected.length}` : 'Add'}
          </button>
        </>
      }
    >
      {assign.isError && (
        <div className="alert" role="alert">
          <Icon name="alert" size={18} />
          <span>{errorMessage(assign.error)}</span>
        </div>
      )}

      <div className="search">
        <Icon name="search" size={16} />
        <input className="input" placeholder="Search by code or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search recipes" autoFocus />
      </div>

      {recipes.isPending || current.isPending ? (
        <Loading />
      ) : recipes.isError || current.isError ? (
        <LoadError
          error={recipes.error ?? current.error}
          onRetry={() => {
            recipes.refetch();
            current.refetch();
          }}
        />
      ) : options.length === 0 ? (
        term ? (
          <Empty icon="search" title="No matches" text={`No active recipe matches “${term}”.`} />
        ) : (
          <Empty icon="flask" title="No active recipes" text="Create a recipe or a base-glaze variation first, then come back to add it." />
        )
      ) : (
        <ul className="checklist">
          {options.map((recipe) => {
            const already = onCode.has(recipe.id);
            return (
              <li key={recipe.id}>
                <label className={`check${already ? ' is-done' : ''}`}>
                  <input type="checkbox" checked={already || selected.includes(recipe.id)} disabled={already} onChange={() => toggle(recipe.id)} />
                  <RecipeLabel recipe={recipe} note={already ? 'Already on this code' : undefined} />
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

function CodeRecipesModal({ code, onClose, onAdd }: { code: CaptureCodeDto; onClose: () => void; onAdd: () => void }) {
  const queryClient = useQueryClient();
  const usable = codeState(code).label === 'Active';
  const recipes = useQuery({ queryKey: ['code-recipes', code.id], queryFn: () => captureCodesApi.listRecipes(code.id) });
  const list = [...(recipes.data ?? [])].sort(byCodeThenName);

  const remove = useMutation({
    mutationFn: (recipe: RecipeDto) => captureCodesApi.removeRecipe(code.id, recipe.id),
    onSuccess: (_result, recipe) => {
      queryClient.invalidateQueries({ queryKey: ['capture-codes'] });
      queryClient.invalidateQueries({ queryKey: ['code-recipes', code.id] });
      toast(`${recipe.code ?? recipeTitle(recipe)} removed from the code`);
    },
  });

  return (
    <Modal
      title="Recipes on this code"
      description={`Code ending ${code.maskedSuffix ?? '––––'}, assigned to @${code.assignedUsername ?? 'user'}.`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          {usable && (
            <button className="btn btn-primary" onClick={onAdd}>
              <Icon name="plus" size={18} />
              Add recipes
            </button>
          )}
        </>
      }
    >
      {remove.isError && (
        <div className="alert" role="alert">
          <Icon name="alert" size={18} />
          <span>{errorMessage(remove.error)}</span>
        </div>
      )}

      {recipes.isPending ? (
        <Loading />
      ) : recipes.isError ? (
        <LoadError error={recipes.error} onRetry={() => recipes.refetch()} />
      ) : list.length === 0 ? (
        <Empty icon="flask" title="No recipes yet" text={`@${code.assignedUsername ?? 'This user'} won’t see anything to photograph until you add some.`} />
      ) : (
        <>
          <ul className="item-list">
            {list.map((recipe) => {
              const busy = remove.isPending && remove.variables?.id === recipe.id;
              return (
                <li key={recipe.id}>
                  <RecipeLabel recipe={recipe} />
                  {!recipe.isActive && <span className="badge">Inactive</span>}
                  {usable && (
                    <button className="btn btn-sm btn-secondary" onClick={() => remove.mutate(recipe)} disabled={remove.isPending}>
                      {busy ? <span className="spinner" /> : 'Remove'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {usable && <p className="hint">A removed recipe disappears from their Capture app. Photos already sent keep their recipe.</p>}
        </>
      )}
    </Modal>
  );
}

function RevokeModal({ code, onClose }: { code: CaptureCodeDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: () => captureCodesApi.revoke(code.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capture-codes'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      toast('Code revoked');
      onClose();
    },
  });

  return (
    <Modal
      title="Revoke this code?"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Keep code
          </button>
          <button className="btn btn-danger" onClick={() => revoke.mutate()} disabled={revoke.isPending}>
            {revoke.isPending && <span className="spinner" />}
            Revoke code
          </button>
        </>
      }
    >
      {revoke.isError && (
        <div className="alert" role="alert">
          <Icon name="alert" size={18} />
          <span>{errorMessage(revoke.error)}</span>
        </div>
      )}
      <p className="modal-note">
        @{code.assignedUsername ?? 'This user'} won’t be able to upload with the code ending {code.maskedSuffix ?? '––––'} any more. Photos they
        already sent are kept. This can’t be undone; you’d need to create a new code.
      </p>
    </Modal>
  );
}

export default function CaptureCodesPage() {
  const [activeOnly, setActiveOnly] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [assignTo, setAssignTo] = useState<CaptureCodeDto | null>(null);
  const [viewing, setViewing] = useState<CaptureCodeDto | null>(null);
  const [revoking, setRevoking] = useState<CaptureCodeDto | null>(null);

  const codes = usePagedList<CaptureCodeDto>(['capture-codes', { activeOnly }], (cursor) =>
    captureCodesApi.list({ activeOnly: activeOnly || undefined, cursor, pageSize: PAGE_SIZE }),
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Capture codes</h1>
          <p className="page-sub">Each code lets one user upload tile photos for the recipes you add to it.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Icon name="plus" size={18} />
          New code
        </button>
      </header>

      <div className="content">
        <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="Filter codes">
            <button role="tab" aria-selected={activeOnly} className={activeOnly ? 'is-active' : ''} onClick={() => setActiveOnly(true)}>
              Active
            </button>
            <button role="tab" aria-selected={!activeOnly} className={!activeOnly ? 'is-active' : ''} onClick={() => setActiveOnly(false)}>
              All
            </button>
          </div>
        </div>

        <div className="card">
          {codes.isPending ? (
            <Loading />
          ) : codes.isError ? (
            <LoadError error={codes.error} onRetry={() => codes.refetch()} />
          ) : codes.items.length === 0 ? (
            <Empty
              icon="key"
              title={activeOnly ? 'No active codes' : 'No codes yet'}
              text="Create a code for a user, then add the recipes they should photograph."
              action={
                <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                  New code
                </button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Assigned to</th>
                    <th>Label</th>
                    <th>Recipes</th>
                    <th>Status</th>
                    <th>Expires</th>
                    <th>Created</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {codes.items.map((code) => {
                    const state = codeState(code);
                    const usable = state.label === 'Active';
                    return (
                      <tr key={code.id}>
                        <td className="mono cell-strong">•••• {code.maskedSuffix ?? '––––'}</td>
                        <td>{code.assignedUsername ? `@${code.assignedUsername}` : '—'}</td>
                        <td className={code.labelPrefix ? '' : 'muted'}>{code.labelPrefix ?? '—'}</td>
                        <td className={code.recipeCount ? '' : 'muted'}>{code.recipeCount ?? '—'}</td>
                        <td>
                          <span className={toneClass(state.tone)}>{state.label}</span>
                        </td>
                        <td className="muted">{code.expiresAt ? formatDate(code.expiresAt) : 'Never'}</td>
                        <td className="muted">{formatRelativeTime(code.createdAt)}</td>
                        <td className="cell-actions">
                          <button className="btn btn-sm btn-secondary" onClick={() => setViewing(code)}>
                            Recipes
                          </button>
                          {usable && (
                            <button className="btn btn-sm btn-danger" onClick={() => setRevoking(code)}>
                              Revoke
                            </button>
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
            shown={codes.items.length}
            total={codes.total}
            hasMore={!!codes.hasNextPage}
            loading={codes.isFetchingNextPage}
            onLoadMore={() => codes.fetchNextPage()}
          />
        </div>
      </div>

      {showCreate && (
        <CreateCodeModal
          onClose={() => setShowCreate(false)}
          onAssign={(code) => {
            setShowCreate(false);
            setAssignTo(code);
          }}
        />
      )}
      {viewing && (
        <CodeRecipesModal
          code={viewing}
          onClose={() => setViewing(null)}
          onAdd={() => {
            setViewing(null);
            setAssignTo(viewing);
          }}
        />
      )}
      {assignTo && <AssignRecipesModal code={assignTo} onClose={() => setAssignTo(null)} />}
      {revoking && <RevokeModal code={revoking} onClose={() => setRevoking(null)} />}
    </>
  );
}
