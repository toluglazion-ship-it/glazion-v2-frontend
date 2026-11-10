// The client's UMF calculation, carried over from the GlazionStudio app. The arithmetic here is
// the agreed logic: do not change it without the client's say-so.
//
// One change from the original, agreed with the client: it used to reduce each material by its
// LOI before reading the oxides. The analyses in materials.json already allow for LOI (oxides +
// LOI come to about 100), so that took it off twice. The oxide percentages are now used as given.
import { OXIDE_INDEX } from './oxides';
import type { CalcOptions, ChemistryResult, Material, OxideSymbol, OxideVector, Recipe } from './types';

const ZERO = 1e-12;

function sum(obj: Record<string, number>): number {
  return Object.values(obj).reduce((a, b) => a + b, 0);
}

export function computeChemistry(recipe: Recipe, materials: Material[], opts: CalcOptions): ChemistryResult {
  const matIndex = Object.fromEntries(materials.map((m) => [m.id, m]));
  const warnings: string[] = [];
  const moles: OxideVector = {};

  // 1) Per line: oxide masses, then moles.
  recipe.lines.forEach((line) => {
    const m = matIndex[line.materialId];
    if (!m) return;
    const oa = m.oxideAnalysis || {};
    const totalPct = Object.values(oa).reduce((a, b) => a + b, 0);
    if (totalPct > 100 + 1e-6) warnings.push(`Material ${m.name} oxide sum > 100%`);
    for (const [sym, pct] of Object.entries(oa)) {
      const ox = OXIDE_INDEX[sym];
      if (!ox) {
        warnings.push(`Unknown oxide ${sym} in material ${m.name}`);
        continue;
      }
      const mass = line.partsPct * (pct / 100); // grams per 100 g batch
      const mol = mass / ox.mw;
      moles[ox.symbol] = (moles[ox.symbol] || 0) + mol;
    }
  });

  // 2) Mole % and analysis % (fired glass).
  const totalMoles = sum(moles as Record<string, number>);
  const molePct: OxideVector = {};
  if (totalMoles > ZERO) {
    for (const [k, n] of Object.entries(moles)) {
      molePct[k as OxideSymbol] = (100 * n) / totalMoles;
    }
  }

  const oxideMasses: Record<string, number> = {};
  for (const [k, n] of Object.entries(moles)) {
    oxideMasses[k] = n * OXIDE_INDEX[k]!.mw;
  }
  const totalOxMass = sum(oxideMasses);
  const analysisPct: OxideVector = {};
  if (totalOxMass > ZERO) {
    for (const [k, g] of Object.entries(oxideMasses)) {
      analysisPct[k as OxideSymbol] = (100 * g) / totalOxMass;
    }
  }

  // 3) UMF: the flux oxides are scaled to add up to 1.
  const fluxSum = opts.fluxSet.map((s) => moles[s] || 0).reduce((a, b) => a + b, 0);
  const umf: OxideVector = {};
  if (fluxSum <= ZERO) {
    warnings.push('UMF undefined: flux sum is zero. Add flux oxides.');
  } else {
    for (const [k, n] of Object.entries(moles)) {
      umf[k as OxideSymbol] = n / fluxSum;
    }
  }

  // 4) Ratios.
  const si = umf.SiO2 || 0;
  const al = umf.Al2O3 || 0;
  const k = (umf.K2O || 0) + (umf.Na2O || 0) + (umf.Li2O || 0);
  const ro = (umf.CaO || 0) + (umf.MgO || 0) + (umf.BaO || 0) + (umf.SrO || 0) + (umf.ZnO || 0);
  const bPct = analysisPct.B2O3 || 0;

  // 5) Estimated coefficient of thermal expansion.
  const cte = estimateCTE(umf);

  return {
    moles,
    molePct,
    analysisPct,
    umf,
    fluxSum,
    warnings,
    ratios: {
      si_al: si > ZERO && al > ZERO ? si / al : undefined,
      alkali_over_alkaline: ro > ZERO ? k / ro : undefined,
      b2o3_pct: bPct,
    },
    cte,
  };
}

function estimateCTE(umf: OxideVector): number {
  const coefficients: Partial<Record<OxideSymbol, number>> = {
    SiO2: 0.5,
    Al2O3: -2.0,
    B2O3: -0.8,
    Li2O: 35.0,
    Na2O: 40.0,
    K2O: 38.0,
    MgO: 5.0,
    CaO: 13.0,
    SrO: 11.0,
    BaO: 10.0,
    ZnO: 7.0,
    PbO: 11.0,
    TiO2: 8.0,
    P2O5: 5.0,
    ZrO2: 4.0,
  };

  let cte = 0;
  for (const [oxide, coef] of Object.entries(coefficients)) {
    cte += (umf[oxide as OxideSymbol] || 0) * coef;
  }

  return Math.max(0, cte);
}
