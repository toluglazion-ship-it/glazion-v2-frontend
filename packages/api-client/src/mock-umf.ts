// The UMF calculator and target ranges, for the in-memory backend in mock.ts. The numbers come
// from packages/chemistry, the calculation the backend was checked against, run on the sample
// materials list, so the screens see the same shapes and the same kinds of results as the API.
import { UMF_GROUPS, calculateRecipe, clayBodyNote, limitsForCone, presentOxides, suggestOptimisations, type Material } from '@glazion/chemistry/core';
import type { CteBand, GlazeLimit, UmfCalculateResponse, UmfDisplayGroup, UmfSkippedRow } from '@glazion/types';
import { ApiError } from './index';
import { findMockMaterial, mockMaterials } from './mock-materials';

type Query = Record<string, string | number | boolean | null | undefined> | undefined;

/** "06", "-6" and -6 all mean cone 06. */
export function normaliseCone(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim();
  const n = Number(text);
  if (Number.isFinite(n) && n < 0) return `0${-n}`;
  return text;
}

function limits(cone: string | null): GlazeLimit[] {
  return cone ? limitsForCone(cone).map((l) => ({ ...l, notes: l.notes || null })) : [];
}

function asChemistryMaterials(): Material[] {
  return mockMaterials().items.map((m) => ({ id: m.id!, name: m.name!, type: 'raw', loi_pct: m.loi_pct, oxideAnalysis: m.oxideAnalysis ?? {} }));
}

const GROUPS: { key: string; label: string; oxides: readonly string[] }[] = [
  { key: 'r2o', label: 'Fluxes, R₂O', oxides: UMF_GROUPS.r2o },
  { key: 'ro', label: 'Fluxes, RO', oxides: UMF_GROUPS.ro },
  { key: 'r2o3', label: 'Stabilisers, R₂O₃', oxides: UMF_GROUPS.r2o3 },
  { key: 'ro2', label: 'Glass formers, RO₂', oxides: UMF_GROUPS.ro2 },
];

const cteBand = (cte: number): CteBand => (cte < 60 ? 'low' : cte < 70 ? 'medium' : 'high');

/** Rows that can't be used are listed in skippedRows, as the API does, and the rest are calculated. */
export function calculateUmf(body: any): UmfCalculateResponse {
  if (!Array.isArray(body?.rows)) throw new ApiError(400, 'rows must be an array.');
  const cone = normaliseCone(body.cone);
  const { materialsVersion } = mockMaterials();
  const materials = asChemistryMaterials();

  const skippedRows: UmfSkippedRow[] = [];
  const rows: { material: string; amount: number }[] = [];
  (body.rows as any[]).forEach((row, index) => {
    const typed = row?.material ?? null;
    if (!row?.materialId && !typed) return skippedRows.push({ index, reason: 'no material', material: null });
    const found = findMockMaterial(row.materialId, typed);
    if (!found) return skippedRows.push({ index, reason: 'unknown material', material: typed ?? row.materialId });
    if (row.amount === null || row.amount === undefined || String(row.amount).trim() === '') return skippedRows.push({ index, reason: 'no amount', material: found.name });
    const amount = typeof row.amount === 'number' ? row.amount : Number.parseFloat(String(row.amount));
    if (!Number.isFinite(amount)) return skippedRows.push({ index, reason: 'amount is not a number', material: found.name });
    rows.push({ material: found.name!, amount });
  });

  const coneLimits = limits(cone);
  const calc = calculateRecipe(rows, materials, cone ?? undefined);
  const base = { materialsVersion, skippedRows, cone, limits: coneLimits };
  const versions = { calculationProfile: 'glazion-umf-v1', calculationVersion: 'mock', oxidesVersion: 'mock', materialsVersion, limitsVersion: 'mock' };
  if (!calc) return { ...base, result: null, displayGroups: [], cteBand: null, versions };

  const { chem, lines } = calc;
  const suggestions = cone
    ? suggestOptimisations(chem.umf, coneLimits.map((l) => ({ ...l, cone: l.cone!, oxide: l.oxide!, notes: l.notes ?? '' })), materials, lines).map((s) => {
        const limit = coneLimits.find((l) => l.oxide === s.oxide)!;
        return { ...s, minUmf: limit.minUmf, maxUmf: limit.maxUmf, notes: limit.notes };
      })
    : [];
  const displayGroups: UmfDisplayGroup[] = GROUPS.map((g) => ({ key: g.key, label: g.label, oxides: presentOxides(chem.umf, g.oxides) })).filter((g) => g.oxides.length > 0);

  return {
    ...base,
    result: {
      lines,
      moles: chem.moles,
      molePct: chem.molePct,
      analysisPct: chem.analysisPct,
      umf: chem.umf,
      fluxSum: chem.fluxSum,
      warnings: chem.warnings,
      ratios: chem.ratios,
      cte: chem.cte,
      suggestions,
      clayBodyNote: clayBodyNote(chem.cte),
    },
    displayGroups,
    cteBand: cteBand(chem.cte),
    versions,
  };
}

/** Answers /umf/calculate, /glaze-limits and /umf/limits; `found` is false for any other route. */
export function handleUmfRequest(method: string, path: string, query: Query, body: any): { found: boolean; value?: unknown } {
  if (method === 'POST' && path === '/umf/calculate') return { found: true, value: calculateUmf(body) };
  if (method === 'GET' && (path === '/glaze-limits' || path === '/umf/limits')) return { found: true, value: limits(normaliseCone(query?.cone)) };
  return { found: false };
}
