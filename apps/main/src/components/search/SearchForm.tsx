import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { searchApi, type SearchProblem } from '@glazion/api-client/main';
import { amountOf, totalOf, type SavedRow } from '@glazion/api-client/recipes';
import { CLAY_BODIES, CONE_DATA, coneToNumber, type Atmosphere, type RecipeImageSearchRequest, type Umf } from '@glazion/types';
import { Icon } from '@glazion/ui';
import { COLOURS, OTHER_OXIDES, OXIDE_GROUPS, OxideName, SURFACES, TILE_VARIANTS, humanise } from '../../lib/glaze';
import { drafts, lastFiring, type Firing } from '../../lib/drafts';
import { lookUpMaterial, lookingUp, lookupsDone } from '../recipe/MaterialPicker';
import { useIsAdmin } from '../../lib/access';
import RecipeRows, { fromDraftRow, newRow, toDraftRow, toRows, type DraftRow, type Row, type RowFlag } from '../recipe/RecipeRows';

export type SearchMode = 'recipe' | 'umf';

/** Asked for from a search with no close match: search again with this part of the form cleared. */
export interface Widen {
  what: 'firing' | 'filters';
  /** A new one each time, so asking twice works. */
  at: number;
}

export interface SearchStart {
  mode?: SearchMode;
  /** A UMF to start from. */
  umf?: Umf;
  /** The calculator's recipe, base then colorants, so the search keeps its stains as well as its oxides. */
  rows?: SavedRow[];
  cone?: string;
}

interface Props {
  start: SearchStart;
  pending: boolean;
  /** Why the backend turned the last recipe down, if it did. */
  rejection: SearchProblem | null;
  /** label says in a few words what was searched for, for the list of recent searches. */
  onSubmit: (request: RecipeImageSearchRequest, label: string) => void;
  widen?: Widen | null;
}

const FLUXES = OXIDE_GROUPS[0].oxides;

const ATMOSPHERES = ['', 'oxidation', 'reduction', 'neutral'] as const;

/** The form as it was left, kept for this tab. */
interface SearchDraft extends Firing {
  mode: SearchMode;
  rows: DraftRow[];
  /** Metallic oxides and stains, in % of the base (missing from drafts kept before they had their own section). */
  colorants?: DraftRow[];
  umf: Record<string, string>;
  strict: boolean;
  variants: string[];
  surfaces: string[];
  colours: string[];
  clayBodies: string[];
}

/** A stored cone or atmosphere, if it's still one the form offers. */
const knownCone = (cone: string | undefined) => (CONE_DATA.some((data) => data.cone === cone) ? cone! : '');
const knownAtmosphere = (value: string | undefined): Atmosphere | '' => ATMOSPHERES.find((a) => a === value) ?? '';

/** Leach's 4321 clear, a well-known cone 10 glaze, as an example recipe. */
const EXAMPLE_RECIPE: [string, string][] = [
  ['Custer Feldspar', '40'],
  ['Silica', '30'],
  ['Whiting', '20'],
  ['EPK', '10'],
];

const EXAMPLE_UMF: Umf = { Na2O: 0.18, K2O: 0.12, CaO: 0.52, MgO: 0.18, Al2O3: 0.35, B2O3: 0.2, SiO2: 3.2 };

const NUMBER = /^\d*\.?\d*$/;

const toNumber = (value: string | undefined) => {
  const n = Number((value ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Drops zeros and anything that isn't a number, so only real amounts are sent. */
function positive(values: Umf): Umf {
  const out: Umf = {};
  for (const [oxide, value] of Object.entries(values)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[oxide] = value;
  }
  return out;
}

/** SiO2 -> SiO₂, for plain-text labels. */
const subscript = (oxide: string) => oxide.replace(/\d/g, (digit) => '₀₁₂₃₄₅₆₇₈₉'[Number(digit)]);

const asText = (values: Umf) => Object.fromEntries(Object.entries(positive(values)).map(([oxide, value]) => [oxide, String(Number(value!.toFixed(3)))]));

/** What's wrong with a row that has something in it, if anything. */
function checkRow(row: Row): RowFlag | null {
  const name = row.material.trim();
  if (!row.picked) return { key: row.key, field: 'material', message: name ? `Choose “${name}” from the materials list.` : 'Pick a material from the list for this amount.' };
  if (amountOf(row.amount) <= 0) return { key: row.key, field: 'amount', message: `Give “${name}” an amount.` };
  return null;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Chips({ label, options, selected, onChange }: { label: string; options: { key: string; label: string }[]; selected: string[]; onChange: (next: string[]) => void }) {
  return (
    <fieldset className="chips">
      <legend className="label">{label}</legend>
      <div className="chips-row">
        {options.map((option) => {
          const on = selected.includes(option.key);
          return (
            <button key={option.key} type="button" className={`chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onChange(toggle(selected, option.key))}>
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function SearchForm({ start, pending, rejection, onSubmit, widen = null }: Props) {
  // The form as it was left in this tab, or else the firing of the last search. A recipe or UMF and a cone
  // handed over from the calculator take the place of what was there.
  const [restored] = useState(() => drafts.read<SearchDraft>('search'));
  const [firing] = useState<Firing | null>(() => restored ?? lastFiring.read());
  // Searching by UMF is for admins: everyone else searches with a recipe's materials (the API refuses it too).
  const admin = useIsAdmin();
  const [chosenMode, setMode] = useState<SearchMode>(start.rows?.length ? 'recipe' : start.umf ? 'umf' : (start.mode ?? restored?.mode ?? 'recipe'));
  const mode: SearchMode = admin ? chosenMode : 'recipe';
  const [rows, setRows] = useState<Row[]>(() =>
    start.rows?.length ? toRows(start.rows) : restored?.rows.length ? restored.rows.map(fromDraftRow) : [newRow(), newRow(), newRow()],
  );
  // Colorants on their own, as on Glazy: % on top of the base, sent with it as parts of the whole (meeting 2026-10-29).
  const [colorants, setColorants] = useState<Row[]>(() => (start.rows?.length ? [] : (restored?.colorants ?? []).map(fromDraftRow)));
  const [umf, setUmf] = useState<Record<string, string>>(() => (start.umf ? asText(start.umf) : (restored?.umf ?? {})));
  const [coneFrom, setConeFrom] = useState(start.cone ?? knownCone(firing?.coneFrom));
  const [coneTo, setConeTo] = useState(start.cone ?? knownCone(firing?.coneTo));
  const [atmosphere, setAtmosphere] = useState<Atmosphere | ''>(knownAtmosphere(firing?.atmosphere));
  /** Leave out tiles fired differently, rather than only ranking them lower. */
  const [strict, setStrict] = useState(restored?.strict ?? false);
  // When an admin has made search strict about firing (the default), it always is, so there is nothing to choose.
  const settings = useQuery({ queryKey: ['search-settings'], queryFn: searchApi.settings, staleTime: 5 * 60_000 });
  const alwaysStrict = settings.data?.strictFiring !== false;
  const [variants, setVariants] = useState<string[]>(restored?.variants ?? []);
  const [surfaces, setSurfaces] = useState<string[]>(restored?.surfaces ?? []);
  const [colours, setColours] = useState<string[]>(restored?.colours ?? []);
  const [clayBodies, setClayBodies] = useState<string[]>(restored?.clayBodies ?? []);
  const [problem, setProblem] = useState('');
  /** The first row the last check stopped at; cleared once that row is changed. */
  const [flag, setFlag] = useState<RowFlag | null>(null);
  /** The rows of the last recipe sent, in order, so the backend's positions point at the right row. */
  const sent = useRef<{ key: number; material: string }[]>([]);
  /** Find tiles was pressed while a typed name was still being looked up. */
  const waiting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const queryClient = useQueryClient();
  const [filling, setFilling] = useState(false);
  /** Counts searches asked for by `widen`; each runs once the cleared fields are on screen. */
  const [resubmit, setResubmit] = useState(0);

  useEffect(() => {
    if (!widen) return;
    if (widen.what === 'firing') {
      setConeFrom('');
      setConeTo('');
      setAtmosphere('');
      setStrict(false);
    } else {
      setClayBodies([]);
      setVariants([]);
      setSurfaces([]);
      setColours([]);
    }
    setResubmit((n) => n + 1);
  }, [widen]);

  useEffect(() => {
    if (resubmit > 0) formRef.current?.requestSubmit();
  }, [resubmit]);

  useEffect(() => {
    const draft: SearchDraft = { mode, rows: rows.map(toDraftRow), colorants: colorants.map(toDraftRow), umf, coneFrom, coneTo, atmosphere, strict, variants, surfaces, colours, clayBodies };
    drafts.write('search', draft);
  }, [mode, rows, colorants, umf, coneFrom, coneTo, atmosphere, strict, variants, surfaces, colours, clayBodies]);

  const total = totalOf(rows);
  const fluxTotal = FLUXES.reduce((sum, oxide) => sum + toNumber(umf[oxide]), 0);
  const silica = toNumber(umf.SiO2);
  const alumina = toNumber(umf.Al2O3);
  const offUnity = fluxTotal > 0 && Math.abs(fluxTotal - 1) > 0.02;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending || waiting.current) return;
    if (mode === 'recipe' && lookingUp()) {
      // A name typed in full and left a moment ago: check the form once it has been picked.
      waiting.current = true;
      const form = e.currentTarget as HTMLFormElement;
      void lookupsDone().then(() =>
        requestAnimationFrame(() => {
          waiting.current = false;
          form.requestSubmit();
        }),
      );
      return;
    }

    let query: RecipeImageSearchRequest['query'];
    let label: string;
    if (mode === 'recipe') {
      // The backend works out the chemistry from the materials' ids; nothing is calculated here.
      const filled = (row: Row) => row.material.trim() !== '' || row.amount !== '';
      const used = rows.filter(filled);
      const added = colorants.filter(filled);
      const wrong = [...used, ...added].map(checkRow).find(Boolean);
      if (wrong) {
        setProblem('');
        return setFlag(wrong);
      }
      setFlag(null);
      if (used.length === 0) return setProblem('Pick at least one base material from the list and give it an amount.');
      sent.current = [...used, ...added].map(({ key, material }) => ({ key, material }));
      const names = [...used, ...added].map((row) => row.material.trim());
      label = names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3} more` : names.join(', ');
      // A colorant is % of the base: on a base of 50 parts, 2% is 1 part of the whole.
      const baseParts = used.reduce((sum, row) => sum + amountOf(row.amount), 0);
      const material = (row: Row, amount: number) => ({
        ...(row.materialId ? { materialId: row.materialId } : { rawName: row.material }),
        amount,
        unit: '%' as const,
      });
      query = {
        type: 'raw_recipe',
        materials: [
          ...used.map((row) => material(row, amountOf(row.amount))),
          ...added.map((row) => material(row, Number(((amountOf(row.amount) * baseParts) / 100).toFixed(4)))),
        ],
      };
    } else {
      const values = positive(Object.fromEntries(Object.entries(umf).map(([oxide, raw]) => [oxide, toNumber(raw)])));
      setFlag(null);
      if (Object.keys(values).length === 0) return setProblem('Enter at least one oxide amount.');
      query = { type: 'umf', umf: values };
      label = `UMF · ${['SiO2', 'Al2O3', 'B2O3'].filter((oxide) => values[oxide]).map((oxide) => `${subscript(oxide)} ${values[oxide]}`).join(' · ') || `${Object.keys(values).length} oxides`}`;
    }
    setProblem('');

    lastFiring.write({ coneFrom, coneTo, atmosphere });

    // Accept the range in either order.
    const cones = [coneFrom, coneTo].filter(Boolean).map(coneToNumber).sort((a, b) => a - b);
    const filters = {
      ...(clayBodies.length > 0 && { clayBodies }),
      ...(variants.length > 0 && { tileVariantKeys: variants }),
      ...(surfaces.length > 0 && { surface: surfaces }),
      ...(colours.length > 0 && { colourFamily: colours }),
    };

    onSubmit(
      {
        query,
        firing: {
          coneMin: cones[0] ?? null,
          coneMax: cones[cones.length - 1] ?? null,
          atmosphere: atmosphere || null,
          ...(strict && !alwaysStrict && (cones.length > 0 || atmosphere) && { strict: true }),
        },
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        topK: 12,
        // Without it results come back without their lab codes.
        includeRecipeMetadata: true,
      },
      label,
    );
  }

  const oxideInput = (oxide: string) => (
    <label key={oxide} className="oxide">
      <span>
        <OxideName oxide={oxide} />
      </span>
      <input
        className="input"
        inputMode="decimal"
        placeholder="0"
        value={umf[oxide] ?? ''}
        onChange={(e) => {
          // Numbers only, as in the amount fields: anything else used to count as 0 without a word.
          const value = e.target.value.replace(',', '.');
          if (NUMBER.test(value)) setUmf((prev) => ({ ...prev, [oxide]: value }));
        }}
      />
    </label>
  );

  const coneOptions = CONE_DATA.map((data) => (
    <option key={data.cone} value={data.cone}>
      {data.cone} ({data.celsius} °C)
    </option>
  ));

  function changeRows(next: Row[]) {
    // Rows that weren't touched keep their object, so a changed flagged row is easy to spot.
    if (flag && next.find((row) => row.key === flag.key) !== rows.find((row) => row.key === flag.key)) setFlag(null);
    setRows(next);
  }

  function changeColorants(next: Row[]) {
    if (flag && next.find((row) => row.key === flag.key) !== colorants.find((row) => row.key === flag.key)) setFlag(null);
    setColorants(next);
  }

  const hasFiring = !!(coneFrom || coneTo || atmosphere);
  // The examples only fill an empty form, so they never replace what's been typed.
  const rowsEmpty = rows.every((row) => !row.material.trim() && !row.amount);
  const umfEmpty = Object.values(umf).every((value) => !value.trim());

  async function fillExampleRecipe() {
    setFilling(true);
    // Each material picked from the list, as if chosen by hand; one that can't be found is left typed in.
    const filled = await Promise.all(
      EXAMPLE_RECIPE.map(async ([name, amount]) => {
        const material = await lookUpMaterial(queryClient, name).catch(() => undefined);
        return { ...newRow(), material: material?.name ?? name, materialId: material?.id ?? null, picked: !!material, amount };
      }),
    );
    setRows(filled);
    setFilling(false);
  }

  /** Divides every oxide by the flux total, so the fluxes add up to 1 as a unity formula should. */
  function scaleToUnity() {
    setUmf((prev) => asText(Object.fromEntries(Object.entries(prev).map(([oxide, raw]) => [oxide, toNumber(raw) / fluxTotal]))));
  }
  const filterCount = clayBodies.length + variants.length + surfaces.length + colours.length;

  // A recipe the backend turned down: what each unrecognised row may have meant, under that row.
  const notes = useMemo(() => {
    const out: Record<number, ReactNode> = {};
    if (rejection?.code !== 'materials_unresolved') return out;
    for (const r of rejection.resolutions) {
      // The API counts rows from 1.
      const row = sent.current[r.position - 1];
      if (row === undefined || r.status === 'resolved') continue;
      const key = row.key;
      // Gone once the row has been changed.
      if ([...rows, ...colorants].find((current) => current.key === key)?.material !== row.material) continue;
      out[key] = (
        <>
          {r.status === 'invalid_amount' ? `Give “${r.rawName}” an amount.` : `“${r.rawName}” isn’t in the materials list.`}
          {r.suggestions.length > 0 && (
            <span className="chips-row">
              Did you mean{' '}
              {r.suggestions.map((sug) => (
                <button
                  key={sug.materialId ?? sug.name}
                  type="button"
                  className="chip"
                  onClick={() => {
                    const pick = (prev: Row[]) => prev.map((row) => (row.key === key ? { ...row, material: sug.name, materialId: sug.materialId, picked: true } : row));
                    setRows(pick);
                    setColorants(pick);
                  }}
                >
                  {sug.name}
                </button>
              ))}
            </span>
          )}
        </>
      );
    }
    return out;
  }, [rejection, rows, colorants]);

  const turnedDown =
    rejection?.code === 'zero_flux'
      ? mode === 'umf'
        ? 'This UMF has no flux, so it can’t be compared. Enter at least one of the fluxes.'
        : 'This recipe has no flux, so its chemistry can’t be compared. Add a flux such as a feldspar, whiting or a frit.'
      : rejection?.code === 'materials_unresolved'
        ? 'Some materials weren’t recognised. Pick a suggestion under the row, or choose the material again from the list.'
        : '';

  return (
    <form className="card search-form" onSubmit={handleSubmit} noValidate ref={formRef}>
      {admin && (
        <div className="segmented" role="tablist" aria-label="What to search with">
          <button type="button" role="tab" aria-selected={mode === 'recipe'} className={mode === 'recipe' ? 'is-active' : ''} onClick={() => setMode('recipe')}>
            Recipe
          </button>
          <button type="button" role="tab" aria-selected={mode === 'umf'} className={mode === 'umf' ? 'is-active' : ''} onClick={() => setMode('umf')}>
            UMF
          </button>
        </div>
      )}

      {mode === 'recipe' ? (
        <section className="form-section">
          <div className="rows-head">
            <span className="label">Base materials</span>
            <span className="hint">Parts by weight · total {Number(total.toFixed(2))}</span>
          </div>
          <RecipeRows rows={rows} onChange={changeRows} notes={notes} flag={mode === 'recipe' ? flag : null} addLabel="Add material" amountLabel="Parts" keepOne />
          <div className="rows-head">
            <span className="label">Colorants</span>
            <span className="hint">Metallic oxides and stains · % on top of the base</span>
          </div>
          <RecipeRows rows={colorants} onChange={changeColorants} notes={notes} flag={mode === 'recipe' ? flag : null} addLabel="Add colorant" amountLabel="% of base" />
          {rowsEmpty && (
            <button type="button" className="btn btn-ghost btn-sm example-btn" onClick={fillExampleRecipe} disabled={filling} aria-busy={filling}>
              {filling && <span className="spinner" />}
              Fill in an example: Leach 4321 clear
            </button>
          )}
          {admin && (
            <p className="hint">
              Want the full breakdown first? Open the <Link to="/umf">UMF calculator</Link>.
            </p>
          )}
        </section>
      ) : (
        <section className="form-section">
          {OXIDE_GROUPS.map((group) => (
            <div key={group.title} className="oxide-group">
              <div className="rows-head">
                <span className="label">{group.title}</span>
                {group.hint && <span className="hint">{group.hint}</span>}
              </div>
              <div className="oxide-grid">{group.oxides.map(oxideInput)}</div>
            </div>
          ))}

          <details className="more">
            <summary>
              Colorants (metallic oxides) and other oxides
              <Icon name="chevron-down" size={16} />
            </summary>
            <div className="oxide-grid">{OTHER_OXIDES.map(oxideInput)}</div>
          </details>

          <div className="readouts">
            <div>
              <span className="hint">Flux total</span>
              <strong className={offUnity ? 'is-off' : ''}>{fluxTotal.toFixed(2)}</strong>
            </div>
            <div>
              <span className="hint">Silica : alumina</span>
              <strong>{silica > 0 && alumina > 0 ? `${(silica / alumina).toFixed(1)} : 1` : '—'}</strong>
            </div>
            {offUnity ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={scaleToUnity}>
                Scale fluxes to 1
              </button>
            ) : (
              umfEmpty && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUmf(asText(EXAMPLE_UMF))}>
                  Fill in an example
                </button>
              )
            )}
          </div>
          {offUnity && (
            <p className="hint">
              The fluxes don’t add up to 1, so this may not be a unity formula. Scale it so they do, search with it as it is, or work it out
              from the recipe in the <Link to="/umf">calculator</Link>.
            </p>
          )}
        </section>
      )}

      <section className="form-section">
        <span className="label">Firing</span>
        <div className="field-row">
          <label className="field">
            <span className="hint">Cone from</span>
            <select className="select" value={coneFrom} onChange={(e) => setConeFrom(e.target.value)}>
              <option value="">Any</option>
              {coneOptions}
            </select>
          </label>
          <label className="field">
            <span className="hint">Cone to</span>
            <select className="select" value={coneTo} onChange={(e) => setConeTo(e.target.value)}>
              <option value="">Any</option>
              {coneOptions}
            </select>
          </label>
        </div>
        <div className="field">
          <span className="hint">Atmosphere</span>
          <div className="segmented segmented-fill" role="radiogroup" aria-label="Atmosphere">
            {ATMOSPHERES.map((value) => (
              <button key={value || 'any'} type="button" role="radio" aria-checked={atmosphere === value} className={atmosphere === value ? 'is-active' : ''} onClick={() => setAtmosphere(value)}>
                {value ? humanise(value) : 'Any'}
              </button>
            ))}
          </div>
        </div>
        {alwaysStrict ? (
          hasFiring && <p className="hint">Only tiles fired within one cone of yours, in the same atmosphere, are shown.</p>
        ) : (
          <label className="check">
            <input type="checkbox" checked={strict} disabled={!hasFiring} onChange={(e) => setStrict(e.target.checked)} />
            <span>Only tiles fired this way</span>
            {/* Why it can't be ticked yet. */}
            {!hasFiring && <span className="hint">Choose a cone or atmosphere first.</span>}
          </label>
        )}
      </section>

      <details className="more">
        <summary>
          <span>
            <Icon name="sliders" size={16} /> Narrow the results{filterCount > 0 ? ` (${filterCount})` : ''}
          </span>
          <Icon name="chevron-down" size={16} />
        </summary>
        <div className="form-section">
          <Chips label="Clay body" options={CLAY_BODIES.map((c) => ({ key: c.value, label: c.label }))} selected={clayBodies} onChange={setClayBodies} />
          <Chips label="Body colour" options={TILE_VARIANTS} selected={variants} onChange={setVariants} />
          <Chips label="Surface" options={SURFACES.map((key) => ({ key, label: humanise(key) }))} selected={surfaces} onChange={setSurfaces} />
          <Chips label="Colour" options={COLOURS.map((key) => ({ key, label: humanise(key) }))} selected={colours} onChange={setColours} />
        </div>
      </details>

      {(problem || turnedDown) && (
        <div className="alert" role="alert">
          <Icon name="alert" size={18} />
          <span>{problem || turnedDown}</span>
        </div>
      )}

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? <span className="spinner" /> : <Icon name="search" size={18} />}
        Find tiles
      </button>
    </form>
  );
}
