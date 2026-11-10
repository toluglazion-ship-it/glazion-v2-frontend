import { FiringFields, coneValue, firingLabel } from './FiringFields';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { baseGlazesApi, captureCodesApi, errorMessage, recipesApi, usersApi } from '@glazion/api-client';
import { MAX_VARIATIONS_PER_BASE, type BaseGlazeDto, type MaterialRow, type RecipeDto } from '@glazion/types';
import { Icon, Modal, recipeTitle, toast } from '@glazion/ui';
import { LoadError, Loading } from './ListState';
import MaterialPicker from './MaterialPicker';
import MaterialRows from './MaterialRows';
import { combinations, describeRows, draftRow, formatAmount, formatQuantity, parseRows, readAmounts, readDraftRows, toDraftRows, type DraftRow } from '../lib/materials';

const pad3 = (n: number) => String(n).padStart(3, '0');

/** How many variation numbers a base has left. Numbers are never reused, so a full base stays full. */
export function numbersLeft(base: BaseGlazeDto): number {
  if (!base.nextRecipeNumber) return base.variationCount >= MAX_VARIATIONS_PER_BASE ? 0 : MAX_VARIATIONS_PER_BASE - base.variationCount;
  return Math.max(0, MAX_VARIATIONS_PER_BASE - base.nextRecipeNumber + 1);
}

/** The code the variation `offset` places after the next one will get, e.g. P01-B1-004. The server has the final say. */
export function nextCode(base: BaseGlazeDto, offset = 0): string | null {
  if (!base.code || !base.nextRecipeNumber) return null;
  const n = base.nextRecipeNumber + offset;
  return n > MAX_VARIATIONS_PER_BASE ? null : `${base.code}-${pad3(n)}`;
}

/** "B2", the short form used in variation names. */
export const shortBase = (base: BaseGlazeDto) => `B${base.baseNumber}`;

/** "B2 + 1% Copper Carbonate + 2% Red Iron Oxide", the client's naming. */
export const autoName = (base: BaseGlazeDto, additions: MaterialRow[]) =>
  `${shortBase(base)} + ${additions.length ? additions.map((r) => `${formatQuantity(r)} ${r.rawName}`).join(' + ') : 'nothing added'}`;

/** Everyone who has a participant code, which is who bases can be registered for. */
export function useParticipants() {
  const users = useQuery({ queryKey: ['users', 'options'], queryFn: () => usersApi.list({ pageSize: 100 }) });
  const participants = (users.data?.items ?? [])
    .filter((u) => u.participantCode)
    .sort((a, b) => a.participantCode!.localeCompare(b.participantCode!, undefined, { numeric: true }));
  return { ...users, participants };
}

/** Every base, for choosing one and for linking a variation to the base it became. */
export function useAllBases() {
  return useQuery({ queryKey: ['base-glazes', { participantCode: '' }], queryFn: () => baseGlazesApi.list() });
}

function invalidateRegister(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['base-glazes'] });
  queryClient.invalidateQueries({ queryKey: ['recipes'] });
  queryClient.invalidateQueries({ queryKey: ['code-recipes'] });
  queryClient.invalidateQueries({ queryKey: ['capture-codes'] });
  queryClient.invalidateQueries({ queryKey: ['overview'] });
}

function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="alert" role="alert">
      <Icon name="alert" size={18} />
      <span>{text}</span>
    </div>
  );
}

/** Which base, when the modal was opened from Recipes rather than from a base. */
function BaseChooser({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const bases = useAllBases();
  return (
    <div className="field">
      <label className="label" htmlFor="variation-base">
        Base glaze
      </label>
      <select id="variation-base" className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{bases.isPending ? 'Loading…' : 'Choose the base to add to'}</option>
        {(bases.data ?? []).map((b) => (
          <option key={b.id} value={b.code ?? ''} disabled={numbersLeft(b) === 0}>
            {b.code}
            {b.name ? ` · ${b.name}` : ''}
            {numbersLeft(b) === 0 ? ' (full)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

function FullNotice({ base }: { base: BaseGlazeDto }) {
  return (
    <div className="alert alert-warn" role="alert">
      <Icon name="alert" size={18} />
      <span>
        {base.code} has used all {MAX_VARIATIONS_PER_BASE} variation numbers. Make a good variation a base of its own to keep testing from it.
      </span>
    </div>
  );
}

// ─── One variation ────────────────────────────────────────────────────────────

/**
 * Adds one variation. `from` starts it from an existing variation's additions, which is how a
 * variation is adjusted: tested variations keep their number and recipe, so a tweak is a new one.
 */
export function AddVariationModal({ code: fixedCode, from, onClose, onCreated }: { code?: string; from?: RecipeDto; onClose: () => void; onCreated?: (recipes: RecipeDto[]) => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState(fixedCode ?? from?.baseCode ?? '');
  const base = useQuery({ queryKey: ['base-glazes', code], queryFn: () => baseGlazesApi.getOne(code), enabled: !!code });
  const [rows, setRows] = useState<DraftRow[]>(() => {
    const start = parseRows(from?.additionsJson);
    return start.length ? toDraftRows(start) : [draftRow()];
  });
  const [name, setName] = useState('');
  const [description, setDescription] = useState(from?.description ?? '');
  // Empty follows the base; set only when this one fires differently.
  const [cone, setCone] = useState(from?.cone ?? '');
  const [atmosphere, setAtmosphere] = useState(from?.atmosphere ?? '');
  const [tried, setTried] = useState(false);
  const [another, setAnother] = useState(false);

  const additions = readDraftRows(rows, { allowZero: true });
  const suggested = base.data ? autoName(base.data, additions.rows) : '';
  const full = !!base.data && numbersLeft(base.data) === 0;
  const sameAsFrom = !!from && JSON.stringify(additions.rows) === JSON.stringify(parseRows(from.additionsJson).map((r) => ({ ...r, unit: '%' })));

  const add = useMutation({
    mutationFn: () =>
      baseGlazesApi.addVariation(code, {
        name: name.trim() || suggested,
        description: description.trim() || null,
        additions: additions.rows,
        cone: coneValue(cone) || null,
        atmosphere: atmosphere || null,
      }),
    onSuccess: (recipe) => {
      invalidateRegister(queryClient);
      toast(`Added ${recipe.code ?? 'the variation'}`);
      if (another) {
        // Same materials, new amounts is the usual next test, so the rows stay.
        setName('');
        setTried(false);
      } else if (onCreated) {
        onCreated([recipe]);
      } else {
        onClose();
      }
    },
  });

  function submit(next: boolean) {
    setTried(true);
    setAnother(next);
    if (additions.problem || add.isPending || !base.data || full) return;
    add.mutate();
  }

  const upcoming = base.data ? nextCode(base.data) : null;
  const left = base.data ? numbersLeft(base.data) : 0;

  return (
    <Modal
      title={from ? `New variation from ${from.code}` : upcoming ? `Add ${upcoming}` : 'Add a variation'}
      description={
        base.data
          ? `${from && upcoming ? `It will be ${upcoming}. ` : ''}Base ${base.data.code}${base.data.name ? `, ${base.data.name}` : ''}. The number is given when it’s saved and never reused.`
          : undefined
      }
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            {add.isSuccess ? 'Done' : 'Cancel'}
          </button>
          {!from && (
            <button className="btn btn-secondary" onClick={() => submit(true)} disabled={add.isPending || !base.data || full || left < 2}>
              {add.isPending && another && <span className="spinner" />}
              Add and start another
            </button>
          )}
          <button className="btn btn-primary" onClick={() => submit(false)} disabled={add.isPending || !base.data || full}>
            {add.isPending && !another && <span className="spinner" />}
            Add variation
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        {!fixedCode && !from && <BaseChooser value={code} onChange={setCode} />}
        {code && base.isPending ? (
          <Loading />
        ) : base.isError ? (
          <LoadError error={base.error} onRetry={() => base.refetch()} />
        ) : base.data ? (
          <>
            {full && <FullNotice base={base.data} />}
            <Problem text={add.isError ? errorMessage(add.error) : tried ? additions.problem : null} />

            {from && (
              <div className="note">
                <div className="note-label">Starting from {from.code}</div>
                {recipeTitle(from)}. Change the amounts or materials; {from.code} itself stays as it was tested.
              </div>
            )}

            <div className="field">
              <span className="label">Added to {base.data.code}</span>
              <MaterialRows rows={rows} onChange={setRows} addLabel="Add material" />
              <span className="hint">
                {sameAsFrom
                  ? `This is the same as ${from!.code}. Change something, or it will just be a repeat test.`
                  : 'Amounts are % on top of the base. 0% is fine for a control tile; no rows means the base as it is.'}
              </span>
            </div>

            <div className="field">
              <label className="label" htmlFor="variation-name">
                Name <span className="muted">(optional)</span>
              </label>
              <input id="variation-name" className="input" placeholder={suggested} value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="field">
              <span className="label">
                Firing <span className="muted">(only if it fires differently from {base.data.code})</span>
              </span>
              <FiringFields
                idPrefix="variation"
                cone={cone}
                atmosphere={atmosphere}
                onCone={setCone}
                onAtmosphere={setAtmosphere}
                emptyLabel={`As the base${firingLabel(base.data.cone, base.data.atmosphere) ? `: ${firingLabel(base.data.cone, base.data.atmosphere)}` : ''}`}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="variation-desc">
                Notes for the photographer <span className="muted">(optional)</span>
              </label>
              <textarea id="variation-desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </>
        ) : null}
      </form>
    </Modal>
  );
}

// ─── Several variations ───────────────────────────────────────────────────────

interface SeriesRow {
  key: number;
  rawName: string;
  picked: boolean;
  amounts: string;
}

let nextSeriesKey = 1;
const seriesRow = (): SeriesRow => ({ key: nextSeriesKey++, rawName: '', picked: false, amounts: '' });

/**
 * Adds a test series in one go: each material with the amounts to try, every combination becoming
 * a variation (iron at 1, 2, 3% with cobalt at 0.5, 1% is six). Optionally puts them all on a capture code.
 */
export function AddVariationsModal({ code: fixedCode, onClose, onCreated }: { code?: string; onClose: () => void; onCreated?: (recipes: RecipeDto[]) => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState(fixedCode ?? '');
  const base = useQuery({ queryKey: ['base-glazes', code], queryFn: () => baseGlazesApi.getOne(code), enabled: !!code });
  const codes = useQuery({ queryKey: ['capture-codes', 'options'], queryFn: () => captureCodesApi.list({ activeOnly: true, pageSize: 100 }) });
  const [series, setSeries] = useState<SeriesRow[]>(() => [seriesRow()]);
  const [description, setDescription] = useState('');
  const [captureCodeId, setCaptureCodeId] = useState('');
  const [tried, setTried] = useState(false);

  // Read the rows: the first problem, or the materials with their amounts.
  let problem: string | null = null;
  const read: { rawName: string; amounts: number[] }[] = [];
  for (const row of series) {
    const rawName = row.rawName.trim();
    if (!rawName && !row.amounts.trim()) continue;
    if (!rawName) {
      problem = 'Every set of amounts needs a material.';
      break;
    }
    if (!row.picked) {
      problem = `Choose “${rawName}” from the materials list, so the recipes are calculated with the right material.`;
      break;
    }
    const amounts = readAmounts(row.amounts);
    if (!amounts || amounts.length === 0) {
      problem = `Enter the amounts of ${rawName} to try, e.g. 0.5, 1, 2 or 1-10.`;
      break;
    }
    read.push({ rawName, amounts });
  }
  if (!problem && read.length === 0) problem = 'Add a material and the amounts to try.';
  if (!problem && new Set(read.map((r) => r.rawName)).size < read.length) problem = 'Each material goes on one line, with all its amounts.';

  const sets = problem ? [] : combinations(read);
  const left = base.data ? numbersLeft(base.data) : 0;
  if (!problem && base.data && sets.length > left)
    problem = left === 0 ? null : `That makes ${sets.length} variations, and ${base.data.code} has room for ${left} more. Try fewer amounts.`;
  const full = !!base.data && left === 0;

  const add = useMutation({
    mutationFn: () =>
      baseGlazesApi.addVariations(code, {
        variations: sets.map((additions) => ({ name: autoName(base.data!, additions), description: description.trim() || null, additions })),
        captureCodeId: captureCodeId || null,
      }),
    onSuccess: (created) => {
      invalidateRegister(queryClient);
      const first = created[0]?.code;
      const last = created[created.length - 1]?.code;
      toast(created.length === 1 ? `Added ${first ?? 'the variation'}` : first && last ? `Added ${first} to ${last}` : `Added ${created.length} variations`);
      if (onCreated) onCreated(created);
      else onClose();
    },
  });

  function submit() {
    setTried(true);
    if (problem || add.isPending || !base.data || full) return;
    add.mutate();
  }

  const PREVIEW = 12;

  return (
    <Modal
      title={base.data ? `Add a test series to ${base.data.code}` : 'Add a test series'}
      description="Each material with the amounts to try. Every combination becomes a variation with its own number."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={add.isPending || !base.data || full || (tried && !!problem)}>
            {add.isPending && <span className="spinner" />}
            {sets.length > 0 ? `Add ${sets.length} variation${sets.length === 1 ? '' : 's'}` : 'Add variations'}
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {!fixedCode && <BaseChooser value={code} onChange={setCode} />}
        {code && base.isPending ? (
          <Loading />
        ) : base.isError ? (
          <LoadError error={base.error} onRetry={() => base.refetch()} />
        ) : base.data ? (
          <>
            {full && <FullNotice base={base.data} />}
            <Problem text={add.isError ? errorMessage(add.error) : tried ? problem : null} />

            <div className="field">
              <span className="label">Added to {base.data.code}</span>
              <div className="rows-editor">
                <div className="rows-line rows-line-series rows-head" aria-hidden="true">
                  <span>Material</span>
                  <span>Amounts to try, %</span>
                  <span />
                </div>
                {series.map((row, i) => (
                  <div className="rows-line rows-line-series" key={row.key}>
                    <MaterialPicker
                      value={row.rawName}
                      picked={row.picked}
                      onChange={(rawName, picked) => setSeries(series.map((r) => (r.key === row.key ? { ...r, rawName, picked } : r)))}
                      label={`Material ${i + 1}`}
                    />
                    <input
                      className="input"
                      inputMode="decimal"
                      placeholder="e.g. 0.5, 1, 2 or 1-10"
                      value={row.amounts}
                      onChange={(e) => setSeries(series.map((r) => (r.key === row.key ? { ...r, amounts: e.target.value } : r)))}
                      aria-label={`Amounts of material ${i + 1} to try, percent`}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => setSeries(series.filter((r) => r.key !== row.key))}
                      aria-label={`Remove material ${i + 1}`}
                      title="Remove"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                ))}
                <div className="rows-foot">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSeries([...series, seriesRow()])}>
                    <Icon name="plus" size={16} />
                    Add material
                  </button>
                  <span className="muted">
                    {left} of {MAX_VARIATIONS_PER_BASE} numbers left
                  </span>
                </div>
              </div>
              <span className="hint">
                A range counts too: 1-10 is 1 to 10% in steps of 1, 0.5-0.9 step 0.2 is 0.5, 0.7 and 0.9%. A material that should be in every tile at one amount goes on
                its own line with that one amount.
              </span>
            </div>

            {sets.length > 0 && (
              <div className="field">
                <span className="label">
                  Will be added <span className="muted">{sets.length}</span>
                </span>
                <ul className="item-list">
                  {sets.slice(0, PREVIEW).map((additions, i) => (
                    <li key={i}>
                      <span className="tile-code">{nextCode(base.data!, i) ?? '—'}</span>
                      <span className="recipe-label">{autoName(base.data!, additions)}</span>
                    </li>
                  ))}
                  {sets.length > PREVIEW && (
                    <li>
                      <span className="muted">
                        and {sets.length - PREVIEW} more, to {nextCode(base.data!, sets.length - 1) ?? '—'}
                      </span>
                    </li>
                  )}
                </ul>
              </div>
            )}

            <div className="field">
              <label className="label" htmlFor="series-code">
                Also put them on a capture code <span className="muted">(optional)</span>
              </label>
              <select id="series-code" className="select" value={captureCodeId} onChange={(e) => setCaptureCodeId(e.target.value)}>
                <option value="">No, I’ll add them later</option>
                {(codes.data?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.assignedUsername ? `@${c.assignedUsername}` : 'Code'} · ••••{c.maskedSuffix}
                    {c.labelPrefix ? ` · ${c.labelPrefix}` : ''}
                  </option>
                ))}
              </select>
              <span className="hint">So the photographer sees the new tiles in Capture straight away.</span>
            </div>

            <div className="field">
              <label className="label" htmlFor="series-desc">
                Notes for the photographer <span className="muted">(optional, on every variation)</span>
              </label>
              <textarea id="series-desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </>
        ) : null}
      </form>
    </Modal>
  );
}

// ─── Make a variation a base ──────────────────────────────────────────────────

/** The base's rows with the additions on top, as a preview of what the new base starts from. */
function combined(formulation: MaterialRow[], additions: MaterialRow[]): MaterialRow[] {
  const rows = formulation.map((row) => ({ ...row }));
  for (const add of additions) {
    const same = rows.find((row) => row.rawName.toLowerCase() === add.rawName.toLowerCase() && (row.unit?.trim() || '%') === (add.unit?.trim() || '%'));
    if (same) same.amount += add.amount;
    else rows.push({ ...add });
  }
  return rows;
}

/**
 * A variation that came out well becomes a base of its own, taking its participant's next base
 * number: P01-B1-002 becomes P01-B2, so codes never get longer. The variation keeps its own code.
 */
export function PromoteModal({ recipe, onClose, onPromoted }: { recipe: RecipeDto; onClose: () => void; onPromoted: (base: BaseGlazeDto) => void }) {
  const queryClient = useQueryClient();
  const from = useQuery({
    queryKey: ['base-glazes', recipe.baseCode],
    queryFn: () => baseGlazesApi.getOne(recipe.baseCode!),
    enabled: !!recipe.baseCode,
  });
  const { participants } = useParticipants();
  const [participantCode, setParticipantCode] = useState('');
  const owner = participantCode || from.data?.participantCode || '';
  const theirBases = useQuery({
    queryKey: ['base-glazes', { participantCode: owner }],
    queryFn: () => baseGlazesApi.list(owner),
    enabled: !!owner,
  });
  const nextNumber = (theirBases.data ?? []).reduce((n, b) => Math.max(n, b.baseNumber), 0) + 1;
  const [name, setName] = useState(recipe.name && recipe.name !== recipe.code ? recipe.name : '');
  const [description, setDescription] = useState('');

  const additions = parseRows(recipe.additionsJson);
  const preview = from.data?.formulation ? combined(from.data.formulation, additions) : [];

  const promote = useMutation({
    mutationFn: () =>
      recipesApi.promote(recipe.code!, {
        name: name.trim() || null,
        description: description.trim() || null,
        participantCode: participantCode && participantCode !== from.data?.participantCode ? participantCode : null,
      }),
    onSuccess: (base) => {
      invalidateRegister(queryClient);
      toast(`${recipe.code} is now base ${base.code ?? ''}`.trim());
      onPromoted(base);
    },
  });

  const newCode = owner && theirBases.isSuccess ? `${owner}-B${nextNumber}` : null;

  return (
    <Modal
      title={`Make ${recipe.code} a base`}
      description={`It becomes ${newCode ?? 'the participant’s next base'}, and new variations go under that. ${recipe.code} keeps its code.`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => promote.mutate()} disabled={promote.isPending || !recipe.code || !from.data}>
            {promote.isPending && <span className="spinner" />}
            {newCode ? `Make it ${newCode}` : 'Make it a base'}
          </button>
        </>
      }
    >
      {from.isPending ? (
        <Loading />
      ) : from.isError ? (
        <LoadError error={from.error} onRetry={() => from.refetch()} />
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            promote.mutate();
          }}
        >
          <Problem text={promote.isError ? errorMessage(promote.error) : null} />

          <div className="note">
            <div className="note-label">
              {from.data.code} + {additions.length ? describeRows(additions) : 'nothing added'}
            </div>
            {recipe.outcomeNote ?? recipeTitle(recipe)}
          </div>

          {preview.length > 0 && (
            <div className="field">
              <span className="label">New base starts from</span>
              <table className="table formulation">
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={`${row.rawName}-${i}`}>
                      <td>{row.rawName}</td>
                      <td className="num">{formatQuantity(row)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num">{formatAmount(preview.reduce((sum, row) => sum + ((row.unit?.trim() || '%') === '%' ? row.amount : 0), 0))}%</td>
                  </tr>
                </tfoot>
              </table>
              <span className="hint">{from.data.code}’s formulation with the additions on top. The server records the final figures.</span>
            </div>
          )}

          <div className="field-row">
            <div className="field">
              <label className="label" htmlFor="promote-name">
                Name <span className="muted">(optional)</span>
              </label>
              <input id="promote-name" className="input" placeholder={recipeTitle(recipe)} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="promote-participant">
                Participant
              </label>
              <select id="promote-participant" className="select" value={participantCode || from.data.participantCode || ''} onChange={(e) => setParticipantCode(e.target.value)}>
                {from.data.participantCode && !participants.some((u) => u.participantCode === from.data.participantCode) && (
                  <option value={from.data.participantCode}>{from.data.participantCode}</option>
                )}
                {participants.map((u) => (
                  <option key={u.id} value={u.participantCode!}>
                    {u.participantCode} · {u.displayName ?? `@${u.username}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="promote-desc">
              Notes <span className="muted">(optional)</span>
            </label>
            <textarea id="promote-desc" className="textarea" placeholder="Why it’s worth building on" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </form>
      )}
    </Modal>
  );
}
