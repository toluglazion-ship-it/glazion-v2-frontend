// The API marks most search fields nullable and spells some values its own way; normaliseSearch
// turns whatever comes back into the shapes the screens expect.
import { beforeAll, expect, it } from 'vitest';

let normaliseSearch: typeof import('../src/main').normaliseSearch;
let findResult: typeof import('../src/main').findResult;
let searchApi: typeof import('../src/main').searchApi;
beforeAll(async () => {
  // The client keeps its session in browser storage; a stand-in is enough to load it here.
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  ({ normaliseSearch, findResult, searchApi } = await import('../src/main'));
});

it('copes with the API’s nullable and differently spelled fields', () => {
  const raw: any = {
    searchId: 's1',
    query: { type: 'umf', inputHash: 'h', calculationProfile: null },
    ranker: null,
    warnings: null,
    createdAt: '2026-10-06T00:00:00Z',
    items: [
      { rank: 1, resultType: 'Real_Tile', imageId: 'a', displayUrl: null, thumbnailUrl: 'https://t/1.jpg', score: 73, confidenceBand: 'HIGH',
        scoreBreakdown: { chemistrySimilarity: 81, firingCompatibility: 0.5, labelOrTextSimilarity: null, imageSimilarity: null, chemistryCosine: 0.9 },
        matchedFields: null, tile: null, firing: { coneMin: 6, coneMax: 6, atmosphere: 'Oxidation' }, source: null, limitations: null },
      { rank: 2, resultType: 'SYNTHETIC_PREVIEW', imageId: 'b', displayUrl: 'https://d/2.jpg', thumbnailUrl: null, score: 0.4, confidenceBand: 'weird',
        scoreBreakdown: null, matchedFields: ['cone'], tile: { variant: 'white', surface: 'glossy', opacity: null, colourFamily: 'blue' },
        firing: null, source: { recordType: 'import', recipeId: null, recipeCode: 'A03-B2-009', metadataVisibility: 'public' }, limitations: [] },
    ],
  };
  const out = normaliseSearch(raw);
  const [a, b] = out.items;
  expect(out.warnings).toEqual([]);
  expect(out.ranker.candidateCount).toBe(0);
  expect(a.resultType).toBe('real_tile');
  expect(a.confidenceBand).toBe('high');
  expect(a.score).toBeCloseTo(0.73);
  expect(a.scoreBreakdown.chemistrySimilarity).toBeCloseTo(0.81);
  expect(a.scoreBreakdown.chemistryCosine).toBe(0.9);
  expect(a.displayUrl).toBe('https://t/1.jpg');
  expect(a.tile).toEqual({ variant: null, surface: null, opacity: null, colourFamily: null, clayBody: null });
  expect(a.firing.atmosphere).toBe('oxidation');
  expect(a.matchedFields).toEqual([]);
  expect(a.source.recipeId).toBeNull();
  expect(b.resultType).toBe('synthetic_preview');
  expect(b.confidenceBand).toBe('low');
  expect(b.thumbnailUrl).toBe('https://d/2.jpg');
  expect(b.scoreBreakdown.imageSimilarity).toBeNull();
  expect(b.firing).toEqual({ coneMin: null, coneMax: null, atmosphere: null });
  expect(b.source.recipeCode).toBe('A03-B2-009');
  // No recipeName from an older API or saved search; a name sent with stray spaces is tidied.
  expect(a.source.recipeName).toBeNull();
  expect(b.source.recipeName).toBeNull();
});

it('keeps the recipe name, trimmed, and treats a blank one as none', () => {
  const item = (recipeName: unknown): any => ({ rank: 1, resultType: 'real_tile', imageId: String(recipeName), score: 0.9, confidenceBand: 'high',
    source: { recordType: 'approved_image', recipeId: 'r', recipeCode: null, recipeName, metadataVisibility: 'recipe' } });
  const out = normaliseSearch({ searchId: 's', query: null, items: [item('  Absence ∆10 · Lab 1  '), item('   ')] } as any);
  expect(out.items.map((i) => i.source.recipeName)).toEqual(['Absence ∆10 · Lab 1', null]);
});

it('leaves an empty result empty', () => {
  const out = normaliseSearch({ searchId: 's', items: null, warnings: ['no_reliable_match'] } as any);
  expect(out.items).toEqual([]);
  expect(out.warnings).toEqual(['no_reliable_match']);
});

it('fills in the closest match, similar glazes and the chemistry the search used', () => {
  const tile = (imageId: string, score: number) => ({ rank: 1, resultType: 'real_tile', imageId, displayUrl: 'https://d', thumbnailUrl: 'https://t', score, confidenceBand: 'high',
    scoreBreakdown: { chemistrySimilarity: 1, firingCompatibility: 1, labelOrTextSimilarity: 1, imageSimilarity: null, colourantSimilarity: 50 }, matchedFields: ['colourants'],
    tile: { variant: 'white', surface: null, opacity: null, colourFamily: null, clayBody: 'porcelain' }, firing: { coneMin: 6, coneMax: 6, atmosphere: 'oxidation' },
    source: { recordType: 'approved_image', recipeId: 'r', recipeCode: 'P01-B1-005', metadataVisibility: 'recipe' }, limitations: [] });
  const raw: any = {
    searchId: 's2', createdAt: '2026-10-17T16:07:23Z', warnings: [], ranker: null, items: [tile('a', 0.99)], closestMatch: tile('a', 0.99), similar: [tile('z', 0.87)],
    query: { type: 'raw_recipe', inputHash: 'sha256:x', calculationProfile: 'glazion-umf-v1', recipeCode: null, umf: { SiO2: 3.6, CaO: 0.59 },
      colourants: [{ materialId: 'mason-stain-6001', name: 'Mason Stain 6001', percentOfBase: 2.4876 }],
      colorantMaterials: [{ materialId: 'mason-stain-6001', name: 'Mason Stain 6001', kind: 'stain', percentOfBase: 2.4876 }, { materialId: 'iron-oxide-red', name: 'Iron Oxide Red', kind: 'metallic_oxide', percentOfBase: 1 }] },
  };
  const out = normaliseSearch(raw);
  expect(out.closestMatch?.imageId).toBe('a');
  expect(out.similar.map((s) => s.imageId)).toEqual(['z']);
  expect(out.similar[0].scoreBreakdown.colourantSimilarity).toBeCloseTo(0.5);
  expect(out.query.umf).toEqual({ SiO2: 3.6, CaO: 0.59 });
  expect(out.query.colourants?.[0].percentOfBase).toBeCloseTo(2.4876);
  expect(out.query.colorantMaterials?.map((c) => c.kind)).toEqual(['stain', 'metallic_oxide']);
  // The similar tile isn't in items, and screens can still find it.
  expect(findResult(out, 'z')?.source.recipeCode).toBe('P01-B1-005');
  expect(findResult(out, 'nope')).toBeUndefined();
});

it('takes the best item as the closest match from a response that predates it', () => {
  const out = normaliseSearch({ searchId: 's', items: [{ imageId: 'a', score: 0.9 }], warnings: [] } as any);
  expect(out.closestMatch?.imageId).toBe('a');
  expect(out.similar).toEqual([]);
  expect(out.query).toEqual({ type: 'umf', inputHash: '', calculationProfile: null, recipeCode: null, umf: null, colourants: null, colorantMaterials: null });
  expect(normaliseSearch({ searchId: 's', items: [], closestMatch: null, warnings: ['no_reliable_match'] } as any).closestMatch).toBeNull();
});

it('sends the Idempotency-Key only when one is given', async () => {
  const sent: Headers[] = [];
  (globalThis as any).fetch = async (_url: string, init: RequestInit) => {
    sent.push(new Headers(init.headers));
    return new Response(JSON.stringify({ searchId: 's', items: [], warnings: [] }), { status: 200 });
  };
  const request = { query: { type: 'umf' as const, umf: { SiO2: 3 } }, firing: { coneMin: null, coneMax: null, atmosphere: null }, topK: 12 };
  await searchApi.run(request, 'key-1');
  // A mutation library passes its own context object second; that must not become a header.
  await (searchApi.run as any)(request, { client: {} });
  expect(sent[0].get('Idempotency-Key')).toBe('key-1');
  expect(sent[1].get('Idempotency-Key')).toBeNull();
});
