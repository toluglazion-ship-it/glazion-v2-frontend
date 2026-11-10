import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MATERIAL_OXIDES, MATERIAL_TOTAL_MAX, adminMaterialsApi, errorMessage, materialId, materialsApi } from '@glazion/api-client';
import type { MaterialCategory, MaterialDuplicateGroup, MaterialOverrideDto, MaterialSummary } from '@glazion/types';
import { Icon, Modal, formatRelativeTime, toast } from '@glazion/ui';
import { Empty, LoadError, LoadMore, Loading } from '../components/ListState';
import { categoryLabel, useCommonMaterials } from '../components/MaterialPicker';
import { useDebounced } from '../hooks/useDebounced';
import { PAGE_SIZE, usePagedList } from '../hooks/usePagedList';
import { formatAmount } from '../lib/materials';

type Analysis = Record<string, number>;

const OXIDE_ORDER = new Map<string, number>(MATERIAL_OXIDES.map((symbol, i) => [symbol, i]));

/** Oxides in the calculator's order (silica first), any it doesn't know at the end. */
function sortedOxides(symbols: Iterable<string>): string[] {
  return [...new Set(symbols)].sort((a, b) => (OXIDE_ORDER.get(a) ?? 999) - (OXIDE_ORDER.get(b) ?? 999) || a.localeCompare(b));
}

/** "SiO2 68.5 · Al2O3 19 · Na2O 7.3 +3 more" */
function shortAnalysis(analysis: Analysis | null | undefined, shown = 4): string {
  const symbols = sortedOxides(Object.keys(analysis ?? {}));
  if (symbols.length === 0) return '';
  const text = symbols
    .slice(0, shown)
    .map((s) => `${s} ${formatAmount(analysis![s])}`)
    .join(' · ');
  return symbols.length > shown ? `${text} +${symbols.length - shown} more` : text;
}

/** "override" for a correction to a material in the file, "custom" for one an administrator added. */
const overrideSource = (o: MaterialOverrideDto): Reverting['source'] => (o.inFile ? 'override' : 'custom');

const sourceBadge = (source: MaterialSummary['source']) =>
  source === 'override' ? <span className="badge badge-info">Corrected</span> : source === 'custom' ? <span className="badge badge-info">Added</span> : null;

function useInvalidateMaterials() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['materials'] });
    queryClient.invalidateQueries({ queryKey: ['admin-materials'] });
  };
}

// ─── Edit or add a material ───────────────────────────────────────────────────

interface OxideLine {
  key: number;
  symbol: string;
  value: string;
}

let nextKey = 1;
const oxideLine = (symbol = '', value = ''): OxideLine => ({
  key: nextKey++,
  symbol,
  value,
});
const toLines = (analysis: Analysis | null | undefined) => sortedOxides(Object.keys(analysis ?? {})).map((s) => oxideLine(s, formatAmount(analysis![s])));
const toNumber = (text: string) => Number(text.trim().replace(',', '.'));

export interface MaterialDraft {
  /** Left out when adding: the id then comes from the name. */
  id?: string;
  name: string;
  oxideAnalysis: Analysis | null;
  loi?: number | null;
  note?: string | null;
}

interface EditProps {
  draft: MaterialDraft;
  title: string;
  description?: string;
  /** A note on where the figures came from is required, as for settling a repeated name. */
  requireNote?: boolean;
  onClose: () => void;
}

function MaterialEditModal({ draft, title, description, requireNote = false, onClose }: EditProps) {
  const invalidate = useInvalidateMaterials();
  const adding = !draft.id;
  const [name, setName] = useState(draft.name);
  const [lines, setLines] = useState<OxideLine[]>(() => {
    const start = toLines(draft.oxideAnalysis);
    return start.length ? start : [oxideLine(), oxideLine(), oxideLine()];
  });
  const [loi, setLoi] = useState(draft.loi != null ? formatAmount(draft.loi) : '');
  const [note, setNote] = useState(draft.note ?? '');
  const [tried, setTried] = useState(false);

  const id = draft.id ?? materialId(name);
  const settledName = useDebounced(name.trim(), 300);

  // When adding, a name that's already on the list corrects that material instead.
  const existing = useQuery({
    queryKey: ['materials', 'check', settledName],
    queryFn: () => materialsApi.search(settledName, 5),
    enabled: adding && settledName.length > 1,
    staleTime: 60_000,
  });
  const clash = adding ? existing.data?.items?.find((m) => m.id === materialId(settledName)) : undefined;

  const save = useMutation({
    mutationFn: (body: Parameters<typeof adminMaterialsApi.save>[1]) => adminMaterialsApi.save(id, body),
    onSuccess: (saved) => {
      invalidate();
      toast(!saved.inFile && adding ? `Added ${saved.name ?? 'the material'}` : `Saved ${saved.name ?? 'the material'}`);
      onClose();
    },
  });

  const filled = lines.filter((l) => l.symbol || l.value.trim());
  const total = filled.reduce((sum, l) => sum + (Number.isFinite(toNumber(l.value)) ? toNumber(l.value) : 0), 0);

  function findProblem(): string | null {
    if (!name.trim()) return 'Give the material a name.';
    if (!adding && materialId(name) !== draft.id)
      return `This name would be a different material (${materialId(name)}). Keep the spelling close enough that it stays ${draft.id}.`;
    if (filled.length === 0) return 'Add at least one oxide.';
    const seen = new Set<string>();
    for (const line of filled) {
      if (!line.symbol) return 'Choose the oxide for every amount.';
      if (seen.has(line.symbol)) return `${line.symbol} is listed twice.`;
      seen.add(line.symbol);
      const value = toNumber(line.value);
      if (!line.value.trim() || !Number.isFinite(value) || value < 0 || value > 100) return `Enter ${line.symbol} as a percentage from 0 to 100.`;
    }
    if (total > MATERIAL_TOTAL_MAX) return `The oxides add up to ${formatAmount(total)}%. The most allowed is ${MATERIAL_TOTAL_MAX}%.`;
    if (loi.trim() && !(toNumber(loi) >= 0 && toNumber(loi) <= 100)) return 'LOI is a percentage from 0 to 100.';
    if (requireNote && !note.trim()) return 'Say where these figures come from.';
    return null;
  }
  const problem = findProblem();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (problem || save.isPending) return;
    save.mutate({
      name: name.trim(),
      oxideAnalysis: Object.fromEntries(filled.map((l) => [l.symbol, toNumber(l.value)])),
      loi: loi.trim() ? toNumber(loi) : null,
      note: note.trim() || null,
    });
  }

  const update = (key: number, changes: Partial<OxideLine>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...changes } : l)));

  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="material-edit" type="submit" disabled={save.isPending || (tried && !!problem)}>
            {save.isPending && <span className="spinner" />}
            {adding && !clash ? 'Add material' : 'Save'}
          </button>
        </>
      }
    >
      <form id="material-edit" className="form" onSubmit={handleSubmit}>
        {(save.isError || (tried && problem)) && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{save.isError ? errorMessage(save.error) : problem}</span>
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="material-name">
            Name
          </label>
          <input id="material-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus={adding} />
          {adding && name.trim() && !clash && <span className="hint">It will be listed as {id}.</span>}
          {clash && (
            <span className="hint hint-bad">
              {clash.name} is already on the list as {clash.id}. Saving will correct its analysis instead of adding a new material.
            </span>
          )}
          {!adding && <span className="hint">Recipes find it by name, so the spelling can change only in ways that keep it {draft.id}.</span>}
        </div>

        <div className="field">
          <span className="label">Oxide analysis</span>
          <div className="rows-editor">
            <div className="rows-line rows-head" aria-hidden="true">
              <span>Oxide</span>
              <span>Weight</span>
              <span />
            </div>
            {lines.map((line, i) => (
              <div className="rows-line" key={line.key}>
                <select className="select" value={line.symbol} onChange={(e) => update(line.key, { symbol: e.target.value })} aria-label={`Oxide ${i + 1}`}>
                  <option value="">Choose an oxide</option>
                  {line.symbol && !OXIDE_ORDER.has(line.symbol) && <option value={line.symbol}>{line.symbol} (the calculator doesn’t use it)</option>}
                  {MATERIAL_OXIDES.map((symbol) => (
                    <option key={symbol} value={symbol}>
                      {symbol}
                    </option>
                  ))}
                </select>
                <div className="input-unit">
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder="0"
                    value={line.value}
                    onChange={(e) => /^[0-9]*[.,]?[0-9]*$/.test(e.target.value) && update(line.key, { value: e.target.value })}
                    aria-label={`Weight of oxide ${i + 1}, percent`}
                  />
                  <span aria-hidden="true">%</span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
                  aria-label={`Remove oxide ${i + 1}`}
                  title="Remove"
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
            <div className="rows-foot">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines([...lines, oxideLine()])}>
                <Icon name="plus" size={16} />
                Add oxide
              </button>
              <span className={`muted${total > MATERIAL_TOTAL_MAX ? ' is-bad' : ''}`}>
                Total {formatAmount(total)}%{loi.trim() && Number.isFinite(toNumber(loi)) ? `, with LOI ${formatAmount(total + toNumber(loi))}%` : ''}
              </span>
            </div>
          </div>
          <span className="hint">Up to {MATERIAL_TOTAL_MAX}% in all, to allow for rounding.</span>
        </div>

        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="material-loi">
              LOI <span className="muted">(optional)</span>
            </label>
            <div className="input-unit">
              <input
                id="material-loi"
                className="input"
                inputMode="decimal"
                placeholder="0"
                value={loi}
                onChange={(e) => /^[0-9]*[.,]?[0-9]*$/.test(e.target.value) && setLoi(e.target.value)}
              />
              <span aria-hidden="true">%</span>
            </div>
          </div>
          <div />
        </div>

        <div className="field">
          <label className="label" htmlFor="material-note">
            Where the figures come from {!requireNote && <span className="muted">(optional)</span>}
          </label>
          <textarea
            id="material-note"
            className="textarea"
            placeholder="e.g. Supplier data sheet, 2025 lot. Checked by Toluwalope."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <p className="modal-note">Saved calculations keep the analysis they used. The next calculation of any recipe uses the new figures.</p>
      </form>
    </Modal>
  );
}

// ─── Undo a correction ────────────────────────────────────────────────────────

function RevertModal({ target, onClose }: { target: { id: string; name: string | null; source: 'override' | 'custom' }; onClose: () => void }) {
  const invalidate = useInvalidateMaterials();
  const revert = useMutation({
    mutationFn: () => adminMaterialsApi.revert(target.id),
    onSuccess: () => {
      invalidate();
      toast(target.source === 'custom' ? `Removed ${target.name ?? 'the material'}` : `${target.name ?? 'The material'} is back to the original figures`);
      onClose();
    },
  });
  const removing = target.source === 'custom';

  return (
    <Modal
      title={removing ? `Remove ${target.name ?? 'this material'}?` : `Undo the correction to ${target.name ?? 'this material'}?`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Keep it
          </button>
          <button className="btn btn-danger" onClick={() => revert.mutate()} disabled={revert.isPending}>
            {revert.isPending && <span className="spinner" />}
            {removing ? 'Remove material' : 'Undo correction'}
          </button>
        </>
      }
    >
      {revert.isError && (
        <div className="alert" role="alert">
          <Icon name="alert" size={18} />
          <span>{errorMessage(revert.error)}</span>
        </div>
      )}
      <p className="modal-note">
        {removing
          ? 'It was added here, so it leaves the list. Recipes that use it will no longer find it.'
          : 'It goes back to the analysis in the original materials list.'}{' '}
        Saved calculations keep the figures they used.
      </p>
    </Modal>
  );
}

// ─── All materials ────────────────────────────────────────────────────────────

type Editing = {
  draft: MaterialDraft;
  title: string;
  description?: string;
  requireNote?: boolean;
};
type Reverting = {
  id: string;
  name: string | null;
  source: 'override' | 'custom';
};

interface TabProps {
  onEdit: (editing: Editing) => void;
  onRevert: (target: Reverting) => void;
}

function AllMaterials({ onEdit, onRevert }: TabProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<MaterialCategory | ''>('');
  const [withAnalysis, setWithAnalysis] = useState(false);
  const term = useDebounced(search.trim());
  const categories = useCommonMaterials().data?.categories ?? [];

  const list = usePagedList<MaterialSummary>(['materials', 'admin-list', { term, category, withAnalysis }], async (cursor) => {
    const res = await materialsApi.list({
      q: term || undefined,
      category: category || undefined,
      withAnalysis: withAnalysis || undefined,
      cursor,
      pageSize: PAGE_SIZE,
    });
    return {
      items: res.items,
      totalCount: res.total,
      nextCursor: res.nextCursor ?? null,
    };
  });

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={16} />
          <input
            className="input"
            placeholder="Search by name or alias, e.g. EPK"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search materials"
          />
        </div>
        <select className="select toolbar-select" value={category} onChange={(e) => setCategory(e.target.value as MaterialCategory | '')} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label ?? c.key}
            </option>
          ))}
        </select>
        <label className="toolbar-check">
          <input type="checkbox" checked={withAnalysis} onChange={(e) => setWithAnalysis(e.target.checked)} />
          <span>Only with an analysis</span>
        </label>
      </div>

      <div className="card">
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <LoadError error={list.error} onRetry={() => list.refetch()} />
        ) : list.items.length === 0 ? (
          <Empty icon="search" title="No matches" text={term ? `No material matches “${term}”.` : 'No materials in this category.'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Category</th>
                  <th>Analysis</th>
                  <th className="num">LOI</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.items.map((m) => (
                  <tr key={m.id ?? m.name}>
                    <td className="cell-wide">
                      <div className="cell-strong">
                        {m.name} {m.common && <span className="badge">Common</span>} {sourceBadge(m.source)}
                      </div>
                      {(!!m.matchedAlias || !!m.aliases?.length) && (
                        <div className="muted">{m.matchedAlias ? `Matched “${m.matchedAlias}”` : `Also ${m.aliases!.join(', ')}`}</div>
                      )}
                    </td>
                    <td className="muted">{categoryLabel(categories, m.category) ?? '—'}</td>
                    <td>
                      {m.hasAnalysis ? (
                        <span className="mono analysis">{shortAnalysis(m.oxideAnalysis)}</span>
                      ) : (
                        <span className="badge badge-warn">No analysis</span>
                      )}
                    </td>
                    <td className="num muted">{m.hasAnalysis ? `${formatAmount(m.loi_pct)}%` : '—'}</td>
                    <td className="cell-actions">
                      {(m.source === 'override' || m.source === 'custom') && (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() =>
                            onRevert({
                              id: m.id!,
                              name: m.name,
                              source: m.source as Reverting['source'],
                            })
                          }
                        >
                          {m.source === 'custom' ? 'Remove' : 'Undo'}
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-secondary"
                        disabled={!m.id}
                        onClick={() =>
                          onEdit({
                            draft: {
                              id: m.id!,
                              name: m.name ?? '',
                              oxideAnalysis: m.oxideAnalysis,
                              loi: m.loi_pct,
                            },
                            title: `Correct ${m.name}`,
                            description: 'The original list is never edited. Your figures are used over it, and you can undo them at any time.',
                          })
                        }
                      >
                        Correct
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore
          shown={list.items.length}
          total={list.total}
          hasMore={!!list.hasNextPage}
          loading={list.isFetchingNextPage}
          onLoadMore={() => list.fetchNextPage()}
        />
      </div>
    </>
  );
}

// ─── Corrections ──────────────────────────────────────────────────────────────

function Corrections({ onEdit, onRevert }: TabProps) {
  const overrides = useQuery({
    queryKey: ['admin-materials', 'overrides'],
    queryFn: adminMaterialsApi.overrides,
  });
  const items = [...(overrides.data ?? [])].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));

  const edit = (o: MaterialOverrideDto) =>
    onEdit({
      draft: {
        id: o.materialId ?? undefined,
        name: o.name ?? '',
        oxideAnalysis: o.oxideAnalysis,
        loi: o.loi,
        note: o.note,
      },
      title: `Correct ${o.name ?? o.materialId}`,
    });

  return (
    <div className="card">
      {overrides.isPending ? (
        <Loading />
      ) : overrides.isError ? (
        <LoadError error={overrides.error} onRetry={() => overrides.refetch()} />
      ) : items.length === 0 ? (
        <Empty
          icon="layers"
          title="No corrections yet"
          text="Every material uses the figures from the original list. Corrections and added materials show here."
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Analysis</th>
                <th>Where the figures come from</th>
                <th>Changed</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.materialId ?? o.name}>
                  <td>
                    <div className="cell-strong">
                      {o.name ?? o.materialId} {sourceBadge(overrideSource(o))}
                    </div>
                    <div className="muted mono">{o.materialId}</div>
                  </td>
                  <td>
                    <span className="mono analysis">{shortAnalysis(o.oxideAnalysis)}</span>
                  </td>
                  <td className="cell-wide">{o.note ? <span className="cell-clamp">{o.note}</span> : <span className="muted">—</span>}</td>
                  <td className="muted">{formatRelativeTime(o.updatedAt)}</td>
                  <td className="cell-actions">
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() =>
                        onRevert({
                          id: o.materialId!,
                          name: o.name,
                          source: overrideSource(o),
                        })
                      }
                      disabled={!o.materialId}
                    >
                      {o.inFile ? 'Undo' : 'Remove'}
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={() => edit(o)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Repeated names ───────────────────────────────────────────────────────────

function DuplicateGroup({ group, fix, onEdit, onRevert }: { group: MaterialDuplicateGroup & { materialId: string }; fix: MaterialOverrideDto | null } & TabProps) {
  const entries = group.entries ?? [];
  const differ = !group.identical;
  const columns: {
    key: string;
    title: string;
    sub: string;
    analysis: Analysis;
    loi: number | null | undefined;
    inUse: boolean;
    isFix?: boolean;
  }[] = entries.map((e, i) => ({
    key: `entry-${i}`,
    title: e.name ?? group.materialId,
    sub: `Entry ${i + 1} of ${entries.length}`,
    analysis: e.oxideAnalysis ?? {},
    loi: e.loi,
    inUse: !fix && e.usedByCalculator,
  }));
  if (fix)
    columns.push({
      key: 'fix',
      title: 'Decided',
      sub: fix.note ?? 'Correction',
      analysis: fix.oxideAnalysis ?? {},
      loi: fix.loi,
      inUse: true,
      isFix: true,
    });

  const symbols = sortedOxides(columns.flatMap((c) => Object.keys(c.analysis)));
  const differs = (values: (number | null | undefined)[]) => new Set(values.map((v) => v ?? 0)).size > 1;
  const name = entries[entries.length - 1]?.name ?? group.materialId;

  function choose(index: number | null) {
    const entry = index === null ? entries[entries.length - 1] : entries[index];
    onEdit({
      draft: {
        id: group.materialId,
        name: entry?.name ?? name,
        oxideAnalysis: fix && index === null ? fix.oxideAnalysis : (entry?.oxideAnalysis ?? {}),
        loi: fix && index === null ? fix.loi : entry?.loi,
        note: index === null ? (fix?.note ?? '') : `Entry ${index + 1} of ${entries.length} in materials.json (${entry?.name ?? name}). `,
      },
      title: index === null ? `Enter the figures for ${name}` : `Use entry ${index + 1} for ${name}`,
      description: 'Every spelling of this name will use these figures. Check them, then say where they come from.',
      requireNote: true,
    });
  }

  return (
    <div className="card dup">
      <div className="card-head dup-head">
        <div>
          <h2 className="card-title">
            {entries
              .map((e) => e.name)
              .filter((n, i, all) => all.indexOf(n) === i)
              .join(' · ') || group.materialId}
          </h2>
          <span className="muted mono">{group.materialId}</span>
        </div>
        {group.resolvedByOverride ? (
          <span className="badge badge-ok">Decided</span>
        ) : differ ? (
          <span className="badge badge-warn">Needs a decision</span>
        ) : (
          <span className="badge">Identical</span>
        )}
      </div>
      <div className="table-wrap">
        <table className="table dup-table">
          <thead>
            <tr>
              <th>Oxide</th>
              {columns.map((c) => (
                <th key={c.key} className={`num${c.inUse ? ' is-used' : ''}`}>
                  <div>{c.title}</div>
                  <div className="muted dup-sub">{c.isFix ? 'Used now' : c.inUse ? `${c.sub} · used now` : c.sub}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((s) => {
              const diff = differs(columns.map((c) => c.analysis[s]));
              return (
                <tr key={s} className={diff ? 'is-diff' : ''}>
                  <td className="mono">{s}</td>
                  {columns.map((c) => (
                    <td key={c.key} className={`num${c.inUse ? ' is-used' : ''}`}>
                      {c.analysis[s] != null ? formatAmount(c.analysis[s]) : <span className="muted">—</span>}
                    </td>
                  ))}
                </tr>
              );
            })}
            {symbols.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="muted">
                  No analysis in any entry.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className={differs(columns.map((c) => c.loi)) ? 'is-diff' : ''}>
              <td>LOI</td>
              {columns.map((c) => (
                <td key={c.key} className={`num${c.inUse ? ' is-used' : ''}`}>
                  {formatAmount(c.loi ?? 0)}
                </td>
              ))}
            </tr>
            <tr>
              <td>Total</td>
              {columns.map((c) => (
                <td key={c.key} className={`num${c.inUse ? ' is-used' : ''}`}>
                  {formatAmount(Object.values(c.analysis).reduce((a, b) => a + b, 0))}%
                </td>
              ))}
            </tr>
            {differ && (
              <tr className="dup-actions">
                <td />
                {columns.map((c, i) => (
                  <td key={c.key} className="num">
                    {c.isFix ? (
                      <button className="btn btn-sm btn-ghost" onClick={() => onRevert({ id: group.materialId, name, source: 'override' })}>
                        Undo
                      </button>
                    ) : (
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => choose(i)}
                        disabled={Object.keys(c.analysis).length === 0}
                        title={Object.keys(c.analysis).length === 0 ? 'This entry has no analysis' : undefined}
                      >
                        Use these
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      {differ && (
        <div className="dup-foot">
          <span className="muted">
            {fix
              ? 'Settled. Every spelling uses the decided figures.'
              : 'Today the calculator uses the later entry. Pick the right figures, or enter others from a data sheet.'}
          </span>
          <button className="btn btn-sm btn-secondary" onClick={() => choose(null)}>
            {fix ? 'Edit the figures' : 'Enter other figures'}
          </button>
        </div>
      )}
    </div>
  );
}

function RepeatedNames(props: TabProps) {
  const duplicates = useQuery({
    queryKey: ['admin-materials', 'duplicates'],
    queryFn: adminMaterialsApi.duplicates,
  });
  // The duplicates list says a group is settled; the figures it was settled with are in the overrides.
  const overrides = useQuery({
    queryKey: ['admin-materials', 'overrides'],
    queryFn: adminMaterialsApi.overrides,
  });
  const fixFor = (id: string) => overrides.data?.find((o) => o.materialId === id) ?? null;
  const [showIdentical, setShowIdentical] = useState(false);
  const groups = (duplicates.data ?? []).filter((g): g is MaterialDuplicateGroup & { materialId: string } => !!g.materialId);
  const differing = groups.filter((g) => !g.identical);
  const identical = groups.filter((g) => g.identical);
  const open = differing.filter((g) => !g.resolvedByOverride).length;

  if (duplicates.isPending || overrides.isPending) return <Loading />;
  if (duplicates.isError) return <LoadError error={duplicates.error} onRetry={() => duplicates.refetch()} />;
  if (overrides.isError) return <LoadError error={overrides.error} onRetry={() => overrides.refetch()} />;
  if (groups.length === 0) return <Empty icon="check" title="No repeated names" text="Every name in the materials list appears once." />;

  return (
    <div className="dup-list">
      <div className={`alert ${open ? 'alert-warn' : 'alert-ok'}`}>
        <Icon name={open ? 'alert' : 'check'} size={18} />
        <span>
          {open
            ? `${open} of the ${differing.length} repeated names with different figures still need a decision. Someone who knows the materials should choose which figures are right.`
            : `All ${differing.length} repeated names with different figures are decided.`}
        </span>
      </div>

      {differing.map((g) => (
        <DuplicateGroup key={g.materialId} group={g} fix={g.resolvedByOverride ? fixFor(g.materialId) : null} {...props} />
      ))}

      {identical.length > 0 && (
        <div className="card">
          <div className="card-head dup-head">
            <div>
              <h2 className="card-title">Repeated with the same figures</h2>
              <span className="muted">
                {identical.length} names appear more than once with identical figures, so nothing needs deciding. Each shows once in the list.
              </span>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowIdentical(!showIdentical)} aria-expanded={showIdentical}>
              {showIdentical ? 'Hide' : 'Show'}
            </button>
          </div>
          {showIdentical && (
            <ul className="item-list">
              {identical.map((g) => (
                <li key={g.materialId}>
                  <span className="cell-strong">{g.entries?.[0]?.name ?? g.materialId}</span> <span className="muted">× {g.entries?.length ?? 0}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'all' | 'corrections' | 'repeats';

export default function MaterialsPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [reverting, setReverting] = useState<Reverting | null>(null);
  const duplicates = useQuery({
    queryKey: ['admin-materials', 'duplicates'],
    queryFn: adminMaterialsApi.duplicates,
  });
  const undecided = (duplicates.data ?? []).filter((g) => !g.identical && !g.resolvedByOverride).length;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'all', label: 'All materials' },
    { id: 'corrections', label: 'Corrections' },
    { id: 'repeats', label: 'Repeated names', count: undecided },
  ];
  const props: TabProps = { onEdit: setEditing, onRevert: setReverting };

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Materials</h1>
          <p className="page-sub">The list recipes pick from and are calculated against. Correct a material’s figures or add one that’s missing.</p>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-primary"
            onClick={() =>
              setEditing({
                draft: { name: '', oxideAnalysis: null },
                title: 'Add a material',
                description: 'For a material that isn’t on the list yet. It becomes available to every recipe.',
              })
            }
          >
            <Icon name="plus" size={18} />
            Add material
          </button>
        </div>
      </header>

      <div className="content">
        <div className="segmented" role="tablist" aria-label="Materials views">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
              {!!t.count && <span className="tab-count">{t.count}</span>}
            </button>
          ))}
        </div>

        {tab === 'all' && <AllMaterials {...props} />}
        {tab === 'corrections' && <Corrections {...props} />}
        {tab === 'repeats' && <RepeatedNames {...props} />}
      </div>

      {editing && <MaterialEditModal {...editing} onClose={() => setEditing(null)} />}
      {reverting && <RevertModal target={reverting} onClose={() => setReverting(null)} />}
    </>
  );
}
