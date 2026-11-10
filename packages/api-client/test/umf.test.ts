// The calculator screens show what POST /umf/calculate returns, and the search form acts on the
// backend's 422s. These check the fake backend answers in the API's shapes, and the client reads
// the answers the way the screens expect.
import { beforeAll, expect, it } from 'vitest';
import { limitConeFor, limitConeText } from '@glazion/types';

let ApiError: typeof import('../src/index').ApiError;
let main: typeof import('../src/main');
let umf: typeof import('../src/mock-umf');
let recipes: typeof import('../src/recipes');
beforeAll(async () => {
  // The client keeps its session in browser storage; a stand-in is enough to load it here.
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  ({ ApiError } = await import('../src/index'));
  main = await import('../src/main');
  umf = await import('../src/mock-umf');
  recipes = await import('../src/recipes');
});

it('calculates by id or name and lists the rows it left out, by position', () => {
  const res = umf.calculateUmf({
    cone: '-6',
    rows: [
      { materialId: 'silica', amount: 30 },
      { material: 'EP Kaolin', amount: '10g' },
      { material: 'Potash Feldspar X', amount: 40 },
      { materialId: 'silica', amount: '' },
    ],
  });
  expect(res.cone).toBe('06');
  expect(res.skippedRows).toEqual([
    { index: 2, reason: 'unknown material', material: 'Potash Feldspar X' },
    { index: 3, reason: 'no amount', material: 'Silica' },
  ]);
  expect(res.result?.lines).toHaveLength(2);
  expect(res.limits?.every((l) => l.cone === '06')).toBe(true);
});

it('answers an empty recipe with result null rather than an error', () => {
  const res = umf.calculateUmf({ rows: [] });
  expect(res.result).toBeNull();
  expect(() => umf.calculateUmf({ rows: 'nope' })).toThrow(ApiError);
});

it('reads both 422s the search sends back', () => {
  const unresolved = new ApiError(422, 'x', { code: 'materials_unresolved', resolutions: [{ position: 1, rawName: 'Custr', status: 'unresolved', suggestions: [{ materialId: 'custer-feldspar', name: 'Custer Feldspar' }, 'Silica'] }] });
  expect(main.searchProblem(unresolved)).toEqual({
    code: 'materials_unresolved',
    resolutions: [{ position: 1, rawName: 'Custr', status: 'unresolved', suggestions: [{ materialId: 'custer-feldspar', name: 'Custer Feldspar' }, { materialId: null, name: 'Silica' }] }],
  });
  expect(main.searchProblem(new ApiError(422, 'x', { extensions: { code: 'zero_flux' } }))).toEqual({ code: 'zero_flux' });
  expect(main.searchProblem(new ApiError(400, 'x', { code: 'zero_flux' }))).toBeNull();
});

it('sends the id when a row has one, and the name for older saved recipes', () => {
  expect(recipes.calculatorRow({ material: 'Silica', materialId: 'silica', amount: '30' })).toEqual({ materialId: 'silica', amount: '30' });
  expect(recipes.calculatorRow({ material: 'Silica', amount: '30' })).toEqual({ material: 'Silica', amount: '30' });
  expect(recipes.limitStatus(0.2, { minUmf: 0.25, maxUmf: 0.45 })).toBe('under');
  expect(recipes.limitStatus(0.3, { minUmf: 0.25, maxUmf: 0.45 })).toBe('in');
  expect(recipes.limitStatus(0.5, undefined)).toBeNull();
});

it('compares a cone without target ranges with the nearest one that has them', () => {
  expect(limitConeFor('6')).toBe('6');
  expect(limitConeFor('06')).toBe('06');
  expect(limitConeFor('5')).toBe('6');
  expect(limitConeFor('04')).toBe('06');
  expect(limitConeFor('8')).toBe('9');
  expect(limitConeFor('12')).toBe('10');
  expect(limitConeText('10')).toBe('cone 10');
  expect(limitConeText('5')).toBe('cone 6, the nearest to cone 5');
});
