// Match check for the in-memory mock (mock.ts): a few searches beside the tiles they matched, traced to their
// recipe and UMF, shaped as the API sends them (Glazion-v2 docs/match-check.md).
import {
  OXIDES,
  type ImageAssetDto,
  type ImageTrace,
  type MatchCheckMaterial,
  type MatchCheckPerson,
  type OxideComparison,
  type OxideGroup,
  type RecipeDto,
  type SearchCheckDetail,
  type SearchCheckResult,
  type SearchCheckShown,
  type SearchCheckSummary,
  type UserDto,
} from '@glazion/types';
import { uid } from './uid';
import { ApiError } from './index';

type Query = Record<string, string | number | boolean | null | undefined> | undefined;

export interface MatchCheckContext {
  images: ImageAssetDto[];
  recipes: RecipeDto[];
  users: UserDto[];
}

const COLOURANT_OXIDES = ['Fe2O3', 'FeO', 'CoO', 'CuO', 'Cr2O3', 'MnO', 'NiO', 'V2O5', 'TiO2'];
const FLUXES = ['Li2O', 'Na2O', 'K2O', 'MgO', 'CaO', 'SrO', 'BaO', 'ZnO', 'PbO'];

function groupOf(oxide: string): OxideGroup {
  if (FLUXES.includes(oxide)) return 'flux';
  if (oxide === 'Al2O3' || oxide === 'B2O3') return 'stabiliser';
  if (oxide === 'SiO2') return 'glass';
  if (COLOURANT_OXIDES.includes(oxide)) return 'colourant';
  if (oxide === 'ZrO2' || oxide === 'SnO2') return 'opacifier';
  return 'other';
}

/** As the API compares: every oxide either side reports, in schema order; difference is tile minus searched. */
function compare(searched: Record<string, number> | null, tile: Record<string, number> | null): OxideComparison[] {
  if (!searched && !tile) return [];
  const keys = new Set([...Object.keys(searched ?? {}), ...Object.keys(tile ?? {})].filter((k) => (searched?.[k] ?? 0) !== 0 || (tile?.[k] ?? 0) !== 0));
  const order = (k: string) => ((OXIDES as readonly string[]).indexOf(k) + 1 || 999);
  return [...keys].sort((a, b) => order(a) - order(b)).map((oxide) => {
    const s = searched ? (searched[oxide] ?? 0) : null;
    const t = tile ? (tile[oxide] ?? 0) : null;
    return { oxide, group: groupOf(oxide), searched: s, tile: t, difference: s !== null && t !== null ? Math.round((t - s) * 10_000) / 10_000 : null };
  });
}

const BASE_UMF: Record<string, number> = { K2O: 0.21, Na2O: 0.08, CaO: 0.71, Al2O3: 0.41, SiO2: 3.38 };

/** A plausible UMF for a mock recipe: the base plus whatever colouring oxide its name or additions mention. */
function umfOf(recipe: RecipeDto | undefined): Record<string, number> {
  const text = `${recipe?.name ?? ''} ${recipe?.additionsJson ?? ''}`.toLowerCase();
  const umf = { ...BASE_UMF };
  if (/tenmoku|iron/.test(text)) umf.Fe2O3 = /tenmoku/.test(text) ? 0.26 : 0.03;
  if (/celadon/.test(text)) umf.Fe2O3 = 0.015;
  if (/cobalt|blue/.test(text)) umf.CoO = 0.04;
  if (/copper|green/.test(text)) umf.CuO = 0.05;
  if (/titanium|rutile/.test(text)) umf.TiO2 = 0.12;
  return umf;
}

function materialsOf(recipe: RecipeDto | undefined): { materials: MatchCheckMaterial[]; additions: MatchCheckMaterial[] } {
  const kind = (name: string) => (/oxide|carbonate|rutile|ilmenite/i.test(name) ? 'colorant' : /stain|mason/i.test(name) ? 'stain' : null);
  const rows = (json: string | null | undefined): MatchCheckMaterial[] => {
    try {
      const parsed = JSON.parse(json || '[]');
      const list = Array.isArray(parsed) ? parsed : (parsed.full ?? parsed.materials ?? parsed.rows ?? []);
      return list.map((r: any) => ({ name: r.rawName ?? r.name ?? r.material ?? '?', amount: Number(r.amount) || null, unit: r.unit ?? '%', kind: kind(String(r.rawName ?? r.name ?? '')) }));
    } catch {
      return [];
    }
  };
  const additions = rows(recipe?.additionsJson);
  const base: MatchCheckMaterial[] = [
    { name: 'Custer Feldspar', amount: 40, unit: '%', kind: 'feldspar' },
    { name: 'Silica', amount: 30, unit: '%', kind: 'silica' },
    { name: 'Whiting', amount: 20, unit: '%', kind: 'flux' },
    { name: 'EP Kaolin', amount: 10, unit: '%', kind: 'clay' },
  ];
  const own = rows(recipe?.recipeJson);
  return { materials: own.length > 0 ? own : [...base, ...additions], additions };
}

function person(u: UserDto | undefined): MatchCheckPerson | null {
  return u ? { id: u.id, username: u.username ?? '', displayName: u.displayName, participantCode: u.participantCode } : null;
}

function trace(ctx: MatchCheckContext, img: ImageAssetDto, comparedAtSearch: boolean | null): ImageTrace {
  const recipe = ctx.recipes.find((r) => r.id === img.recipes?.[0]?.recipeId);
  const { materials, additions } = materialsOf(recipe);
  return {
    imageId: img.imageId,
    displayUrl: img.displayUrl,
    thumbnailUrl: img.thumbnailUrl,
    source: img.sourceType,
    fileName: img.externalRecordId,
    recordId: img.sourceType === 'Import' ? (img.externalRecordId?.replace(/\.jpg$/, '') ?? null) : null,
    batchName: img.sourceType === 'Import' ? 'Stain spectrum (porcelain)' : null,
    owner: img.sourceType === 'UserUpload' ? person(ctx.users[1]) : null,
    clayBody: 'porcelain',
    coneMin: img.coneMin,
    coneMax: img.coneMax,
    atmosphere: img.atmosphere,
    approvalStatus: img.approvalStatus,
    recipes: recipe
      ? [{ id: recipe.id, code: recipe.code, name: recipe.name ?? 'Recipe', verified: true, relationship: 'TestTile', baseCode: recipe.baseCode, baseName: recipe.baseCode ? 'Original base' : null, materials, additions }]
      : [],
    chemistry: recipe ? { calculationResultId: uid(), supplied: false, umf: umfOf(recipe), comparedAtSearch } : null,
    colourants: [],
  };
}

interface MockRun {
  summary: Omit<SearchCheckSummary, 'top' | 'topScore' | 'topBand' | 'resultCount' | 'notRelevant'>;
  detail: Omit<SearchCheckDetail, 'results' | 'requester' | 'id' | 'createdAt'>;
  shown: { imageIndex: number; shown: SearchCheckShown; score: number; feedback?: 'relevant' | 'not_relevant'; note?: string }[];
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function seed(ctx: MatchCheckContext): MockRun[] {
  const typed: MatchCheckMaterial[] = [
    { name: 'Custer Feldspar', amount: 40, unit: '%', kind: 'feldspar' },
    { name: 'Silica', amount: 30, unit: '%', kind: 'silica' },
    { name: 'Whiting', amount: 20, unit: '%', kind: 'flux' },
    { name: 'EP Kaolin', amount: 10, unit: '%', kind: 'clay' },
    { name: 'Cobalt Carbonate', amount: 3, unit: '%', kind: 'colorant' },
  ];
  const pat = ctx.users[1];
  const query = { recipeId: null, recipeCode: null, recipeName: null, coneMin: 10, coneMax: 10, atmosphere: 'reduction', strict: false, clayBodies: [] as string[], colourants: [] };
  return [
    {
      summary: { id: uid(), createdAt: ago(35), requester: person(pat), queryType: 'raw_recipe', name: 'Blue test', recipeCode: null, materials: typed.map((m) => m.name), colourants: [] },
      detail: {
        query: { ...query, type: 'raw_recipe', name: 'Blue test', materials: typed, materialsAsTyped: true, umf: { ...BASE_UMF, CoO: 0.05 } },
        warnings: [], rankerVersion: 'hybrid-1.1.0', candidateCount: 96, latencyMs: 412,
      },
      shown: [
        { imageIndex: 3, shown: 'closest', score: 0.85 },
        { imageIndex: 0, shown: 'similar', score: 0.84, feedback: 'not_relevant', note: 'Brown, not blue. The cobalt is ignored.' },
        { imageIndex: 2, shown: 'similar', score: 0.84 },
        { imageIndex: 1, shown: 'ranked', score: 0.82 },
      ],
    },
    {
      summary: { id: uid(), createdAt: ago(60 * 5), requester: person(ctx.users[2] ?? pat), queryType: 'recipe', name: null, recipeCode: 'P01-B1-001', materials: [], colourants: [] },
      detail: {
        query: { ...query, type: 'recipe', name: null, recipeCode: 'P01-B1-001', recipeName: 'B1 + 1% Cobalt Carbonate', materials: null, materialsAsTyped: false, umf: { ...BASE_UMF, CoO: 0.02 } },
        warnings: [], rankerVersion: 'hybrid-1.1.0', candidateCount: 88, latencyMs: 380,
      },
      shown: [
        { imageIndex: 3, shown: 'closest', score: 0.93, feedback: 'relevant' },
        { imageIndex: 2, shown: 'similar', score: 0.81 },
      ],
    },
    {
      summary: { id: uid(), createdAt: ago(60 * 26), requester: person(pat), queryType: 'umf', name: null, recipeCode: null, materials: [], colourants: null },
      detail: {
        query: { ...query, type: 'umf', name: null, materials: null, materialsAsTyped: false, umf: { ...BASE_UMF, Fe2O3: 0.24 }, colourants: null },
        warnings: [], rankerVersion: 'hybrid-1.1.0', candidateCount: 90, latencyMs: 298,
      },
      shown: [
        { imageIndex: 0, shown: 'closest', score: 0.91 },
        { imageIndex: 1, shown: 'similar', score: 0.72 },
      ],
    },
  ];
}

let runs: MockRun[] | null = null;

function results(ctx: MatchCheckContext, run: MockRun): SearchCheckResult[] {
  return run.shown.flatMap((s, i) => {
    const img = ctx.images[s.imageIndex];
    if (!img) return [];
    const image = trace(ctx, img, true);
    return [{
      rank: s.shown === 'similar' && i > 3 ? null : i + 1,
      shown: s.shown,
      score: s.score,
      confidenceBand: s.score >= 0.8 ? 'high' : s.score >= 0.6 ? 'medium' : 'low',
      scoreBreakdown: { chemistrySimilarity: s.score, firingCompatibility: 1, labelOrTextSimilarity: 0.6, imageSimilarity: null, colourantSimilarity: 1 },
      matchedFields: ['fluxBalance', 'silica', 'cone'],
      limitations: ['Exact firing schedule was not recorded.'],
      feedback: s.feedback ?? null,
      feedbackNote: s.note ?? null,
      image,
      comparison: compare(run.detail.query.umf, image.chemistry?.umf ?? null),
    }];
  });
}

export function handleMatchCheckRequest(ctx: MatchCheckContext, method: string, path: string, query: Query): { found: boolean; value?: unknown } {
  const shape = `${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')}`;
  const id = path.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0] ?? '';
  runs ??= seed(ctx);
  switch (shape) {
    case 'GET /admin/searches': {
      const q = String(query?.q ?? '').trim().toLowerCase();
      const list = runs
        .filter((r) => !query?.type || r.summary.queryType === query.type)
        .filter((r) => !query?.notRelevant || r.shown.some((s) => s.feedback === 'not_relevant'))
        .filter((r) => !q || [r.summary.requester?.username, r.summary.requester?.displayName].some((v) => v?.toLowerCase().includes(q)))
        .map((r): SearchCheckSummary => {
          const top = ctx.images[r.shown[0]?.imageIndex];
          const recipe = top?.recipes?.[0];
          return {
            ...r.summary,
            resultCount: r.shown.length,
            topScore: r.shown[0]?.score ?? null,
            topBand: r.shown[0] ? (r.shown[0].score >= 0.8 ? 'high' : 'medium') : null,
            top: top ? { imageId: top.imageId, thumbnailUrl: top.thumbnailUrl, recipeCode: recipe?.recipeCode ?? null, recipeName: recipe?.recipeName ?? null } : null,
            notRelevant: r.shown.filter((s) => s.feedback === 'not_relevant').length,
          };
        });
      return { found: true, value: { items: list, totalCount: list.length, nextCursor: null } };
    }
    case 'GET /admin/searches/:id': {
      const run = runs.find((r) => r.summary.id === id);
      if (!run) throw new ApiError(404, 'No search with this ID.', { code: 'search_not_found' });
      const detail: SearchCheckDetail = { ...run.detail, id: run.summary.id, createdAt: run.summary.createdAt, requester: run.summary.requester, results: results(ctx, run) };
      return { found: true, value: detail };
    }
    case 'GET /admin/images/traces': {
      const q = String(query?.q ?? '').trim().toLowerCase();
      const code = String(query?.recipeCode ?? '').trim().toUpperCase();
      const list = [...ctx.images]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .filter((img) => !query?.source || img.sourceType === query.source)
        .filter((img) => !query?.approval || img.approvalStatus === query.approval)
        .filter((img) => !code || (img.recipes ?? []).some((r) => r.recipeCode?.startsWith(code)))
        .filter((img) => !q || [img.externalRecordId, ...(img.recipes ?? []).flatMap((r) => [r.recipeCode, r.recipeName])].some((v) => v?.toLowerCase().includes(q)))
        .map((img) => trace(ctx, img, null));
      const size = Math.min(Number(query?.pageSize ?? 25), 50);
      const offset = Number(query?.cursor ?? 0);
      const page = list.slice(offset, offset + size);
      return { found: true, value: { items: page, totalCount: list.length, nextCursor: offset + page.length < list.length ? String(offset + page.length) : null } };
    }
    case 'GET /admin/images/:id/trace': {
      const img = ctx.images.find((x) => x.imageId === id);
      if (!img) throw new ApiError(404, 'Image not found.');
      return { found: true, value: trace(ctx, img, null) };
    }
    default:
      return { found: false };
  }
}
