import type { Colourant, ImageTrace, MatchCheckMaterial, OxideComparison } from '@glazion/types';
import { clayBodyLabel, toneClass } from '@glazion/ui';
import { firingText } from '../lib/library';
import { GROUP_LABEL, GROUP_ORDER, amountText, diffText, diffTone, isColorant, kindMeta, umfText } from '../lib/matchCheck';

/** A recipe's rows with each one's kind, colorants (metallic oxides and stains) marked so they stand out. */
export function MaterialsTable({ materials, empty = 'No material rows recorded.' }: { materials: MatchCheckMaterial[]; empty?: string }) {
  if (materials.length === 0) return <p className="muted">{empty}</p>;
  return (
    <table className="formulation trace-materials">
      <tbody>
        {materials.map((m, i) => {
          const kind = kindMeta(m.kind);
          return (
            <tr key={`${m.name}-${i}`} className={isColorant(m) ? 'is-colorant' : undefined}>
              <td>{m.name}</td>
              <td className="num">{amountText(m)}</td>
              <td className="trace-kind">{kind && <span className={isColorant(m) ? toneClass(kind.tone) : 'muted'}>{kind.label}</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * What was searched beside the tile's recipe, material by material, so an admin sees at once whether the photo's recipe
 * is the one asked for: a material only one side has, or a colorant in a different amount, is coloured.
 */
export function MaterialsCompare({ searched, tile }: { searched: MatchCheckMaterial[]; tile: MatchCheckMaterial[] }) {
  if (searched.length === 0 && tile.length === 0) return <p className="muted">No materials on either side.</p>;
  const key = (m: MatchCheckMaterial) => m.name.trim().toLowerCase();
  const names: string[] = [];
  for (const m of [...searched, ...tile]) if (!names.includes(key(m))) names.push(key(m));
  const rows = names.map((k) => {
    const s = searched.find((m) => key(m) === k) ?? null;
    const t = tile.find((m) => key(m) === k) ?? null;
    const either = (s ?? t)!;
    const difference = s?.amount != null && t?.amount != null ? t.amount - s.amount : null;
    const missing = !s || !t;
    const colorant = isColorant(either);
    const tone = missing ? (colorant ? 'bad' : 'warn') : difference !== null && Math.abs(difference) >= 0.0005 ? (colorant ? 'bad' : 'warn') : null;
    return { name: either.name, kind: either.kind, colorant, s, t, difference, tone, missing };
  });
  return (
    <table className="formulation umf-compare materials-compare">
      <thead>
        <tr>
          <th>Material</th>
          <th className="num">Searched</th>
          <th className="num">Tile’s recipe</th>
          <th className="num">Difference</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const kind = kindMeta(r.kind);
          return (
            <tr key={r.name} className={r.colorant ? 'is-colorant' : undefined}>
              <td>
                {r.name}
                {r.colorant && kind && <span className={`materials-kind ${toneClass(kind.tone)}`}>{kind.label}</span>}
              </td>
              <td className="num">{r.s ? amountText(r.s) : '—'}</td>
              <td className="num">{r.t ? amountText(r.t) : '—'}</td>
              <td className={`num${r.tone ? ` diff-${r.tone}` : ''}`}>{r.missing ? (r.s ? 'not in tile' : 'not searched') : r.difference === null ? '—' : diffAmount(r.difference)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function diffAmount(value: number): string {
  if (Math.abs(value) < 0.0005) return '0';
  return `${value > 0 ? '+' : '−'}${Number(Math.abs(value).toFixed(3))}`;
}

export function stainsText(mix: Colourant[] | null): string {
  if (mix === null) return 'Not recorded';
  if (mix.length === 0) return 'None';
  return mix.map((c) => `${Number(c.percentOfBase.toFixed(3))}% ${c.name ?? 'stain'}`).join(' + ');
}

/** Searched against tile, oxide by oxide (UMF), colorants first; the differences that matter are coloured. */
export function UmfComparison({ rows }: { rows: OxideComparison[] }) {
  if (rows.length === 0) return <p className="muted">No chemistry to compare.</p>;
  return (
    <table className="formulation umf-compare">
      <thead>
        <tr>
          <th>Oxide</th>
          <th className="num">Searched</th>
          <th className="num">Tile</th>
          <th className="num">Difference</th>
        </tr>
      </thead>
      {GROUP_ORDER.map((group) => {
        const inGroup = rows.filter((r) => r.group === group);
        if (inGroup.length === 0) return null;
        return (
          <tbody key={group}>
            <tr className="umf-group">
              <td colSpan={4}>{GROUP_LABEL[group]}</td>
            </tr>
            {inGroup.map((r) => {
              const tone = diffTone(r);
              return (
                <tr key={r.oxide}>
                  <td className="mono">{r.oxide}</td>
                  <td className="num">{umfText(r.searched)}</td>
                  <td className="num">{umfText(r.tile)}</td>
                  <td className={`num${tone ? ` diff-${tone}` : ''}`}>{diffText(r.difference)}</td>
                </tr>
              );
            })}
          </tbody>
        );
      })}
    </table>
  );
}

/** One UMF on its own (the photo library), in the same groups. */
export function UmfTable({ umf }: { umf: Record<string, number> }) {
  const rows: OxideComparison[] = Object.entries(umf)
    .filter(([, v]) => v !== 0)
    .map(([oxide, v]) => ({ oxide, group: groupOf(oxide), searched: null, tile: v, difference: null }));
  if (rows.length === 0) return <p className="muted">No oxides recorded.</p>;
  return (
    <table className="formulation umf-compare">
      {GROUP_ORDER.map((group) => {
        const inGroup = rows.filter((r) => r.group === group);
        if (inGroup.length === 0) return null;
        return (
          <tbody key={group}>
            <tr className="umf-group">
              <td colSpan={2}>{GROUP_LABEL[group]}</td>
            </tr>
            {inGroup.map((r) => (
              <tr key={r.oxide}>
                <td className="mono">{r.oxide}</td>
                <td className="num">{umfText(r.tile)}</td>
              </tr>
            ))}
          </tbody>
        );
      })}
    </table>
  );
}

// The same grouping the API uses for comparisons (Glazion-v2 MatchCheckService.GroupOf).
const FLUXES = ['Li2O', 'Na2O', 'K2O', 'MgO', 'CaO', 'SrO', 'BaO', 'ZnO', 'PbO'];
const COLOURING = ['Fe2O3', 'FeO', 'CoO', 'CuO', 'Cr2O3', 'MnO', 'NiO', 'V2O5', 'TiO2'];
function groupOf(oxide: string): OxideComparison['group'] {
  if (FLUXES.includes(oxide)) return 'flux';
  if (oxide === 'Al2O3' || oxide === 'B2O3') return 'stabiliser';
  if (oxide === 'SiO2') return 'glass';
  if (COLOURING.includes(oxide)) return 'colourant';
  if (oxide === 'ZrO2' || oxide === 'SnO2') return 'opacifier';
  return 'other';
}

/** Where the tile came from: its file, import or participant, recipe, and how its chemistry was got. */
export function TraceFacts({ trace }: { trace: ImageTrace }) {
  const recipe = trace.recipes[0];
  const from =
    trace.source === 'Import'
      ? (trace.batchName ? `Import: ${trace.batchName}` : 'Imported')
      : `Captured by ${trace.owner ? `${trace.owner.participantCode ? `${trace.owner.participantCode} · ` : ''}@${trace.owner.username}` : 'a participant'}`;
  return (
    <dl className="facts">
      <div>
        <dt>File</dt>
        <dd className="mono trace-file">{trace.fileName ?? trace.recordId ?? '—'}</dd>
      </div>
      <div>
        <dt>From</dt>
        <dd>{from}</dd>
      </div>
      {trace.madeByUsername && (
        <div>
          <dt>Made by</dt>
          <dd>@{trace.madeByUsername}</dd>
        </div>
      )}
      {trace.backUrl && (
        <div>
          <dt>Back of the tile</dt>
          <dd>
            <a className="trace-back" href={trace.backUrl} target="_blank" rel="noreferrer" title="The back, with its code: kept with the photo, not searched">
              <img src={trace.backUrl} alt="Back of the tile" loading="lazy" />
            </a>
          </dd>
        </div>
      )}
      <div>
        <dt>Recipe</dt>
        <dd className="facts-recipe">
          {recipe ? (
            <>
              {recipe.code && <span className="tile-code">{recipe.code}</span>}
              <span>{recipe.name}</span>
              {!recipe.verified && <span className="badge badge-warn">Not verified</span>}
            </>
          ) : (
            <span className="muted">None linked</span>
          )}
        </dd>
      </div>
      {recipe?.baseCode && (
        <div>
          <dt>Base</dt>
          <dd>
            <span className="tile-code">{recipe.baseCode}</span> {recipe.baseName}
          </dd>
        </div>
      )}
      <div>
        <dt>Clay body · firing</dt>
        <dd>
          {clayBodyLabel(trace.clayBody) ?? 'Not recorded'} · {firingText(trace.coneMin, trace.coneMax, trace.atmosphere)}
        </dd>
      </div>
      <div>
        <dt>Chemistry</dt>
        <dd>
          {!trace.chemistry ? (
            <span className="badge badge-bad">None</span>
          ) : trace.chemistry.supplied ? (
            <span className="badge badge-warn" title="Imported as UMF numbers, not worked out from materials">
              Supplied UMF
            </span>
          ) : (
            <span className="badge badge-ok">From its recipe</span>
          )}
          {trace.chemistry?.comparedAtSearch === false && <span className="badge badge-warn">Recalculated since</span>}
        </dd>
      </div>
      <div>
        <dt>Stains</dt>
        <dd>{stainsText(trace.colourants)}</dd>
      </div>
    </dl>
  );
}
