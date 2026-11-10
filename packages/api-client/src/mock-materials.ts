// The materials list and its admin routes, for the in-memory backend in mock.ts. A small slice of
// the real materials.json, with the same kinds of repeats, so search, the dropdown and the
// duplicates screen behave as they do against the API.
import type {
  MaterialCategory,
  MaterialCategoryOption,
  MaterialDuplicateGroup,
  MaterialListResponse,
  MaterialOverrideDto,
  MaterialSummary,
} from '@glazion/types';
import { ApiError, MATERIAL_OXIDES, MATERIAL_TOTAL_MAX, materialId } from './index';

type Query = Record<string, string | number | boolean | null | undefined> | undefined;
type Analysis = Record<string, number>;

const CATEGORIES: MaterialCategoryOption[] = [
  { key: 'silica', label: 'Silica' },
  { key: 'clay', label: 'Clays' },
  { key: 'feldspar', label: 'Feldspars' },
  { key: 'flux', label: 'Fluxes' },
  { key: 'frit', label: 'Frits' },
  { key: 'opacifier', label: 'Opacifiers' },
  { key: 'colorant', label: 'Colorants: metallic oxides' },
  { key: 'stain', label: 'Colorants: stains' },
  { key: 'ash', label: 'Ashes' },
  { key: 'additive', label: 'Additives' },
  { key: 'other', label: 'Other' },
];
const categoryOrder = (c: MaterialCategory) => CATEGORIES.findIndex((x) => x.key === c);

// name, category, common, aliases, analysis, LOI. Repeated names are repeated in the file too.
const FILE: [string, MaterialCategory, boolean, string[], Analysis, number][] = [
  ['Silica', 'silica', true, ['Flint 325', 'Quartz'], {SiO2: 100}, 0],
  ['Flint', 'silica', false, [], {CaO: 3, MgO: 0.1, SiO2: 94, Fe2O3: 0.1}, 0],
  ['EP Kaolin', 'clay', true, ['EPK', 'EPK Kaolin'], {CaO: 0.18, K2O: 0.33, MgO: 0.1, Na2O: 0.06, P2O5: 0.24, SiO2: 45.73, TiO2: 0.37, Al2O3: 37.36, Fe2O3: 0.79}, 13.2],
  ['Kaolin', 'clay', true, [], {SiO2: 47.29, Al2O3: 40.21}, 12.5],
  ['Bentonite', 'clay', true, [], {CaO: 1, K2O: 1, MgO: 2, Na2O: 3, SiO2: 59, Al2O3: 20, Fe2O3: 3.5}, 10],
  ['CP-7 Ball Clay', 'clay', false, [], {CaO: 0.3, K2O: 0.14, MgO: 0.1, Na2O: 0.05, SiO2: 54.89, TiO2: 1.6, Al2O3: 28.67, Fe2O3: 1}, 12.65],
  ['CP#7 Ball Clay', 'clay', false, [], {CaO: 0.3, K2O: 0.26, MgO: 0.1, Na2O: 0.05, P2O5: 0.01, SiO2: 54.9, TiO2: 1.6, Al2O3: 28.7, Fe2O3: 1}, 12.5],
  ['No. 1 Ball Clay', 'clay', false, [], {CaO: 0.1, K2O: 1, MgO: 0.1, Na2O: 0.1, SiO2: 54.56, TiO2: 0.7, Al2O3: 30.63, Fe2O3: 1}, 10.9],
  ['No. 1 Ball Clay', 'clay', false, [], {CaO: 0.06, K2O: 0.32, MgO: 0.18, Na2O: 0.09, SiO2: 60.8, TiO2: 2, Al2O3: 26.2, Fe2O3: 0.87}, 8.84],
  ['Custer Feldspar', 'feldspar', true, ['Custer'], {CaO: 0.3, K2O: 10, Na2O: 3, SiO2: 68.5, Al2O3: 17, Fe2O3: 0.1}, 0.3],
  ['Minspar 200', 'feldspar', true, ['Minspar'], {CaO: 1.5, K2O: 4.1, Na2O: 6.5, SiO2: 68.8, Al2O3: 18.2, Fe2O3: 0.07}, 0.3],
  ['Nepheline Syenite', 'feldspar', true, ['Neph Sy', 'Neph'], {CaO: 0.7, K2O: 4.6, MgO: 0.1, Na2O: 9.8, SiO2: 60.7, Al2O3: 23.3, Fe2O3: 0.1}, 0.7],
  ['G-200 Feldspar', 'feldspar', false, ['G-200'], {CaO: 0.8, K2O: 10.8, MgO: 0.05, Na2O: 3.1, SiO2: 66.3, Al2O3: 18.5, Fe2O3: 0.08}, 0.15],
  ['Spodumene', 'feldspar', false, [], {Li2O: 8.01, SiO2: 64.59, Al2O3: 27.41}, 0],
  ['Lepidolite', 'feldspar', false, [], {K2O: 7.3, Li2O: 3, SiO2: 47.7, Al2O3: 26.9}, 10],
  ['Lepidolite', 'feldspar', false, [], {K2O: 9.57, Li2O: 4.25, Na2O: 1.06, SiO2: 58.34, Al2O3: 26.65, Fe2O3: 0.13}, 0],
  ['Calcium Carbonate', 'flux', true, ['Whiting'], {CaO: 56.1}, 0],
  ['Vapenec Whiting', 'flux', false, [], {CaO: 55.5, MgO: 0.4, SiO2: 0.4}, 43.7],
  ['Dolomite', 'flux', true, [], {CaO: 30.49, MgO: 21.9}, 0],
  ['Talc', 'flux', true, [], {MgO: 31.87, SiO2: 63.38}, 0],
  ['Wollastonite', 'flux', true, [], {CaO: 48.28, SiO2: 51.72}, 0],
  ['Zinc Oxide', 'flux', true, [], {ZnO: 100}, 0],
  ['Strontium Carbonate', 'flux', true, [], {SrO: 70.2}, 0],
  ['Lithium Carbonate', 'flux', true, [], {Li2O: 40.74}, 0],
  ['Barium Carbonate', 'flux', false, [], {BaO: 77.66}, 0],
  ['Gerstley Borate', 'flux', true, ['GB'], {CaO: 19.4, K2O: 0.4, MgO: 3.5, B2O3: 26.8, Na2O: 4, P2O5: 0.1, SiO2: 14.8, TiO2: 0.1, Al2O3: 1, Fe2O3: 0.4}, 29.5],
  ['Bone Ash', 'flux', true, [], {CaO: 55.82, P2O5: 42.39}, 0],
  ['Ferro Frit 3134', 'frit', true, ['3134', 'Frit 3134'], {CaO: 19.51, B2O3: 22.79, Na2O: 10.14, SiO2: 45.56, Al2O3: 2}, 0],
  ['Ferro Frit 3124', 'frit', true, ['3124'], {CaO: 14.28, K2O: 0.68, B2O3: 13.74, Na2O: 6.4, SiO2: 54.94, Al2O3: 10.01}, 0],
  ['Ferro Frit 3195', 'frit', true, ['3195'], {CaO: 11.36, B2O3: 22.62, Na2O: 5.69, SiO2: 48.35, Al2O3: 11.98}, 0],
  ['Ceraflux', 'frit', false, [], {PbO: 65, SiO2: 32, Al2O3: 3}, 0],
  ['Ceraflux', 'frit', false, [], {PbO: 65, SiO2: 34, Al2O3: 1}, 0],
  ['Hommel Frit 71', 'frit', false, [], {CaO: 0.05, K2O: 1.08, PbO: 70.25, Na2O: 1.43, SiO2: 25.09, Al2O3: 2.1}, 0],
  ['Hommel Frit 71', 'frit', false, [], {}, 0],
  ['Zircopax', 'opacifier', true, ['Zircon'], {SiO2: 32.79, ZrO2: 67.21}, 0],
  ['Tin Oxide', 'opacifier', true, [], {SnO2: 100}, 0],
  ['Titanium Dioxide', 'opacifier', true, [], {TiO2: 100}, 0],
  ['Rutile', 'colorant', true, [], {TiO2: 90, Fe2O3: 10}, 0.1],
  ['Iron Oxide Red', 'colorant', true, ['RIO', 'Red Iron Oxide'], {Fe2O3: 95}, 0],
  ['Cobalt Carbonate', 'colorant', true, [], {CoO: 63}, 0],
  ['Cobalt Oxide', 'colorant', true, [], {CoO: 93.35}, 0],
  ['Copper Carbonate', 'colorant', true, [], {CuO: 64.4}, 0],
  ['Chrome Oxide', 'colorant', true, ['Chromium Oxide'], {Cr2O3: 131.58}, 0],
  ['Manganese Dioxide', 'colorant', true, [], {MnO2: 100}, 0],
  ['Ochre', 'colorant', false, [], {CaO: 0.3, MgO: 0.1, SiO2: 74, Al2O3: 15, Fe2O3: 10.6}, 0],
  ['Ochre', 'colorant', false, [], {CaO: 0.5, MgO: 0.2, MnO: 3.01, SiO2: 25.11, Al2O3: 6.03, Fe2O3: 55.65}, 9.5],
  ['Stain 6000', 'stain', true, ['Shell Pink'], {}, 0],
  ['Stain 6339', 'stain', false, [], {}, 0],
  ['Stain 6339', 'stain', false, [], {}, 0],
  ['Stain (blue)', 'stain', false, [], {}, 0],
  ['Stain (blue)', 'stain', false, [], {}, 0],
  ['Wood Ash', 'ash', true, [], {CaO: 37, K2O: 16, MgO: 11, MnO: 2, Na2O: 1, P2O5: 9, SiO2: 7, Fe2O3: 1}, 16],
  ['CMC Gum', 'additive', true, ['CMC'], {}, 0],
  ['Epsom Salts', 'additive', true, [], {MgO: 16.36}, 51.14],
];

interface FileEntry {
  name: string;
  analysis: Analysis;
  loi: number;
}

interface Catalog {
  category: MaterialCategory;
  common: boolean;
  aliases: string[];
}

const fileEntries = new Map<string, FileEntry[]>();
const catalog = new Map<string, Catalog>();
for (const [name, category, common, aliases, analysis, loi] of FILE) {
  const id = materialId(name);
  fileEntries.set(id, [...(fileEntries.get(id) ?? []), { name, analysis, loi }]);
  const known = catalog.get(id);
  catalog.set(id, {
    category,
    common: common || !!known?.common,
    aliases: [...new Set([...(known?.aliases ?? []), ...aliases])],
  });
}

const overrides = new Map<string, MaterialOverrideDto>();

function version(): string {
  const text = JSON.stringify([...overrides.values()]);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = (hash * 33) ^ text.charCodeAt(i);
  return `mock-${(hash >>> 0).toString(16)}`;
}

const sameAnalysis = (a: Analysis, b: Analysis) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/** Every material once, as the calculator sees it: the later file entry, then any correction over it. */
function materials(): MaterialSummary[] {
  const list: MaterialSummary[] = [];
  for (const [id, entries] of fileEntries) {
    const used = entries[entries.length - 1];
    const fix = overrides.get(id);
    const analysis = fix?.oxideAnalysis ?? used.analysis;
    const info = catalog.get(id)!;
    list.push({
      id,
      name: used.name,
      type: 'raw',
      loi_pct: fix ? (fix.loi ?? 0) : used.loi,
      oxideAnalysis: analysis,
      hasAnalysis: Object.keys(analysis).length > 0,
      source: fix ? 'override' : 'file',
      category: info.category,
      common: info.common,
      aliases: info.aliases,
    });
  }
  for (const fix of overrides.values()) {
    if (fix.inFile) continue;
    const analysis = fix.oxideAnalysis ?? {};
    list.push({
      id: fix.materialId,
      name: fix.name,
      type: 'raw',
      loi_pct: fix.loi ?? 0,
      oxideAnalysis: analysis,
      hasAnalysis: Object.keys(analysis).length > 0,
      source: 'custom',
      category: 'other',
      common: false,
      aliases: [],
    });
  }
  return list;
}

/** Whether two words are at most one edit apart. */
function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Exact 0, prefix 1, a word starting with it 2, contains 3, one typo per long word 4; null for no match. */
function tier(text: string, q: string): number | null {
  const t = text.toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (words(t).some((w) => w.startsWith(q))) return 2;
  if (t.includes(q)) return 3;
  const qWords = words(q);
  const tWords = words(t);
  const typo = qWords.every((qw) => tWords.some((tw) => tw.startsWith(qw) || (qw.length >= 4 && (oneEdit(qw, tw) || oneEdit(qw, tw.slice(0, qw.length))))));
  return qWords.length > 0 && typo ? 4 : null;
}

function search(list: MaterialSummary[], q: string): MaterialSummary[] {
  const ranked: { item: MaterialSummary; rank: number }[] = [];
  for (const item of list) {
    const byName = tier(item.name ?? '', q);
    let best = byName;
    let alias: string | null = null;
    for (const a of item.aliases ?? []) {
      const t = tier(a, q);
      if (t !== null && (best === null || t < best)) {
        best = t;
        alias = a;
      }
    }
    if (best === null) continue;
    ranked.push({
      item: { ...item, matchedAlias: alias },
      rank: best * 4 + (item.common ? 0 : 2) + (item.hasAnalysis ? 0 : 1),
    });
  }
  return ranked.sort((a, b) => a.rank - b.rank || a.item.name!.localeCompare(b.item.name!)).map((r) => r.item);
}

function list(query: Query): MaterialListResponse {
  const q = String(query?.q ?? '')
    .trim()
    .toLowerCase();
  let items = materials();
  if (query?.common === true || query?.common === 'true') items = items.filter((m) => m.common);
  if (query?.category) items = items.filter((m) => m.category === query.category);
  if (query?.withAnalysis === true || query?.withAnalysis === 'true') items = items.filter((m) => m.hasAnalysis);
  items = q ? search(items, q) : items.sort((a, b) => categoryOrder(a.category!) - categoryOrder(b.category!) || a.name!.localeCompare(b.name!));

  const size = Math.min(Number(query?.pageSize ?? query?.limit ?? 50), 500);
  const start = Number(query?.cursor ?? query?.offset ?? 0);
  const end = start + size;
  return {
    materialsVersion: version(),
    total: items.length,
    items: items.slice(start, end),
    nextCursor: end < items.length ? String(end) : null,
    categories: CATEGORIES,
  };
}

function duplicates(): MaterialDuplicateGroup[] {
  const groups: MaterialDuplicateGroup[] = [];
  let position = 0;
  const positions = new Map<FileEntry, number>();
  for (const entries of fileEntries.values()) for (const e of entries) positions.set(e, position++);
  for (const [id, entries] of fileEntries) {
    if (entries.length < 2) continue;
    const fix = overrides.get(id);
    groups.push({
      materialId: id,
      identical: entries.every((e) => sameAnalysis(e.analysis, entries[0].analysis) && e.loi === entries[0].loi),
      resolvedByOverride: !!fix,
      entries: entries.map((e, i) => ({
        position: positions.get(e)!,
        name: e.name,
        oxideAnalysis: e.analysis,
        loi: e.loi,
        usedByCalculator: !fix && i === entries.length - 1,
      })),
    });
  }
  return groups.sort((a, b) => Number(a.identical) - Number(b.identical) || a.materialId!.localeCompare(b.materialId!));
}

const paged = <T,>(items: T[]) => ({ items, totalCount: items.length, nextCursor: null });

const KNOWN = new Map<string, string>(MATERIAL_OXIDES.map((s) => [s.toLowerCase(), s]));

function save(id: string, body: any): MaterialOverrideDto {
  const name = String(body?.name ?? '').trim();
  if (!name) throw new ApiError(400, 'Give the material a name.');
  if (materialId(name) !== id) throw new ApiError(400, `“${name}” is the material ${materialId(name)}, not ${id}.`);
  const analysis: Analysis = {};
  let total = 0;
  for (const [symbol, raw] of Object.entries(body?.oxideAnalysis ?? {})) {
    const known = KNOWN.get(symbol.trim().toLowerCase());
    if (!known) throw new ApiError(400, `The calculator doesn’t know the oxide ${symbol}.`);
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new ApiError(400, `${known} must be between 0 and 100.`);
    analysis[known] = value;
    total += value;
  }
  if (total > MATERIAL_TOTAL_MAX) throw new ApiError(400, `The oxides add up to ${Number(total.toFixed(2))}%. The most allowed is ${MATERIAL_TOTAL_MAX}%.`);
  const now = new Date().toISOString();
  const fix: MaterialOverrideDto = {
    materialId: id,
    name,
    oxideAnalysis: analysis,
    loi: body?.loi ?? null,
    note: body?.note?.trim() || null,
    inFile: fileEntries.has(id),
    createdAt: overrides.get(id)?.createdAt ?? now,
    updatedAt: now,
    materialsVersion: null,
  };
  overrides.set(id, fix);
  fix.materialsVersion = version();
  return fix;
}

/** The material a recipe row names: by id first, then by name or alias, ignoring case. */
export function findMockMaterial(materialId: string | null | undefined, name: string | null | undefined): MaterialSummary | undefined {
  const all = materials();
  if (materialId) {
    const byId = all.find((m) => m.id === materialId);
    if (byId) return byId;
  }
  const key = String(name ?? '').trim().toLowerCase();
  if (!key) return undefined;
  return all.find((m) => m.name?.toLowerCase() === key) ?? all.find((m) => m.aliases?.some((a) => a.toLowerCase() === key));
}

/** Up to three materials a misspelt name may have meant. */
export function suggestMockMaterials(name: string): MaterialSummary[] {
  const q = name.trim().toLowerCase();
  return q ? search(materials(), q).slice(0, 3) : [];
}

/** Every material, as the calculator sees it, and the current version string. */
export function mockMaterials(): { items: MaterialSummary[]; materialsVersion: string } {
  return { items: materials(), materialsVersion: version() };
}

/** Answers the /materials and /admin/materials routes; `found` is false for any other route. */
export function handleMaterialsRequest(method: string, path: string, query: Query, body: any): { found: boolean; value?: unknown } {
  if (method === 'GET' && path === '/materials') return { found: true, value: list(query) };
  if (method === 'GET' && path === '/admin/materials/duplicates') return { found: true, value: paged(duplicates()) };
  if (method === 'GET' && path === '/admin/materials/overrides') return { found: true, value: paged([...overrides.values()]) };
  const id = decodeURIComponent(path.match(/^\/admin\/materials\/([^/]+)$/)?.[1] ?? '');
  if (!id) return { found: false };
  if (method === 'PUT') return { found: true, value: save(id, body) };
  if (method === 'DELETE') {
    if (!overrides.delete(id)) throw new ApiError(404, 'That material has no correction to undo.');
    return { found: true, value: undefined };
  }
  return { found: false };
}
