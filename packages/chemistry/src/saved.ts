// A recipe as the calculator keeps it, and the files it can be exported as.
import type { ChemistryResult } from './types';

export interface SavedRow {
  material: string;
  amount: string;
}

export interface SavedRecipe {
  id: string;
  name: string;
  cone: string;
  base: SavedRow[];
  colourants: SavedRow[];
  /** ISO timestamp of the last save. */
  updatedAt: string;
}

export type RecipeDraft = Omit<SavedRecipe, 'id' | 'updatedAt'>;

const filled = (rows: SavedRow[]) => rows.filter((row) => row.material && row.amount !== '');

/** True when two drafts would save the same thing; empty rows don't count as a difference. */
export function sameRecipe(a: RecipeDraft, b: RecipeDraft): boolean {
  const key = (r: RecipeDraft) => JSON.stringify([r.name.trim(), r.cone, filled(r.base), filled(r.colourants)]);
  return key(a) === key(b);
}

export function recipeFileName(name: string, extension: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'recipe'}.${extension}`;
}

const round = (value: number, places: number) => Number(value.toFixed(places));

function rounded(vector: Record<string, number | undefined>, places: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [oxide, value] of Object.entries(vector)) {
    if (typeof value === 'number' && value !== 0) out[oxide] = round(value, places);
  }
  return out;
}

/** The recipe and its analysis as a plain object, ready for JSON.stringify. */
export function recipeToJson(recipe: RecipeDraft, chem: ChemistryResult | null) {
  return {
    name: recipe.name.trim() || 'Untitled recipe',
    cone: recipe.cone,
    materials: [
      ...filled(recipe.base).map((row) => ({ material: row.material, amount: Number(row.amount), group: 'base' as const })),
      ...filled(recipe.colourants).map((row) => ({ material: row.material, amount: Number(row.amount), group: 'colourant' as const })),
    ],
    analysis: chem && {
      basis: 'UMF, flux oxides to 1',
      umf: rounded(chem.umf, 4),
      molePercent: rounded(chem.molePct, 3),
      analysisPercent: rounded(chem.analysisPct, 3),
      silicaToAlumina: chem.ratios.si_al === undefined ? null : round(chem.ratios.si_al, 3),
      cte: round(chem.cte, 2),
    },
  };
}

const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The same content as a spreadsheet-friendly CSV: materials first, then one row per oxide. */
export function recipeToCsv(recipe: RecipeDraft, chem: ChemistryResult | null): string {
  const data = recipeToJson(recipe, chem);
  const lines: (string | number)[][] = [
    ['Recipe', data.name],
    ['Cone', data.cone],
    [],
    ['Material', 'Amount', 'Group'],
    ...data.materials.map((m) => [m.material, m.amount, m.group]),
  ];

  if (data.analysis) {
    const { umf, molePercent, analysisPercent, silicaToAlumina, cte } = data.analysis;
    lines.push([], ['Oxide', 'UMF', 'Mole %', 'Analysis %']);
    const oxides = Object.keys(molePercent).sort((a, b) => molePercent[b] - molePercent[a]);
    for (const oxide of oxides) lines.push([oxide, umf[oxide] ?? '', molePercent[oxide], analysisPercent[oxide] ?? '']);
    lines.push([], ['SiO2 : Al2O3', silicaToAlumina ?? ''], ['CTE (x10^-7/C)', cte]);
  }

  return lines.map((line) => line.map(csvCell).join(',')).join('\n') + '\n';
}

/** A short plain-text version, for sharing from a phone. */
export function recipeToText(recipe: RecipeDraft, chem: ChemistryResult | null): string {
  const data = recipeToJson(recipe, chem);
  const lines = [`${data.name} (cone ${data.cone})`, '', ...data.materials.map((m) => `${m.material}  ${m.amount}${m.group === 'colourant' ? '  (colourant)' : ''}`)];
  if (data.analysis) {
    lines.push('', 'UMF', ...Object.entries(data.analysis.umf).map(([oxide, value]) => `${oxide}  ${value.toFixed(2)}`));
    if (data.analysis.silicaToAlumina !== null) lines.push('', `SiO2 : Al2O3  ${data.analysis.silicaToAlumina.toFixed(2)}`);
  }
  return lines.join('\n');
}
