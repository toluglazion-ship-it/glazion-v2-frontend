// The fake backend (VITE_USE_MOCKS=true) answers search the way the API does, so the screens can be
// built and checked without a login.
import { beforeAll, expect, it, vi } from 'vitest';

let main: typeof import('../src/main');
let ApiError: typeof import('../src/index').ApiError;
beforeAll(async () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  vi.stubEnv('VITE_USE_MOCKS', 'true');
  main = await import('../src/main');
  ({ ApiError } = await import('../src/index'));
});

const firing = { coneMin: 6, coneMax: 6, atmosphere: 'oxidation' as const };

it('returns the closest match, similar glazes and the stains, without the chemistry behind the match', async () => {
  const res = await main.searchApi.run({
    query: { type: 'raw_recipe', materials: [
      { rawName: 'Custer Feldspar', amount: 40, unit: '%' }, { rawName: 'Calcium Carbonate', amount: 20, unit: '%' },
      { rawName: 'EP Kaolin', amount: 20, unit: '%' }, { rawName: 'Silica', amount: 20, unit: '%' }, { rawName: 'Stain 6000', amount: 2.5, unit: '%' },
    ] },
    firing, topK: 3, includeRecipeMetadata: true,
  });
  expect(res.closestMatch?.imageId).toBe(res.items[0].imageId);
  expect(res.items.length).toBeLessThanOrEqual(3);
  expect(res.similar.length).toBeGreaterThan(0);
  expect(res.similar.some((s) => s.imageId === res.closestMatch?.imageId)).toBe(false);
  // A regular user sees the match, not how it was worked out (meeting 2026-10-29).
  expect(res.query.umf).toBeNull();
  expect(res.closestMatch?.scoreBreakdown.chemistrySimilarity).toBeNull();
  expect(res.closestMatch?.matchedFields).not.toContain('fluxBalance');
  expect(res.query.colourants).toEqual([{ materialId: expect.any(String), name: 'Stain 6000', percentOfBase: 2.5 }]);
  expect(res.warnings).toContain('no_oxide_analysis:Stain 6000');
  expect(res.closestMatch?.source.recipeCode).toMatch(/^P01-B\d+-\d{3}$/);

  // "Find tiles like this recipe" searches by the recipe a result came from.
  const again = await main.searchApi.run({ query: { type: 'recipe', recipeId: res.closestMatch!.source.recipeId! }, firing, topK: 3, includeRecipeMetadata: true });
  expect(again.query.recipeCode).toBe(res.closestMatch?.source.recipeCode);
});

it('counts unresolved rows from 1, as the API does', async () => {
  const err = await main.searchApi
    .run({ query: { type: 'raw_recipe', materials: [{ rawName: 'Silica', amount: 50, unit: '%' }, { rawName: 'Custr Feldspr', amount: 50, unit: '%' }] }, firing, topK: 3 })
    .catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  const problem = main.searchProblem(err);
  expect(problem?.code).toBe('materials_unresolved');
  expect(problem?.code === 'materials_unresolved' && problem.resolutions.find((r) => r.status === 'unresolved')?.position).toBe(2);
});
