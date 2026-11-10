// A recipe as the calculator screens keep it, and the files it can be exported as. The numbers in
// an export are the backend's (POST /umf/calculate); nothing here works out any chemistry.
import type { UmfCalculateResponse, UmfCalculateRow } from '@glazion/types';

export interface SavedRow {
  /** The material's name, as shown. */
  material: string;
  /** The material's id in the backend list. Recipes saved before 14 Oct 2026 only have the name. */
  materialId?: string | null;
  amount: string;
}

export interface SavedRecipe {
  id: string;
  name: string;
  cone: string;
  base: SavedRow[];
  colourants: SavedRow[];
  /** The materials list the numbers came from when it was saved (opaque). */
  materialsVersion?: string | null;
  /** ISO timestamp of the last save. */
  updatedAt: string;
}

export type RecipeDraft = Omit<SavedRecipe, 'id' | 'updatedAt'>;

const filled = (rows: SavedRow[]) => rows.filter((row) => row.material && row.amount !== '');

/** True when two drafts would save the same thing; empty rows and the materials version don't count. */
export function sameRecipe(a: RecipeDraft, b: RecipeDraft): boolean {
  const key = (r: RecipeDraft) =>
    JSON.stringify([r.name.trim(), r.cone, filled(r.base).map(({ material, amount }) => [material, amount]), filled(r.colourants).map(({ material, amount }) => [material, amount])]);
  return key(a) === key(b);
}

/** A row for the calculator or search: the id when there is one, else the name (older recipes). */
export function calculatorRow(row: SavedRow): UmfCalculateRow {
  return row.materialId ? { materialId: row.materialId, amount: row.amount } : { material: row.material, amount: row.amount };
}

/** Typed amounts as numbers; anything that isn't one counts as 0. */
export function amountOf(value: string | number | undefined): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function totalOf(rows: { amount: string }[]): number {
  return rows.reduce((total, row) => total + amountOf(row.amount), 0);
}

/** Scales the rows so they add up to 100, keeping two decimals, as "Retotal to 100" does. */
export function retotal<T extends { amount: string }>(rows: T[], total: number): T[] {
  if (total <= 0) return rows;
  return rows.map((row) => {
    const n = amountOf(row.amount);
    if (n <= 0) return row;
    return { ...row, amount: String(parseFloat(((n / total) * 100).toFixed(2))) };
  });
}

export function recipeFileName(name: string, extension: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'recipe'}.${extension}`;
}

const round = (value: number, places: number) => Number(value.toFixed(places));

function rounded(vector: Record<string, number | null | undefined> | null | undefined, places: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [oxide, value] of Object.entries(vector ?? {})) {
    if (typeof value === 'number' && value !== 0) out[oxide] = round(value, places);
  }
  return out;
}

/** The recipe and the backend's analysis of it as a plain object, ready for JSON.stringify. */
export function recipeToJson(recipe: RecipeDraft, calc: UmfCalculateResponse | null) {
  const result = calc?.result ?? null;
  return {
    name: recipe.name.trim() || 'Untitled recipe',
    cone: recipe.cone,
    materials: [
      ...filled(recipe.base).map((row) => ({ material: row.material, materialId: row.materialId ?? null, amount: amountOf(row.amount), group: 'base' as const })),
      ...filled(recipe.colourants).map((row) => ({ material: row.material, materialId: row.materialId ?? null, amount: amountOf(row.amount), group: 'colourant' as const })),
    ],
    analysis: result && {
      basis: 'UMF, flux oxides to 1',
      umf: rounded(result.umf, 4),
      molePercent: rounded(result.molePct, 3),
      analysisPercent: rounded(result.analysisPct, 3),
      silicaToAlumina: typeof result.ratios?.si_al === 'number' ? round(result.ratios.si_al, 3) : null,
      cte: round(result.cte, 2),
      materialsVersion: calc?.materialsVersion ?? null,
    },
  };
}

const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The same content as a spreadsheet-friendly CSV: materials first, then one row per oxide. */
export function recipeToCsv(recipe: RecipeDraft, calc: UmfCalculateResponse | null): string {
  const data = recipeToJson(recipe, calc);
  const lines: (string | number)[][] = [
    ['Recipe', data.name],
    ['Cone', data.cone],
    [],
    ['Material', 'Amount', 'Group'],
    ...data.materials.map((m) => [m.material, m.amount, m.group === 'colourant' ? 'colorant' : m.group]),
  ];

  if (data.analysis) {
    const { umf, molePercent, analysisPercent, silicaToAlumina, cte } = data.analysis;
    lines.push([], ['Oxide', 'UMF', 'Mole %', 'Analysis %']);
    const oxides = Object.keys(molePercent).sort((a, b) => molePercent[b] - molePercent[a]);
    for (const oxide of oxides) lines.push([oxide, umf[oxide] ?? '', molePercent[oxide], analysisPercent[oxide] ?? '']);
    lines.push([], ['SiO2 : Al2O3', silicaToAlumina ?? 'n/a'], ['CTE (x10^-7/C)', cte]);
  }

  return lines.map((line) => line.map(csvCell).join(',')).join('\n') + '\n';
}

/** A short plain-text version, for sharing from a phone. */
export function recipeToText(recipe: RecipeDraft, calc: UmfCalculateResponse | null): string {
  const data = recipeToJson(recipe, calc);
  const lines = [`${data.name} (cone ${data.cone})`, '', ...data.materials.map((m) => `${m.material}  ${m.amount}${m.group === 'colourant' ? '  (colorant)' : ''}`)];
  if (data.analysis) {
    lines.push('', 'UMF', ...Object.entries(data.analysis.umf).map(([oxide, value]) => `${oxide}  ${value.toFixed(2)}`));
    if (data.analysis.silicaToAlumina !== null) lines.push('', `SiO2 : Al2O3  ${data.analysis.silicaToAlumina.toFixed(2)}`);
  }
  return lines.join('\n');
}

export type LimitStatus = 'in' | 'under' | 'over';

/** Where a UMF value sits against its target range for the cone; null when there's no range. */
export function limitStatus(value: number, limit: { minUmf: number; maxUmf: number } | undefined): LimitStatus | null {
  if (!limit) return null;
  if (value < limit.minUmf) return 'under';
  if (value > limit.maxUmf) return 'over';
  return 'in';
}

/** "unknown material" -> the sentence shown under the row the calculator left out. */
export function skippedReason(reason: string | null | undefined): string {
  switch ((reason ?? '').toLowerCase()) {
    case 'unknown material':
      return 'Not in the materials list, so it was left out. Choose it again from the list.';
    case 'no amount':
      return 'No amount yet, so it was left out.';
    case 'amount is not a number':
      return 'The amount isn’t a number, so it was left out.';
    case 'no material':
      return 'No material chosen, so it was left out.';
    default:
      return reason ? `Left out: ${reason}.` : 'Left out of the calculation.';
  }
}
