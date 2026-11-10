import type { MaterialRow } from '@glazion/types';

/** 2 -> "2", 0.25 -> "0.25": no trailing zeros, no floating-point noise. */
export function formatAmount(amount: number): string {
  return String(Number(amount.toFixed(3)));
}

/** "2%" for percentages (the default), "15 g" for anything else. */
export function formatQuantity(row: MaterialRow): string {
  const unit = row.unit?.trim() || '%';
  return unit === '%' ? `${formatAmount(row.amount)}%` : `${formatAmount(row.amount)} ${unit}`;
}

/** "1% Copper Carbonate, 2% Red Iron Oxide" */
export function describeRows(rows: MaterialRow[]): string {
  return rows.map((row) => `${formatQuantity(row)} ${row.rawName}`).join(', ');
}

/** Material rows from a parsed list; anything that doesn't look like a row is skipped rather than breaking the page. */
function rowsFrom(value: unknown): MaterialRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const name = item?.rawName ?? item?.RawName ?? item?.material ?? item?.name;
    const amount = Number(item?.amount ?? item?.Amount);
    if (typeof name !== 'string' || !Number.isFinite(amount)) return [];
    return [{ rawName: name, amount, unit: item?.unit ?? item?.Unit ?? null }];
  });
}

/** Reads a recipe's additionsJson. It's written by the server from MaterialRow objects. */
export function parseRows(json: string | null | undefined): MaterialRow[] {
  if (!json) return [];
  try {
    return rowsFrom(JSON.parse(json));
  } catch {
    return [];
  }
}

/** What a recipe is made of, as stored with it. */
export interface RecipeMixture {
  /** A coded variation: its base's formulation, and what was added to it. */
  base: MaterialRow[];
  additions: MaterialRow[];
  /** Any other recipe: its materials as entered or imported. */
  materials: MaterialRow[];
  /** Imported with its chemistry (a UMF) only: no materials were recorded. */
  umfOnly: boolean;
}

/**
 * Reads a recipe's recipeJson the way the server does: a variation keeps `baseFormulation` and `additions` (with
 * `full` = both), other recipes `materials` or `rows`, and photo imports only a `umf`.
 */
export function recipeMixture(recipe: { recipeJson: string | null; additionsJson: string | null }): RecipeMixture {
  let data: Record<string, unknown> = {};
  try {
    const value: unknown = recipe.recipeJson ? JSON.parse(recipe.recipeJson) : {};
    if (value && typeof value === 'object' && !Array.isArray(value)) data = value as Record<string, unknown>;
  } catch {
    // An unreadable recipe shows as having no materials.
  }
  const base = rowsFrom(data.baseFormulation);
  const additions = base.length > 0 ? rowsFrom(data.additions) : parseRows(recipe.additionsJson);
  const materials = base.length > 0 ? [] : rowsFrom(data.full ?? data.materials ?? data.rows);
  return { base, additions, materials, umfOnly: base.length === 0 && materials.length === 0 && !!data.umf };
}

/** A row as the form holds it: text while being typed, checked on submit. */
export interface DraftRow {
  key: number;
  rawName: string;
  amount: string;
  /** The name was chosen from the materials list (or came from a saved recipe), not just typed. */
  picked: boolean;
}

let nextKey = 1;

export const draftRow = (rawName = '', amount = '', picked = rawName !== ''): DraftRow => ({ key: nextKey++, rawName, amount, picked });

export const toDraftRows = (rows: MaterialRow[]): DraftRow[] => rows.map((row) => draftRow(row.rawName, formatAmount(row.amount)));

/** The filled-in rows as MaterialRows, or the first problem to show. Empty rows are ignored. */
export function readDraftRows(rows: DraftRow[], { allowZero }: { allowZero: boolean }): { rows: MaterialRow[]; problem: string | null } {
  const out: MaterialRow[] = [];
  for (const row of rows) {
    const rawName = row.rawName.trim();
    const text = row.amount.trim();
    if (!rawName && !text) continue;
    if (!rawName) return { rows: out, problem: 'Every amount needs a material.' };
    if (!row.picked) return { rows: out, problem: `Choose “${rawName}” from the materials list, so the recipe is calculated with the right material.` };
    const amount = Number(text.replace(',', '.'));
    if (!text || !Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) {
      return { rows: out, problem: `Enter an amount for ${rawName}${allowZero ? '' : ' above 0'}.` };
    }
    out.push({ rawName, amount, unit: '%' });
  }
  return { rows: out, problem: null };
}

/** from → to in steps, inclusive: 1, 10, 1 → 1, 2 … 10. Null when it isn't a range (or is over 999 amounts). */
export function rangeAmounts(from: number, to: number, step: number): number[] | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(step > 0) || from < 0 || to < from) return null;
  const amounts: number[] = [];
  for (let i = 0; ; i++) {
    const amount = Number((from + i * step).toFixed(3));
    if (amount > to + 1e-9) break;
    amounts.push(amount);
    if (amounts.length > 999) return null;
  }
  return amounts;
}

/**
 * "0.5, 1, 2" -> [0.5, 1, 2]; a range counts too: "1-10" is 1 to 10 in steps of 1, "0.5-0.9 step 0.2" is 0.5, 0.7, 0.9.
 * Null when something in it isn't an amount.
 */
export function readAmounts(text: string): number[] | null {
  const amounts: number[] = [];
  for (const part of text.split(/[,;]+/).map((p) => p.trim()).filter(Boolean)) {
    const range = part.match(/^([\d.]+)\s*(?:-|to)\s*([\d.]+)(?:\s*(?:step|by)\s*([\d.]+))?$/i);
    const found = range ? rangeAmounts(Number(range[1]), Number(range[2]), range[3] ? Number(range[3]) : 1) : part.split(/\s+/).map(Number);
    if (!found || found.some((n) => !Number.isFinite(n) || n < 0)) return null;
    for (const n of found) if (!amounts.includes(n)) amounts.push(n);
  }
  return amounts;
}

/** Every combination of the series' amounts, first material changing slowest. */
export function combinations(series: { rawName: string; amounts: number[] }[]): MaterialRow[][] {
  return series.reduce<MaterialRow[][]>(
    (sets, s) => sets.flatMap((set) => s.amounts.map((amount) => [...set, { rawName: s.rawName, amount, unit: '%' }])),
    [[]],
  );
}

/** Each material's amounts on their own: iron at 1, 2, 3% and cobalt at 0.5, 1% is five variations. */
export function separately(series: { rawName: string; amounts: number[] }[]): MaterialRow[][] {
  return series.flatMap((s) => s.amounts.map((amount) => [{ rawName: s.rawName, amount, unit: '%' }]));
}

