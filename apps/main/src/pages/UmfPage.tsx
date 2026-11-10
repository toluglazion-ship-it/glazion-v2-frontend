import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '@glazion/api-client';
import {
  limitStatus,
  recipeFileName,
  recipeToCsv,
  recipeToJson,
  retotal,
  sameRecipe,
  skippedReason,
  totalOf,
  type RecipeDraft,
  type SavedRecipe,
} from '@glazion/api-client/recipes';
import { CONE_DATA, limitConeFor, limitConeText, type GlazeLimit, type UmfCalculateResponse } from '@glazion/types';
import { Empty, Icon, Modal, formatRelativeTime, toast } from '@glazion/ui';
import MenuButton from '../components/MenuButton';
import RecipeRows, { fromDraftRow, fromRows, newRow, toRows, type Row } from '../components/recipe/RecipeRows';
import { lastFiring } from '../lib/drafts';
import { OxideName, formatUmf, warningText } from '../lib/glaze';
import { scrollBehavior } from '../lib/motion';
import { usePageTitle } from '../lib/usePageTitle';
import { STORAGE_BLOCKED, download, savedRecipes, useSavedRecipes } from '../lib/savedRecipes';
import { umfDraft } from '../lib/umfDraft';
import { useUmfCalculation } from '../lib/useUmf';

function materialCount(recipe: SavedRecipe): string {
  const count = [...recipe.base, ...recipe.colourants].filter((row) => row.material !== '').length;
  return `${count} ${count === 1 ? 'material' : 'materials'}`;
}

const fixed = (value: number | null | undefined, places: number) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(places) : 'n/a');

const CTE_BAND: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' };

function Total({ label, value, strict, action, onAction }: { label: string; value: number; strict?: boolean; action?: string; onAction?: () => void }) {
  const off = strict && value > 0 && (value < 99 || value > 101);
  return (
    <div className="total-bar">
      <span className="hint">{label}</span>
      <strong className={off ? 'is-off' : ''}>{value.toFixed(2)}%</strong>
      {/* Said in words too, not by the colour alone. */}
      {off && (
        <span className="total-off">
          {Math.abs(value - 100).toFixed(2)} {value > 100 ? 'over' : 'under'} 100
        </span>
      )}
      {action && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onAction} disabled={value <= 0}>
          {action}
        </button>
      )}
    </div>
  );
}

const isCone = (cone: string | undefined): cone is string => CONE_DATA.some((data) => data.cone === cone);

/** One oxide's UMF value next to its target range for the cone: in range, under or over. */
function LimitTag({ value, limit }: { value: number; limit: GlazeLimit | undefined }) {
  const status = limitStatus(value, limit);
  if (!status || !limit) return null;
  const range = `${limit.minUmf.toFixed(2)}–${limit.maxUmf.toFixed(2)}`;
  // The range is always shown, not only on hover: "in 0.20–0.60", "over 0.05–0.35".
  const text = `${status} ${range}`;
  return (
    <span className={`limit limit-${status}`} title={`Target for this cone: ${range}`}>
      {text}
    </span>
  );
}

/** The UMF table, in the groups and order the backend sends (R₂O, RO, R₂O₃, RO₂). */
function UmfTable({ calc }: { calc: UmfCalculateResponse }) {
  const groups = (calc.displayGroups ?? []).filter((g) => (g.oxides ?? []).length > 0);
  return (
    <div className="umf-cols">
      {groups.map((group) => (
        <div key={group.key ?? group.label} className="umf-col">
          <h4>{group.label}</h4>
          <div className="umf-group">
            {(group.oxides ?? []).map(({ oxide, value }) => (
              <div key={oxide} className="kv">
                <span>
                  <OxideName oxide={oxide ?? ''} />
                </span>
                <span>
                  <span className="num">{formatUmf(value)}</span>
                  <LimitTag value={value} limit={calc.limits?.find((l) => l.oxide === oxide)} />
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function UmfPage() {
  const navigate = useNavigate();
  const saved = useSavedRecipes();
  usePageTitle('UMF calculator');

  // Picks up where the last visit left off.
  const [restored] = useState(umfDraft.read);
  const [name, setName] = useState(restored?.name ?? '');
  const [cone, setCone] = useState(() => {
    // A new recipe starts at the cone of the last tile search.
    const last = lastFiring.read();
    return [restored?.cone, last?.coneTo, last?.coneFrom].find(isCone) ?? '6';
  });
  const [base, setBase] = useState<Row[]>(() => (restored?.base.length ? restored.base.map(fromDraftRow) : [newRow()]));
  const [colourants, setColourants] = useState<Row[]>(() => restored?.colourants.map(fromDraftRow) ?? []);
  /** The saved recipe this one came from, if any; saving again overwrites it. */
  const [savedId, setSavedId] = useState<string | null>(restored?.savedId ?? null);
  const [showSaved, setShowSaved] = useState(false);
  /** The recipe just deleted from the list, until it's put back or the list is closed. */
  const [deleted, setDeleted] = useState<{ recipe: SavedRecipe; at: number; wasOpen: boolean } | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  /** The copy Duplicate just made, so pressing it again doesn't make another until something changes. */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const resultsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    umfDraft.write({ name, cone, base, colourants, savedId });
  }, [name, cone, base, colourants, savedId]);

  const baseTotal = totalOf(base);
  const colourantTotal = totalOf(colourants);
  const overallTotal = baseTotal + colourantTotal;

  // Every number on this page comes from the backend's calculator. It has target ranges for a few
  // cones only, so any other is compared with the nearest of those, and the page says so.
  const limitCone = limitConeFor(cone);
  const { calc, keys, updating, error, offline, refetch } = useUmfCalculation([...base, ...colourants], limitCone);
  const result = calc?.result ?? null;
  const hasUmf = !!result && result.fluxSum > 0;
  const warnings = [...new Set((result?.warnings ?? []).map(warningText).filter((text): text is string => text !== null))];
  const suggestions = result?.suggestions ?? [];
  const molePct = useMemo(
    () => Object.entries(result?.molePct ?? {}).filter((entry): entry is [string, number] => Number.isFinite(entry[1]) && entry[1] !== 0).sort((a, b) => b[1] - a[1]),
    [result],
  );

  // Rows the backend left out, shown under the row itself.
  const notes = useMemo(() => {
    const out: Record<number, ReactNode> = {};
    for (const skipped of calc?.skippedRows ?? []) {
      const key = keys[skipped.index];
      if (key !== undefined) out[key] = skippedReason(skipped.reason);
    }
    return out;
  }, [calc, keys]);

  const draft = useMemo<RecipeDraft>(
    () => ({ name, cone, base: fromRows(base), colourants: fromRows(colourants), materialsVersion: calc?.materialsVersion ?? null }),
    [name, cone, base, colourants, calc],
  );
  const stored = saved.find((recipe) => recipe.id === savedId);
  const hasRows = [...base, ...colourants].some((row) => row.picked);
  const upToDate = !!stored && sameRecipe(draft, stored);
  // Work on screen that isn't saved as it stands, which starting another recipe would lose.
  const unsaved = !upToDate && (name.trim() !== '' || [...base, ...colourants].some((row) => row.material !== '' || row.amount !== ''));

  /** Puts back the recipe on screen now, for an Undo after it has been replaced. */
  function keepForUndo() {
    const was = { name, cone, base, colourants, savedId };
    return () => {
      setName(was.name);
      setCone(was.cone);
      setBase(was.base);
      setColourants(was.colourants);
      setSavedId(was.savedId);
    };
  }

  useEffect(() => {
    if (deleted) undoRef.current?.focus();
  }, [deleted]);

  function handleSave() {
    const recipe = savedRecipes.save(draft, savedId ?? undefined);
    if (!recipe) return toast.error(STORAGE_BLOCKED);
    setSavedId(recipe.id);
    setName(recipe.name);
    toast('Recipe saved');
  }

  function handleDuplicate() {
    const copy = savedRecipes.save({ ...draft, name: `${name.trim() || 'Untitled recipe'} (copy)` });
    if (!copy) return toast.error(STORAGE_BLOCKED);
    setCopiedId(copy.id);
    setSavedId(copy.id);
    setName(copy.name);
    toast(`Saved a copy as “${copy.name}”`);
  }

  function open(recipe: SavedRecipe) {
    const undo = unsaved ? keepForUndo() : null;
    setName(recipe.name);
    setCone(isCone(recipe.cone) ? recipe.cone : '6');
    setBase(recipe.base.length > 0 ? toRows(recipe.base) : [newRow()]);
    setColourants(toRows(recipe.colourants));
    setSavedId(recipe.id);
    closeSaved();
    if (undo) toast(`Opened “${recipe.name}”`, { action: { label: 'Undo', onClick: undo } });
  }

  function startNew() {
    const undo = unsaved ? keepForUndo() : null;
    setName('');
    setBase([newRow()]);
    setColourants([]);
    setSavedId(null);
    if (undo) toast('Started a new recipe', { action: { label: 'Undo', onClick: undo } });
  }

  // Undo sits in the list itself, where the focus is, rather than in a toast outside the dialog.
  function remove(recipe: SavedRecipe) {
    const wasOpen = recipe.id === savedId;
    const at = savedRecipes.remove(recipe.id);
    if (at < 0) return toast.error('Couldn’t delete it: this browser isn’t letting Glazion change stored recipes.');
    setDeleted({ recipe, at, wasOpen });
    if (wasOpen) setSavedId(null);
  }

  function undoDelete() {
    if (!deleted) return;
    const { recipe, at, wasOpen } = deleted;
    if (!savedRecipes.restore(recipe, at)) return toast.error(STORAGE_BLOCKED);
    if (wasOpen && !savedId) setSavedId(recipe.id);
    setDeleted(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-recipe="${recipe.id}"]`)?.focus());
  }

  function closeSaved() {
    setShowSaved(false);
    setDeleted(null);
  }

  function exportAs(format: 'json' | 'csv') {
    const title = name.trim() || 'Untitled recipe';
    if (format === 'json') download(recipeFileName(title, 'json'), JSON.stringify(recipeToJson(draft, calc), null, 2), 'application/json');
    else download(recipeFileName(title, 'csv'), recipeToCsv(draft, calc), 'text/csv');
  }

  let analysis: ReactNode;
  if (error && !calc) {
    analysis = offline ? (
      <div className="alert" role="alert">
        <Icon name="alert" size={18} />
        <span>
          Can’t reach Glazion. The calculator runs on our server, so it needs an internet connection.{' '}
          <button type="button" className="link-btn" onClick={() => refetch()}>
            Try again
          </button>
        </span>
      </div>
    ) : (
      <div className="alert" role="alert">
        <Icon name="alert" size={18} />
        <span>
          {errorMessage(error)}{' '}
          <button type="button" className="link-btn" onClick={() => refetch()}>
            Try again
          </button>
        </span>
      </div>
    );
  } else if (!result) {
    analysis = updating ? (
      <p className="umf-updating">
        <span className="spinner" /> Working it out…
      </p>
    ) : (
      <p className="muted">Add materials and amounts to see the analysis.</p>
    );
  } else {
    analysis = (
      <>
        {error && (
          <div className="alert alert-warn" role="alert">
            <Icon name="alert" size={18} />
            <span>{offline ? 'Can’t reach Glazion, so this is the last result. It updates when you’re back online.' : `${errorMessage(error)} This is the last result.`}</span>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="alert alert-warn">
            <Icon name="alert" size={18} />
            <ul className="plain-list">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h3 className="panel-sub">UMF (flux to 1)</h3>
          {calc && <UmfTable calc={calc} />}
        </div>

        <div>
          <h3 className="panel-sub">Key ratios</h3>
          <div className="kv-list">
            <div className="kv">
              <span>SiO₂ : Al₂O₃</span>
              <span className="num">{fixed(result.ratios?.si_al, 2)}</span>
            </div>
            <div className="kv">
              <span>(KNaLi) / (CaMgBaSrZn)</span>
              <span className="num">{fixed(result.ratios?.alkali_over_alkaline, 2)}</span>
            </div>
            <div className="kv">
              <span>B₂O₃ %</span>
              <span className="num">{fixed(result.ratios?.b2o3_pct, 2)}</span>
            </div>
            <div className="kv kv-strong">
              <span>CTE (×10⁻⁷/°C)</span>
              <span className="num">
                {result.cte.toFixed(1)}
                {calc?.cteBand && <span className="muted"> · {CTE_BAND[calc.cteBand] ?? calc.cteBand}</span>}
              </span>
            </div>
          </div>
        </div>

        {/* With the rest of the analysis, not among the inputs. */}
        {molePct.length > 0 && (
          <div>
            <h3 className="panel-sub">Mole %</h3>
            <div className="kv-list">
              {molePct.map(([oxide, value]) => (
                <div key={oxide} className="kv">
                  <span>
                    <OxideName oxide={oxide} />
                  </span>
                  <span className="num">{value.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {result.clayBodyNote && (
          <div className="note">
            <h3 className="note-label">Clay body matching</h3>
            <p>{result.clayBodyNote}</p>
          </div>
        )}

        {(calc?.limits ?? []).length > 0 && hasUmf && (
          <div>
            <h3 className="panel-sub">Suggestions for {limitConeText(cone)}</h3>
            {suggestions.length === 0 ? (
              <p className="alert alert-ok">Every oxide is inside its target range for {limitConeText(cone)}.</p>
            ) : (
              <ul className="suggest">
                {suggestions.map((s) => {
                  const under = s.direction === 'increase';
                  const first = s.materials?.[0]?.name;
                  return (
                    <li key={s.oxide}>
                      <div className="suggest-head">
                        <strong>
                          <OxideName oxide={s.oxide ?? ''} /> is {under ? 'under' : 'over'} {s.target}
                          {first && `: ${under ? 'add' : 'reduce'} ${first}`}
                        </strong>
                        <span className="badge badge-warn">{under ? 'Increase' : 'Decrease'}</span>
                      </div>
                      <p className="hint">
                        Now {formatUmf(s.current)}. {under ? 'Materials' : 'Cut back on materials'} high in <OxideName oxide={s.oxide ?? ''} />:
                      </p>
                      {(s.materials ?? []).map((m) => (
                        <div key={m.name} className="kv">
                          <span>
                            {m.name}
                            {m.inRecipe && <span className="tag in-recipe">In recipe</span>}
                          </span>
                          <span className="num">{m.oxideContent.toFixed(1)}%</span>
                        </div>
                      ))}
                      {s.notes && <p className="hint">{s.notes}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {hasUmf && (
          // The recipe rather than only its UMF, so the search keeps the stains a UMF can't show.
          <button
            className="btn btn-secondary btn-block"
            onClick={() => navigate('/search', { state: { rows: [...fromRows(base), ...fromRows(colourants)].filter((row) => row.material !== ''), cone } })}
          >
            <Icon name="search" size={18} />
            Find tiles like this recipe
          </button>
        )}
      </>
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">UMF calculator</h1>
          <p className="page-sub">Build a recipe and see its Unity Molecular Formula as you type.</p>
        </div>
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={() => setShowSaved(true)}>
            Saved recipes{saved.length > 0 ? ` (${saved.length})` : ''}
          </button>
          <button className="btn btn-secondary" onClick={startNew} disabled={!hasRows && !savedId && name === ''}>
            <Icon name="plus" size={18} />
            New recipe
          </button>
        </div>
      </header>

      <div className="content content-wide">
        <div className="umf-layout">
          <div className="umf-inputs">
            {/* Narrow screens put the analysis below every input, so a line of it stays in view while typing. */}
            {hasUmf && result && (
              <div className="umf-peek">
                <span className="umf-peek-values">
                  <span>
                    SiO₂ <strong>{result.umf?.SiO2 != null ? formatUmf(result.umf.SiO2) : 'n/a'}</strong>
                  </span>
                  <span>
                    Al₂O₃ <strong>{result.umf?.Al2O3 != null ? formatUmf(result.umf.Al2O3) : 'n/a'}</strong>
                  </span>
                  <span>
                    CTE <strong>{result.cte.toFixed(1)}</strong>
                  </span>
                  {suggestions.length > 0 && (
                    <span className="limit-over">
                      {suggestions.length} out of range for cone {limitCone}
                    </span>
                  )}
                </span>
                {updating && <span className="spinner" aria-label="Updating" />}
                <button type="button" className="link-btn" onClick={() => resultsRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })}>
                  Full analysis
                </button>
              </div>
            )}
            <section className="panel">
              <div className="field-row">
                <label className="field">
                  <span className="label">Recipe name</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled recipe" maxLength={80} />
                </label>
                <label className="field">
                  <span className="label">Firing cone</span>
                  <select className="select" value={cone} onChange={(e) => setCone(e.target.value)}>
                    {CONE_DATA.map((data) => (
                      <option key={data.cone} value={data.cone}>
                        Cone {data.cone} ({data.celsius} °C)
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="recipe-actions">
                {/* Save is the one main action here; finding tiles with the UMF is the analysis panel's. */}
                <button className="btn btn-primary" onClick={handleSave} disabled={!hasRows || upToDate}>
                  {upToDate ? 'Saved' : 'Save'}
                </button>
                <button className="btn btn-secondary" onClick={handleDuplicate} disabled={!stored || (upToDate && savedId === copiedId)}>
                  Duplicate
                </button>
                {/* Export as a file, in one button: the format is a choice made once you've decided to export. */}
                <MenuButton
                  disabled={!hasRows}
                  items={[
                    { label: 'CSV file', hint: 'For a spreadsheet', onSelect: () => exportAs('csv') },
                    { label: 'JSON file', hint: 'For another app', onSelect: () => exportAs('json') },
                  ]}
                >
                  <Icon name="download" size={18} />
                  Export
                  <Icon name="chevron-down" size={16} />
                </MenuButton>
              </div>
              <span className="hint">
                {limitCone === cone
                  ? 'The cone sets the target ranges for the suggestions.'
                  : `There are no target ranges for cone ${cone} yet, so the suggestions use cone ${limitCone}’s, the nearest.`}{' '}
                Recipes are saved in this browser for now.
              </span>
            </section>

            <section className="panel">
              <div className="rows-head">
                <h2 className="panel-title">Base glaze</h2>
                <span className="hint">Picked from Glazion’s materials list</span>
              </div>
              <RecipeRows rows={base} onChange={setBase} notes={notes} addLabel="Add base material" amountLabel="Parts" keepOne />
              <Total label="Base total" value={baseTotal} strict action="Retotal to 100" onAction={() => setBase(retotal(base, baseTotal))} />
            </section>

            <section className="panel">
              <div className="rows-head">
                <h2 className="panel-title">Colorants</h2>
                <span className="hint">Metallic oxides and stains, added as % over base</span>
              </div>
              <RecipeRows rows={colourants} onChange={setColourants} notes={notes} addLabel="Add colorant" amountLabel="% of base" />
              {/* Colorants are added on top of a base of 100, so neither they nor the overall total are retotalled. */}
              {colourants.length > 0 && <Total label="Colorants added" value={colourantTotal} />}
            </section>

            {/* With no colorants it would only repeat the base total. */}
            {colourants.length > 0 && (
              <section className="panel">
                <Total label="Overall total (base + colorants)" value={overallTotal} />
              </section>
            )}

          </div>

          <aside className="panel umf-results" ref={resultsRef}>
            <div className="rows-head">
              <h2 className="panel-title">Chemistry analysis</h2>
              {updating && result && (
                <span className="umf-updating">
                  <span className="spinner" /> Updating
                </span>
              )}
            </div>

            {analysis}
          </aside>
        </div>
      </div>

      {showSaved && (
        <Modal title="Saved recipes" description="Kept in this browser until accounts can store them." onClose={closeSaved}>
          {deleted && (
            <div className="alert alert-info saved-undo" role="status">
              <span>Deleted “{deleted.recipe.name}”.</span>
              <button ref={undoRef} type="button" className="link-btn" onClick={undoDelete}>
                Undo
              </button>
            </div>
          )}
          {saved.length === 0 ? (
            <Empty icon="flask" title="Nothing saved yet" text="Build a recipe and press Save to keep it here." />
          ) : (
            <ul className="saved-list">
              {saved.map((recipe) => (
                <li key={recipe.id} className={recipe.id === savedId ? 'is-current' : ''}>
                  <button className="saved-open" data-recipe={recipe.id} onClick={() => open(recipe)}>
                    <strong className="truncate">{recipe.name}</strong>
                    <span className="muted">
                      Cone {recipe.cone} · {materialCount(recipe)} · {formatRelativeTime(recipe.updatedAt)}
                    </span>
                  </button>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(recipe)} aria-label={`Delete ${recipe.name}`} title="Delete">
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </>
  );
}
