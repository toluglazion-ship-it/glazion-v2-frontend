import { describe, expect, it } from 'vitest';
import { calculateRecipe, normaliseMaterials } from '../src/recipe';
import { recipeFileName, recipeToCsv, recipeToJson, recipeToText, sameRecipe, type RecipeDraft } from '../src/saved';

const materials = normaliseMaterials([
  { name: 'Silica', oxideAnalysis: { SiO2: 100 }, loi: 0 },
  { name: 'Potash Feldspar', oxideAnalysis: { K2O: 16.9, Al2O3: 18.3, SiO2: 64.8 }, loi: 0 },
  { name: 'Iron Oxide, Red', oxideAnalysis: { Fe2O3: 95 }, loi: 0 },
]);

const draft: RecipeDraft = {
  name: ' Test Glaze ',
  cone: '6',
  base: [
    { material: 'Potash Feldspar', amount: '70' },
    { material: 'Silica', amount: '30' },
    { material: '', amount: '' },
  ],
  colourants: [{ material: 'Iron Oxide, Red', amount: '4' }],
};
const chem = calculateRecipe([...draft.base, ...draft.colourants], materials)!.chem;

describe('saved recipes', () => {
  it('treats empty rows and stray spaces in the name as no change', () => {
    expect(sameRecipe(draft, { ...draft, name: 'Test Glaze', base: draft.base.slice(0, 2) })).toBe(true);
    expect(sameRecipe(draft, { ...draft, cone: '10' })).toBe(false);
    expect(sameRecipe(draft, { ...draft, base: [{ material: 'Silica', amount: '31' }] })).toBe(false);
  });

  it('names export files after the recipe', () => {
    expect(recipeFileName('Leach 4-3-2-1 (clear)', 'json')).toBe('leach-4-3-2-1-clear.json');
    expect(recipeFileName('   ', 'csv')).toBe('recipe.csv');
  });
});

describe('exports', () => {
  it('lists the filled rows with their group and rounds the analysis', () => {
    const json = recipeToJson(draft, chem);
    expect(json.name).toBe('Test Glaze');
    expect(json.materials).toEqual([
      { material: 'Potash Feldspar', amount: 70, group: 'base' },
      { material: 'Silica', amount: 30, group: 'base' },
      { material: 'Iron Oxide, Red', amount: 4, group: 'colourant' },
    ]);
    expect(json.analysis!.umf.K2O).toBe(1);
    expect(json.analysis!.silicaToAlumina).toBeCloseTo(chem.ratios.si_al!, 3);
  });

  it('exports without an analysis when there is nothing to calculate', () => {
    expect(recipeToJson({ ...draft, base: [], colourants: [] }, null).analysis).toBeNull();
    expect(recipeToCsv({ ...draft, base: [], colourants: [] }, null)).toBe('Recipe,Test Glaze\nCone,6\n\nMaterial,Amount,Group\n');
  });

  it('quotes CSV cells that contain a comma', () => {
    const csv = recipeToCsv(draft, chem);
    expect(csv).toContain('"Iron Oxide, Red",4,colourant');
    expect(csv).toContain('Oxide,UMF,Mole %,Analysis %');
    expect(csv.split('\n').find((line) => line.startsWith('K2O,'))).toMatch(/^K2O,1,/);
  });

  it('writes a readable text version', () => {
    const text = recipeToText(draft, chem);
    expect(text.split('\n')[0]).toBe('Test Glaze (cone 6)');
    expect(text).toContain('Iron Oxide, Red  4  (colourant)');
    expect(text).toContain('K2O  1.00');
  });
});
