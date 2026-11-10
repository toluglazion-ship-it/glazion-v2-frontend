// Everything between "what the user typed" and computeChemistry: looking materials up, scaling
// the recipe to 100, and the suggestions shown next to a result. Carried over from the
// GlazionStudio calculator page so the web and mobile apps behave the same way.
import { computeChemistry } from './chemistry';
import type { ChemistryResult, GlazeLimit, Material, OxideSymbol, OxideVector, RawMaterial, RecipeLine } from './types';

export const DEFAULT_FLUX_SET: OxideSymbol[] = ['K2O', 'Na2O', 'Li2O', 'CaO', 'MgO', 'BaO', 'SrO', 'ZnO'];

export interface RecipeRow {
  material: string;
  amount: number | string;
}

const norm = (s: string) => s.trim().toLowerCase();

export function toNumber(value: number | string | undefined): number {
  return typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').trim());
}

export function normaliseMaterials(raw: RawMaterial[]): Material[] {
  return raw
    .map((m) => {
      const name = String(m.name || '').trim();
      return {
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name,
        type: 'raw' as const,
        loi_pct: Number(m.loi || 0),
        oxideAnalysis: m.oxideAnalysis || {},
      };
    })
    .filter((m) => m.name);
}

export function findMaterial(materials: Material[], name: string): Material | undefined {
  const key = norm(name);
  return materials.find((m) => norm(m.name) === key);
}

export function totalOf(rows: RecipeRow[]): number {
  return rows.reduce((total, row) => {
    const n = toNumber(row.amount);
    return total + (Number.isFinite(n) ? n : 0);
  }, 0);
}

/** Scales the rows so they add up to 100, keeping two decimals, as "Retotal to 100" does. */
export function retotal<T extends RecipeRow>(rows: T[], total: number): T[] {
  if (total <= 0) return rows;
  return rows.map((row) => {
    const n = toNumber(row.amount);
    if (!Number.isFinite(n) || n <= 0) return row;
    return { ...row, amount: String(parseFloat(((n / total) * 100).toFixed(2))) };
  });
}

export interface RecipeCalculation {
  chem: ChemistryResult;
  lines: RecipeLine[];
}

/**
 * Runs the calculation for a recipe as typed. Rows without a known material or a numeric amount
 * are left out, and the rest are scaled to 100 before the chemistry is worked out.
 */
export function calculateRecipe(rows: RecipeRow[], materials: Material[], cone?: string): RecipeCalculation | null {
  if (materials.length === 0) return null;

  const lines: RecipeLine[] = [];
  for (const row of rows) {
    if (!row.material || row.amount === '' || row.amount == null) continue;
    const material = findMaterial(materials, row.material);
    if (!material) continue;
    const n = toNumber(row.amount);
    if (!Number.isFinite(n)) continue;
    lines.push({ materialId: material.id, partsPct: n });
  }
  if (lines.length === 0) return null;

  const total = lines.reduce((acc, line) => acc + line.partsPct, 0);
  if (total <= 0) return null;
  for (const line of lines) line.partsPct = (line.partsPct / total) * 100;

  const chem = computeChemistry(
    { id: 'temp-recipe', name: 'User Recipe', category: 'glaze', cone, lines },
    materials,
    { fluxSet: DEFAULT_FLUX_SET, unityMode: 'flux_to_1' },
  );
  return { chem, lines };
}

export interface OptimisationSuggestion {
  oxide: string;
  current: number;
  /** The target range, e.g. "0.30 - 0.70". */
  target: string;
  direction: 'increase' | 'decrease';
  /** Up to three materials richest in the oxide. */
  materials: { name: string; oxideContent: number; inRecipe: boolean }[];
}

/** For each oxide outside its target range at this cone, names the materials that move it most. */
export function suggestOptimisations(umf: OxideVector, limits: GlazeLimit[], materials: Material[], lines: RecipeLine[]): OptimisationSuggestion[] {
  const result: OptimisationSuggestion[] = [];

  for (const limit of limits) {
    const oxide = limit.oxide;
    const value = (umf as Record<string, number | undefined>)[oxide] || 0;
    const { minUmf: min, maxUmf: max } = limit;

    let direction: OptimisationSuggestion['direction'] | null = null;
    if (min !== null && value < min) direction = 'increase';
    else if (max !== null && value > max) direction = 'decrease';
    if (!direction) continue;

    const rich = materials
      .filter((m) => (m.oxideAnalysis[oxide] || 0) > 5)
      .map((m) => ({
        name: m.name,
        oxideContent: m.oxideAnalysis[oxide] || 0,
        inRecipe: lines.some((line) => line.materialId === m.id),
      }))
      .sort((a, b) => b.oxideContent - a.oxideContent)
      .slice(0, 3);

    if (rich.length > 0) {
      result.push({ oxide, current: value, target: `${min.toFixed(2)} - ${max.toFixed(2)}`, direction, materials: rich });
    }
  }

  return result;
}

/** How the UMF is laid out on screen. */
export const UMF_GROUPS = {
  r2o: ['Na2O', 'K2O', 'Li2O'],
  ro: ['CaO', 'MgO', 'BaO', 'SrO', 'ZnO', 'PbO', 'FeO', 'MnO', 'CoO', 'NiO', 'CuO'],
  r2o3: ['Al2O3', 'Fe2O3', 'Cr2O3', 'V2O5', 'La2O3', 'Y2O3'],
  ro2: ['SiO2', 'B2O3', 'ZrO2', 'TiO2', 'SnO2', 'P2O5', 'CeO2'],
} as const;

/** The oxides of a group that are present, largest first. */
export function presentOxides(umf: OxideVector, group: readonly string[]): { oxide: string; value: number }[] {
  const values = umf as Record<string, number | undefined>;
  return group
    .map((oxide) => ({ oxide, value: values[oxide] ?? 0 }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
}

export function clayBodyNote(cte: number): string {
  if (cte < 60) return 'Low CTE: Fits tight, may craze on high-expansion bodies';
  if (cte < 70) return 'Medium CTE: Good fit for most mid-range clay bodies';
  return 'High CTE: May shiver on low-expansion bodies';
}
