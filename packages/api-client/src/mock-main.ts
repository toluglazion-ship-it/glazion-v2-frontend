// Sample backend for the main app's search, chat and registration. It answers when a feature's
// SAMPLE_DATA flag is on, and for everything in the fake backend (VITE_USE_MOCKS=true). Responses
// follow the API's shapes (Swagger of 17 Oct 2026). Data lives in memory and resets on reload.
import {
  AccountStatus,
  OXIDES,
  type Atmosphere,
  type ChatMessage,
  type ChatSource,
  type ChatToolCall,
  type ColorantMaterial,
  type Colourant,
  type ConfidenceBand,
  type Conversation,
  type ConversationSummary,
  type RecipeImageSearchRequest,
  type RecipeImageSearchResponse,
  type SearchResultItem,
  type Umf,
} from '@glazion/types';
import { uid } from './uid';
import { ApiError, type ApiQuery } from './index';
import { findMockMaterial, suggestMockMaterials } from './mock-materials';
import { calculateUmf } from './mock-umf';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

// ─── Tile library ─────────────────────────────────────────────────────────────

interface SampleTile {
  id: string;
  label: string;
  colours: [base: string, pool: string];
  variant: 'white' | 'off_white' | 'pink';
  surface: 'glossy' | 'satin' | 'matte';
  opacity: 'transparent' | 'translucent' | 'opaque';
  colourFamily: string;
  cone: number;
  atmosphere: Atmosphere;
  umf: Umf;
  limitations: string[];
}

const BODY_COLOUR = { white: '#efece6', off_white: '#e4dccb', pink: '#e6cdc3' };

/** The sample tiles' clay, read from the colour of their body. */
const CLAY_BODY = { white: 'porcelain', off_white: 'stoneware', pink: 'red_body' } as const;

function tileImage(tile: SampleTile): string {
  const [base, pool] = tile.colours;
  const sheen = tile.surface === 'glossy' ? 0.5 : tile.surface === 'satin' ? 0.22 : 0.06;
  // Ids are unique per tile: the mobile app draws these inline, where shared ids would collide.
  const glaze = `g${tile.id.slice(0, 8)}`;
  const shine = `s${tile.id.slice(0, 8)}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">` +
    `<defs><radialGradient id="${glaze}" cx="40%" cy="34%" r="85%"><stop offset="0" stop-color="${pool}"/><stop offset="1" stop-color="${base}"/></radialGradient>` +
    `<linearGradient id="${shine}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${sheen}"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>` +
    `<rect width="400" height="400" fill="#d9d6d0"/>` +
    `<rect x="48" y="48" width="304" height="304" rx="8" fill="${BODY_COLOUR[tile.variant]}"/>` +
    `<rect x="48" y="48" width="304" height="250" rx="8" fill="url(#${glaze})"/>` +
    `<rect x="48" y="48" width="304" height="250" rx="8" fill="url(#${shine})"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const NO_SCHEDULE = 'Exact firing schedule was not recorded.';
const NO_COOLING = 'Cooling rate is unknown; slow cooling changes matte surfaces noticeably.';
const THICKNESS = 'Application thickness was not measured.';

const tiles: SampleTile[] = [
  { id: uid(), label: 'Glossy clear', colours: ['#d8d4c8', '#f2f0e8'], variant: 'white', surface: 'glossy', opacity: 'transparent', colourFamily: 'clear', cone: 6, atmosphere: 'oxidation', umf: { Na2O: 0.18, K2O: 0.12, CaO: 0.52, MgO: 0.18, Al2O3: 0.35, B2O3: 0.2, SiO2: 3.2 }, limitations: [NO_SCHEDULE] },
  { id: uid(), label: 'Leach clear', colours: ['#cfd3c6', '#eceee4'], variant: 'white', surface: 'glossy', opacity: 'transparent', colourFamily: 'clear', cone: 10, atmosphere: 'reduction', umf: { K2O: 0.2, Na2O: 0.1, CaO: 0.7, Al2O3: 0.4, SiO2: 3.6 }, limitations: [THICKNESS] },
  { id: uid(), label: 'Celadon', colours: ['#8fae9b', '#c9ddce'], variant: 'white', surface: 'glossy', opacity: 'translucent', colourFamily: 'green', cone: 10, atmosphere: 'reduction', umf: { K2O: 0.18, Na2O: 0.08, CaO: 0.74, Al2O3: 0.42, SiO2: 3.9, Fe2O3: 0.02 }, limitations: [NO_SCHEDULE, THICKNESS] },
  { id: uid(), label: 'Tenmoku', colours: ['#23150f', '#6b3519'], variant: 'off_white', surface: 'glossy', opacity: 'opaque', colourFamily: 'brown', cone: 10, atmosphere: 'reduction', umf: { K2O: 0.2, Na2O: 0.1, CaO: 0.6, MgO: 0.1, Al2O3: 0.38, SiO2: 3.4, Fe2O3: 0.12 }, limitations: [THICKNESS] },
  { id: uid(), label: 'Shino', colours: ['#d9b89a', '#f1e3d0'], variant: 'off_white', surface: 'satin', opacity: 'opaque', colourFamily: 'white', cone: 10, atmosphere: 'reduction', umf: { Na2O: 0.5, K2O: 0.2, Li2O: 0.1, CaO: 0.1, MgO: 0.1, Al2O3: 1.0, SiO2: 4.5 }, limitations: [NO_SCHEDULE] },
  { id: uid(), label: 'Copper red', colours: ['#6d1414', '#b53a2c'], variant: 'white', surface: 'glossy', opacity: 'translucent', colourFamily: 'red', cone: 10, atmosphere: 'reduction', umf: { K2O: 0.15, Na2O: 0.15, CaO: 0.6, MgO: 0.1, B2O3: 0.15, Al2O3: 0.3, SiO2: 3.2, CuO: 0.01, SnO2: 0.01 }, limitations: [NO_SCHEDULE, 'Reduction timing strongly affects copper reds.'] },
  { id: uid(), label: 'Chun blue', colours: ['#7f9fc0', '#c5d6e6'], variant: 'off_white', surface: 'glossy', opacity: 'translucent', colourFamily: 'blue', cone: 9, atmosphere: 'reduction', umf: { K2O: 0.2, Na2O: 0.1, CaO: 0.65, MgO: 0.05, Al2O3: 0.28, SiO2: 4.2, P2O5: 0.03, Fe2O3: 0.015 }, limitations: [THICKNESS] },
  { id: uid(), label: 'Ash glaze', colours: ['#7c7a4c', '#b9b582'], variant: 'off_white', surface: 'glossy', opacity: 'translucent', colourFamily: 'green', cone: 10, atmosphere: 'reduction', umf: { K2O: 0.12, Na2O: 0.05, CaO: 0.7, MgO: 0.13, Al2O3: 0.3, SiO2: 2.6, P2O5: 0.05, Fe2O3: 0.03 }, limitations: ['Wood ash varies from batch to batch.'] },
  { id: uid(), label: 'Floating blue', colours: ['#1f3f7a', '#6b96d2'], variant: 'white', surface: 'glossy', opacity: 'opaque', colourFamily: 'blue', cone: 6, atmosphere: 'oxidation', umf: { Na2O: 0.2, K2O: 0.05, CaO: 0.6, MgO: 0.15, B2O3: 0.4, Al2O3: 0.3, SiO2: 2.6, Fe2O3: 0.02, CoO: 0.02, TiO2: 0.08 }, limitations: [NO_COOLING] },
  { id: uid(), label: 'Cobalt blue', colours: ['#12256b', '#2f55b8'], variant: 'white', surface: 'glossy', opacity: 'opaque', colourFamily: 'blue', cone: 6, atmosphere: 'oxidation', umf: { Na2O: 0.2, K2O: 0.1, CaO: 0.55, MgO: 0.15, B2O3: 0.25, Al2O3: 0.36, SiO2: 3.1, CoO: 0.03 }, limitations: [NO_SCHEDULE] },
  { id: uid(), label: 'Rutile blue', colours: ['#3d5f7d', '#9bb7c4'], variant: 'off_white', surface: 'satin', opacity: 'opaque', colourFamily: 'blue', cone: 6, atmosphere: 'oxidation', umf: { Na2O: 0.15, K2O: 0.1, CaO: 0.55, MgO: 0.2, B2O3: 0.3, Al2O3: 0.33, SiO2: 2.9, TiO2: 0.12, Fe2O3: 0.02 }, limitations: [NO_COOLING, THICKNESS] },
  { id: uid(), label: 'Satin matte white', colours: ['#dcd8cf', '#efece5'], variant: 'white', surface: 'satin', opacity: 'opaque', colourFamily: 'white', cone: 6, atmosphere: 'oxidation', umf: { Na2O: 0.1, K2O: 0.1, CaO: 0.5, MgO: 0.3, Al2O3: 0.45, B2O3: 0.15, SiO2: 2.5 }, limitations: [NO_COOLING] },
  { id: uid(), label: 'Magnesium matte', colours: ['#cfc6b3', '#e6dfd0'], variant: 'pink', surface: 'matte', opacity: 'opaque', colourFamily: 'white', cone: 6, atmosphere: 'oxidation', umf: { Na2O: 0.08, K2O: 0.12, CaO: 0.38, MgO: 0.42, Al2O3: 0.4, B2O3: 0.1, SiO2: 2.3 }, limitations: [NO_COOLING] },
  { id: uid(), label: 'Strontium matte turquoise', colours: ['#2f8a86', '#7fc7bd'], variant: 'white', surface: 'matte', opacity: 'opaque', colourFamily: 'green', cone: 6, atmosphere: 'oxidation', umf: { Na2O: 0.15, K2O: 0.1, SrO: 0.4, CaO: 0.25, Li2O: 0.1, Al2O3: 0.42, SiO2: 2.4, CuO: 0.03 }, limitations: [NO_COOLING, 'Copper mattes are not suitable for food surfaces without testing.'] },
  { id: uid(), label: 'Oribe green', colours: ['#1f5a3a', '#4f9a67'], variant: 'off_white', surface: 'glossy', opacity: 'translucent', colourFamily: 'green', cone: 6, atmosphere: 'oxidation', umf: { Na2O: 0.2, K2O: 0.1, CaO: 0.6, MgO: 0.1, B2O3: 0.3, Al2O3: 0.3, SiO2: 2.8, CuO: 0.05 }, limitations: [THICKNESS] },
  { id: uid(), label: 'Honey amber', colours: ['#8c5a14', '#d39a3a'], variant: 'white', surface: 'glossy', opacity: 'transparent', colourFamily: 'yellow', cone: 6, atmosphere: 'oxidation', umf: { Na2O: 0.2, K2O: 0.1, CaO: 0.55, MgO: 0.15, B2O3: 0.3, Al2O3: 0.33, SiO2: 3.0, Fe2O3: 0.05 }, limitations: [NO_SCHEDULE] },
  { id: uid(), label: 'Iron red', colours: ['#6a2413', '#b4522c'], variant: 'off_white', surface: 'satin', opacity: 'opaque', colourFamily: 'red', cone: 6, atmosphere: 'oxidation', umf: { Na2O: 0.1, K2O: 0.15, CaO: 0.45, MgO: 0.3, B2O3: 0.2, Al2O3: 0.3, SiO2: 2.9, Fe2O3: 0.14, P2O5: 0.06 }, limitations: [NO_COOLING, 'Colour depends on a slow cool through 900 °C.'] },
  { id: uid(), label: 'Tin white majolica', colours: ['#e3e0d9', '#f6f4ef'], variant: 'pink', surface: 'glossy', opacity: 'opaque', colourFamily: 'white', cone: -4, atmosphere: 'oxidation', umf: { Na2O: 0.3, K2O: 0.05, CaO: 0.65, B2O3: 0.6, Al2O3: 0.25, SiO2: 2.2, SnO2: 0.08 }, limitations: [NO_SCHEDULE] },
];

/**
 * Each sample tile stands for its own recipe, coded the way the lab codes them. The last few have a name but no
 * code, like most of the imported corpus.
 */
const UNCODED_FROM = tiles.length - 3;
const tileRecipe = new Map(
  tiles.map((tile, i) => [
    tile.id,
    {
      recipeId: uid(),
      recipeCode: i < UNCODED_FROM ? `P01-B${Math.floor(i / 3) + 1}-${String((i % 3) + 1).padStart(3, '0')}` : null,
      recipeName: i < UNCODED_FROM ? tile.label : `${tile.label} ∆6 · Lab 2 · Without Colorants`,
    },
  ]),
);

// ─── Search ───────────────────────────────────────────────────────────────────

const searches = new Map<string, RecipeImageSearchResponse>();

/** Ruzicka similarity: shared amount over combined amount, across the fixed oxide order. */
function chemistrySimilarity(a: Umf, b: Umf): number {
  let shared = 0;
  let total = 0;
  for (const oxide of OXIDES) {
    const x = a[oxide] ?? 0;
    const y = b[oxide] ?? 0;
    shared += Math.min(x, y);
    total += Math.max(x, y);
  }
  return total === 0 ? 0 : shared / total;
}

// Stable pseudo-random number in [0, 1) from a string, so the same recipe ranks the same way twice.
function seeded(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

function bandFor(score: number): ConfidenceBand {
  if (score >= 0.75) return 'high';
  if (score >= 0.6) return 'medium';
  return 'low';
}

const MIN_CONFIDENCE = 0.45;

function runSearch(req: RecipeImageSearchRequest): RecipeImageSearchResponse {
  const { query, firing, filters } = req;

  let signature = '';
  let umf: Umf | null = query.type === 'umf' ? query.umf : null;
  // Stains have no oxide analysis, so they're compared by name and amount instead. Null when unknown.
  let colourants: Colourant[] | null = null;
  // Every colorant, metallic oxides and stains, for showing; per 100 parts of the rest of the recipe, as the API does.
  let colorantMaterials: ColorantMaterial[] | null = null;
  let recipeCode: string | null = null;
  const warnings: string[] = [];
  if (query.type === 'raw_recipe') {
    if (query.materials.length === 0) throw new ApiError(400, 'Add at least one material to the recipe.');
    // As the API does: every row must be a known material, or the whole search is turned down.
    const found = query.materials.map((m) => findMockMaterial(m.materialId, m.rawName));
    const resolutions = query.materials.map((m, i) => ({
      // Counted from 1, as the API does.
      position: i + 1,
      rawName: m.rawName ?? m.materialId ?? null,
      status: found[i] ? 'resolved' : 'unresolved',
      suggestions: found[i] ? [] : suggestMockMaterials(m.rawName ?? m.materialId ?? '').map((s) => s.name),
    }));
    if (resolutions.some((r) => r.status !== 'resolved')) {
      throw new ApiError(422, 'Some materials in the recipe weren’t recognised.', { title: 'Some materials in the recipe weren’t recognised.', status: 422, code: 'materials_unresolved', resolutions });
    }
    const calc = calculateUmf({ rows: query.materials.map((m) => ({ materialId: m.materialId, material: m.rawName, amount: m.amount })) });
    if (!calc.result || calc.result.fluxSum <= 0) {
      throw new ApiError(422, 'This recipe has no flux, so its chemistry can’t be compared.', { title: 'This recipe has no flux.', status: 422, code: 'zero_flux' });
    }
    umf = calc.result.umf ?? {};
    const base = query.materials.reduce((sum, m, i) => sum + (found[i]?.hasAnalysis ? m.amount : 0), 0);
    colourants = query.materials.flatMap((m, i) => {
      const material = found[i]!;
      if (material.hasAnalysis) return [];
      warnings.push(`no_oxide_analysis:${material.name}`);
      return [{ materialId: material.id, name: material.name, percentOfBase: round((m.amount / base) * 100) }];
    });
    const kindOf = (category: string | null | undefined): ColorantMaterial['kind'] | null => (category === 'colorant' ? 'metallic_oxide' : category === 'stain' ? 'stain' : null);
    const rest = query.materials.reduce((sum, m, i) => sum + (kindOf(found[i]!.category) ? 0 : m.amount), 0);
    colorantMaterials = query.materials
      .flatMap((m, i) => {
        const kind = kindOf(found[i]!.category);
        return kind && rest > 0 ? [{ materialId: found[i]!.id ?? '', name: found[i]!.name ?? '', kind, percentOfBase: round((m.amount / rest) * 100) }] : [];
      })
      .sort((a, b) => b.percentOfBase - a.percentOfBase);
    signature = query.materials.map((m) => `${m.materialId ?? m.rawName}:${m.amount}`).join('|');
  } else if (query.type === 'umf') {
    if (!Object.values(query.umf).some((v) => (v ?? 0) > 0)) throw new ApiError(400, 'Enter at least one oxide amount.');
  } else {
    // A stored recipe: here, one of the sample tiles' recipes.
    const tile = tiles.find((t) => {
      const recipe = tileRecipe.get(t.id)!;
      return recipe.recipeId === query.recipeId || (!!recipe.recipeCode && recipe.recipeCode === query.recipeCode);
    });
    if (!tile) throw new ApiError(404, 'That recipe was not found.', { status: 404, code: 'recipe_not_found', detail: 'That recipe was not found.' });
    umf = tile.umf;
    colourants = [];
    colorantMaterials = [];
    recipeCode = tileRecipe.get(tile.id)!.recipeCode;
  }

  const candidates = tiles.filter(
    (t) =>
      (!filters?.clayBodies?.length || filters.clayBodies.includes(CLAY_BODY[t.variant])) &&
      (!filters?.tileVariantKeys?.length || filters.tileVariantKeys.includes(t.variant)) &&
      (!filters?.surface?.length || filters.surface.includes(t.surface)) &&
      (!filters?.colourFamily?.length || filters.colourFamily.includes(t.colourFamily)),
  );

  const hasCone = firing.coneMin !== null || firing.coneMax !== null;
  const lo = firing.coneMin ?? firing.coneMax ?? 0;
  const hi = firing.coneMax ?? firing.coneMin ?? 0;
  // Strict firing, on by default as in the API: only tiles within ±1 cone (01 and 1 are neighbours) and the same atmosphere.
  const strict = hasCone || firing.atmosphere !== null;
  const low = lo - 1 - (lo > 0 && lo - 1 <= 0 ? 1 : 0);
  const high = hi + 1 + (hi < 0 && hi + 1 >= 0 ? 1 : 0);
  const firedThisWay = (tile: (typeof tiles)[number]) =>
    !strict || ((!hasCone || (tile.cone >= low && tile.cone <= high)) && (firing.atmosphere === null || tile.atmosphere === firing.atmosphere));

  const scored = candidates.filter(firedThisWay).map((tile) => {
    const chemistry = umf ? chemistrySimilarity(umf, tile.umf) : 0.42 + seeded(signature + tile.label) * 0.5;

    let firingScore: number | null = null;
    const coneInRange = hasCone && tile.cone >= lo && tile.cone <= hi;
    const sameAtmosphere = firing.atmosphere !== null && firing.atmosphere === tile.atmosphere;
    if (hasCone || firing.atmosphere !== null) {
      const distance = !hasCone || coneInRange ? 0 : Math.min(Math.abs(tile.cone - lo), Math.abs(tile.cone - hi));
      firingScore = Math.max(0, 1 - distance * 0.22);
      if (firing.atmosphere !== null && !sameAtmosphere) firingScore *= 0.5;
    }

    const label = 0.55 + seeded(`label${signature}${tile.label}`) * 0.35;
    // The sample tiles have no stains: the same as a recipe without any, unlike one with some.
    const colourant = colourants === null ? null : colourants.length === 0 ? 1 : 0;

    // Weights from the PRD; a missing dimension is dropped and the rest are renormalised.
    const parts: [number | null, number][] = [
      [chemistry, 0.55],
      [firingScore, 0.2],
      [label, 0.15],
      [null, 0.1],
    ];
    const available = parts.filter(([value]) => value !== null) as [number, number][];
    const weight = available.reduce((sum, [, w]) => sum + w, 0);
    const score = available.reduce((sum, [value, w]) => sum + value * w, 0) / weight;

    const matched: string[] = [];
    if (coneInRange) matched.push('cone');
    if (sameAtmosphere) matched.push('atmosphere');
    if (filters?.tileVariantKeys?.includes(tile.variant)) matched.push('tileVariant');
    if (filters?.surface?.includes(tile.surface)) matched.push('surface');
    if (chemistry >= 0.75) matched.push('fluxBalance');
    if (chemistry >= 0.82) matched.push('silicaAlumina');
    if (colourant === 1 && colourants!.length > 0) matched.push('colourants');

    return { tile, score, chemistry, firingScore, label, colourant, matched };
  });

  const stains = (colourants ?? []).map((c) => `${c.percentOfBase}% ${c.name}`).join(', ');
  const ordered: SearchResultItem[] = scored
    .filter((s) => s.score >= MIN_CONFIDENCE)
    .sort((a, b) => b.score - a.score)
    .map((s, index) => ({
      rank: index + 1,
      resultType: 'real_tile',
      imageId: s.tile.id,
      displayUrl: tileImage(s.tile),
      thumbnailUrl: tileImage(s.tile),
      score: round(s.score),
      confidenceBand: bandFor(s.score),
      scoreBreakdown: {
        chemistrySimilarity: round(s.chemistry),
        firingCompatibility: s.firingScore === null ? null : round(s.firingScore),
        labelOrTextSimilarity: round(s.label),
        imageSimilarity: null,
        colourantSimilarity: s.colourant,
      },
      matchedFields: s.matched,
      tile: { variant: s.tile.variant, surface: s.tile.surface, opacity: s.tile.opacity, colourFamily: s.tile.colourFamily, clayBody: CLAY_BODY[s.tile.variant] },
      firing: { coneMin: s.tile.cone, coneMax: s.tile.cone, atmosphere: s.tile.atmosphere },
      source: req.includeRecipeMetadata
        ? { recordType: 'approved_image', ...tileRecipe.get(s.tile.id)!, metadataVisibility: 'recipe' }
        : { recordType: 'approved_image', recipeId: null, recipeCode: null, recipeName: null, metadataVisibility: 'image_only' },
      limitations: s.colourant === 0 ? [`Colorants differ: you searched ${stains}; this tile has none.`, ...s.tile.limitations] : s.tile.limitations,
    }));

  // As the API does: when nothing clears the bar, no weak matches are sent at all.
  const reliable = ordered.some((item) => item.confidenceBand !== 'low');
  if (!reliable) ordered.length = 0;
  const items = ordered.slice(0, req.topK);
  const response: RecipeImageSearchResponse = {
    searchId: uid(),
    query: {
      type: query.type,
      inputHash: `sha256:${seeded(JSON.stringify(query)).toString(16).slice(2)}`,
      calculationProfile: 'glazion-umf-v1',
      recipeCode,
      umf: umf && Object.fromEntries(Object.entries(umf).map(([oxide, value]) => [oxide, round(value ?? 0)])),
      colourants,
      colorantMaterials,
    },
    ranker: { version: 'hybrid-ranker-1.1.0', candidateCount: candidates.length, returnedCount: items.length, minimumConfidence: MIN_CONFIDENCE },
    items,
    closestMatch: items[0] ?? null,
    // Each sample tile is its own recipe, so the other recipes are simply the other tiles.
    similar: ordered.slice(1, 9),
    warnings: reliable ? warnings : [...warnings, 'no_reliable_match'],
    createdAt: new Date().toISOString(),
  };
  searches.set(response.searchId, response);
  // As the API answers a regular user: the match without the chemistry behind it (meeting 2026-10-29).
  return forRegularUser(response);
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

interface CannedAnswer {
  content: string;
  sources?: Omit<ChatSource, 'id'>[];
  confidence?: ConfidenceBand;
  tool?: 'search' | 'material';
}

function answerFor(question: string): CannedAnswer {
  const q = question.toLowerCase();

  if (/(food|lead|toxic|safe|leach)/.test(q)) {
    return {
      confidence: 'low',
      content:
        'I can’t tell you a glaze is food safe from its recipe alone. Chemistry gives warning signs, such as a low silica-to-alumina ratio, heavy colourant loads like copper or manganese, or an under-fired matte surface. The only way to know is a leach test on your fired ware from a lab.\n\nIf you share the recipe and cone, I can point out which of those warning signs apply.',
      sources: [{ kind: 'knowledge', title: 'Glaze durability and leaching', snippet: 'Stable glazes are well melted and have enough silica and alumina; colourant oxides above a few percent raise the risk of leaching.' }],
    };
  }

  if (q.includes('craz')) {
    return {
      confidence: 'high',
      content:
        'Crazing means the glaze shrinks more than the clay body as the pot cools, so the glaze ends up stretched and cracks.\n\nTo fix it in the glaze:\n1. Raise silica. It is the most effective and least disruptive change.\n2. Swap some sodium and potassium, which have high expansion, for magnesium, lithium or boron.\n3. Apply the glaze a little thinner.\n\nIf the glaze is right for other bodies, the body may be the problem: more silica in the body, or firing it to full maturity, also closes the gap.',
      sources: [
        { kind: 'knowledge', title: 'Crazing and thermal expansion', snippet: 'A glaze under tension crazes. Lowering glaze expansion or raising body expansion removes the mismatch.' },
        { kind: 'material', title: 'Silica', snippet: 'Lowers glaze expansion and raises melting temperature; fine mesh sizes dissolve more completely.' },
      ],
    };
  }

  if (q.includes('matt') || q.includes('silica') || q.includes('alumina') || q.includes('ratio')) {
    return {
      confidence: 'medium',
      content:
        'The silica-to-alumina ratio in the UMF is the quickest guide to surface. As a rough rule, glossy glazes sit somewhere around 7:1 to 10:1 and mattes fall below about 5:1, because the extra alumina stiffens the melt and stops it levelling into a glass.\n\nThere is a second kind of matte that comes from crystals instead: high magnesium, calcium, strontium or barium with a slow cool. Those can look matte at a ratio that would otherwise be glossy, and they change a lot with cooling speed.\n\nThese ranges shift with cone and boron level, so treat them as a starting point and test.',
      sources: [{ kind: 'knowledge', title: 'Silica:alumina ratio and surface', snippet: 'Ratios are a guide, not a rule; flux type and cooling rate move the boundary between gloss and matte.' }],
    };
  }

  if (q.includes('gerstley') || q.includes('substitut') || q.includes('replace')) {
    return {
      confidence: 'medium',
      tool: 'material',
      content:
        'Gerstley borate is a natural calcium-sodium borate that varies from batch to batch, which is why people look for replacements.\n\nTwo common routes:\n1. Gillespie Borate, made as a direct stand-in. Usually a 1:1 swap, then test.\n2. A boron frit such as Ferro 3134. This is not 1:1: the frit has no alumina and no clay-like behaviour, so you rebalance with kaolin and recheck the whole recipe.\n\nEither way, compare the UMF before and after so boron, calcium and sodium stay where they were. Gerstley also keeps a slurry suspended; with a frit you may need a little bentonite.',
      sources: [
        { kind: 'material', title: 'Gerstley Borate', snippet: 'Variable natural source of boron, calcium and sodium. Gels the slurry.' },
        { kind: 'material', title: 'Ferro Frit 3134', snippet: 'High-boron, alumina-free frit supplying calcium and sodium.' },
      ],
    };
  }

  if (/(look like|tile|photo|image|find|similar|show me)/.test(q)) {
    return {
      confidence: 'medium',
      tool: 'search',
      content:
        'I searched the tile library using a typical glossy cone 6 base as the starting chemistry. Open the results to see the closest fired tiles and how each one scored.\n\nFor a search on your own glaze, give me the recipe or its UMF and the cone and atmosphere you fire to. A close match shows what similar chemistry has done before; it isn’t a promise yours will fire the same.',
    };
  }

  return {
    confidence: 'low',
    content:
      'I can help with that, but I need a bit more to give you something useful. Can you tell me:\n\n1. The cone and atmosphere you fire to\n2. The recipe, or its UMF if you have it\n3. What you’re seeing on the fired piece, or what you want to change\n\nWith those I can look at the chemistry instead of guessing.',
  };
}

const CHEMISTRY_FIELDS = ['fluxBalance', 'silica', 'alumina', 'boron', 'silicaAlumina', 'silicaAluminaRatio'];
const CHEMISTRY_WORDS = /chemistry|umf|calculation profile|oxide|unmeasured/i;

function hideWhy(item: SearchResultItem): SearchResultItem {
  return {
    ...item,
    scoreBreakdown: { chemistrySimilarity: null, firingCompatibility: null, labelOrTextSimilarity: null, imageSimilarity: null, colourantSimilarity: null },
    matchedFields: item.matchedFields.filter((f) => !CHEMISTRY_FIELDS.includes(f)),
    limitations: item.limitations.filter((l) => !CHEMISTRY_WORDS.test(l)),
  };
}

function forRegularUser(response: RecipeImageSearchResponse): RecipeImageSearchResponse {
  return {
    ...response,
    query: { ...response.query, umf: null },
    items: response.items.map(hideWhy),
    closestMatch: response.closestMatch ? hideWhy(response.closestMatch) : null,
    similar: response.similar?.map(hideWhy),
  };
}

function message(role: ChatMessage['role'], content: string, minutes = 0, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: uid(), role, content, createdAt: ago(minutes), ...extra };
}

function buildAnswer(question: string): ChatMessage {
  const canned = answerFor(question);
  const toolCalls: ChatToolCall[] = [];
  if (canned.tool === 'search') {
    const result = runSearch({
      query: { type: 'umf', umf: { Na2O: 0.18, K2O: 0.12, CaO: 0.52, MgO: 0.18, Al2O3: 0.35, B2O3: 0.2, SiO2: 3.2 } },
      firing: { coneMin: 6, coneMax: 6, atmosphere: 'oxidation' },
      topK: 12,
    });
    toolCalls.push({ name: 'search_recipe_images', summary: `Searched the tile library and found ${result.items.length} tiles`, searchId: result.searchId });
  }
  if (canned.tool === 'material') toolCalls.push({ name: 'get_material', summary: 'Looked up Gerstley Borate and Ferro Frit 3134' });

  return message('assistant', canned.content, 0, {
    confidence: canned.confidence,
    sources: canned.sources?.map((source) => ({ id: uid(), ...source })),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  });
}

const seedQuestion = 'Why is my celadon crazing on porcelain?';
const conversations: Conversation[] = [
  {
    id: uid(),
    title: 'Celadon crazing on porcelain',
    createdAt: ago(60 * 26),
    updatedAt: ago(60 * 26 - 1),
    messages: [message('user', seedQuestion, 60 * 26), { ...buildAnswer(seedQuestion), createdAt: ago(60 * 26 - 1) }],
  },
];

const summary = ({ messages, ...rest }: Conversation): ConversationSummary => rest;

function findConversation(id: string): Conversation {
  const found = conversations.find((c) => c.id === id);
  if (!found) throw new ApiError(404, 'That conversation no longer exists.');
  return found;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function handleSampleRequest(method: string, path: string, query: ApiQuery | undefined, body: any): Promise<unknown> {
  const route = `${method} ${path.replace(/^\/api\/v2/, '')}`;
  const id = route.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0] ?? '';
  const shape = id ? route.replace(id, ':id') : route;
  await wait(shape.endsWith('/messages') ? 900 + Math.random() * 700 : 300 + Math.random() * 300);

  switch (shape) {
    case 'POST /recipe-image/search':
      return runSearch(body as RecipeImageSearchRequest);
    case 'GET /recipe-image/search/:id': {
      const found = searches.get(id);
      if (!found) throw new ApiError(404, 'That search is no longer available. Run it again to see results.');
      return forRegularUser(found);
    }
    case 'POST /recipe-image/feedback':
      return undefined;
    case 'GET /recipe-image/settings':
      return { strictFiring: true, updatedAt: null };

    case 'GET /conversations': {
      // Paged like the API: the cursor here is simply the offset of the next page.
      const all = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summary);
      const start = Number(query?.cursor ?? 0) || 0;
      const size = Math.max(1, Number(query?.pageSize ?? 20) || 20);
      const end = start + size;
      return { items: all.slice(start, end), totalCount: all.length, nextCursor: end < all.length ? String(end) : null };
    }
    case 'POST /conversations': {
      const now = new Date().toISOString();
      const title = String(body?.title ?? '').trim() || 'New conversation';
      const created: Conversation = { id: uid(), title, createdAt: now, updatedAt: now, messages: [] };
      conversations.push(created);
      return created;
    }
    case 'GET /conversations/:id':
      return findConversation(id);
    case 'PATCH /conversations/:id': {
      const conversation = findConversation(id);
      conversation.title = String(body?.title ?? '').trim() || conversation.title;
      return summary(conversation);
    }
    case 'DELETE /conversations/:id': {
      const index = conversations.findIndex((c) => c.id === id);
      if (index >= 0) conversations.splice(index, 1);
      return undefined;
    }
    case 'POST /conversations/:id/messages': {
      const conversation = findConversation(id);
      const content = String(body?.content ?? '').trim();
      if (!content) throw new ApiError(400, 'Write a message first.');
      const userMessage = message('user', content);
      const assistantMessage = buildAnswer(content);
      if (conversation.messages.length === 0 && conversation.title === 'New conversation') conversation.title = content.length > 48 ? `${content.slice(0, 48).trimEnd()}…` : content;
      conversation.messages.push(userMessage, assistantMessage);
      conversation.updatedAt = assistantMessage.createdAt;
      return { userMessage, assistantMessage, conversation: summary(conversation) };
    }
    case 'POST /chat/feedback':
      return undefined;

    case 'POST /auth/register':
      if (String(body?.username ?? '').toLowerCase() === 'admin') throw new ApiError(409, 'That username is already taken.', { code: 'username_taken', detail: 'That username is already taken.' });
      return { userId: uid(), accountStatus: AccountStatus.Pending };
    case 'POST /auth/forgot-password':
      return undefined;
  }

  throw new ApiError(404, `No sample data for ${route}`);
}
