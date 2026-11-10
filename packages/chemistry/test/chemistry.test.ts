// Pins the calculation to what the client agreed. fixtures.json was produced by running the
// GlazionStudio app's own code with its LOI step taken out, which is the one change they asked
// for. If one of these fails, a result has changed and the client needs to agree to it before the
// fixture is updated.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateRecipe, normaliseMaterials, type RecipeRow } from '../src/recipe';
import type { ChemistryResult, RawMaterial } from '../src/types';

interface Fixture {
  name: string;
  rows: RecipeRow[];
  expected: ChemistryResult | null;
}

const read = (file: string) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));

const materials = normaliseMaterials(read('../src/data/materials.json') as RawMaterial[]);
const fixtures = read('./fixtures.json') as Fixture[];

const VECTORS = ['moles', 'molePct', 'analysisPct', 'umf'] as const;

function expectSameVector(actual: Record<string, number | undefined>, expected: Record<string, number | undefined>) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [oxide, value] of Object.entries(expected)) {
    expect(actual[oxide], oxide).toBeCloseTo(value!, 10);
  }
}

describe('UMF calculation matches the agreed results', () => {
  it('has the full materials list', () => {
    expect(materials).toHaveLength(2830);
  });

  it.each(fixtures)('$name', ({ rows, expected }) => {
    const result = calculateRecipe(rows, materials, '6');

    if (expected === null) {
      expect(result).toBeNull();
      return;
    }

    const chem = result!.chem;
    for (const key of VECTORS) expectSameVector(chem[key], expected[key]);
    expect(chem.fluxSum).toBeCloseTo(expected.fluxSum, 10);
    expect(chem.cte).toBeCloseTo(expected.cte, 10);
    expect(chem.warnings).toEqual(expected.warnings);

    // JSON drops undefined, so a ratio that couldn't be worked out is simply missing.
    for (const ratio of ['si_al', 'alkali_over_alkaline', 'b2o3_pct'] as const) {
      if (expected.ratios[ratio] === undefined) expect(chem.ratios[ratio]).toBeUndefined();
      else expect(chem.ratios[ratio]).toBeCloseTo(expected.ratios[ratio], 10);
    }
  });
});

describe('UMF properties', () => {
  const leach = calculateRecipe(
    [
      { material: 'Custer Feldspar', amount: 40 },
      { material: 'Silica', amount: 30 },
      { material: 'Vapenec Whiting', amount: 20 },
      { material: 'Kaolin', amount: 10 },
    ],
    materials,
  )!.chem;

  it('uses the oxide percentages as given, without taking LOI off again', () => {
    // The figures shown to the client when the LOI step was dropped.
    expect(leach.umf.SiO2).toBeCloseTo(3.923, 3);
    expect(leach.umf.Al2O3).toBeCloseTo(0.402, 3);
    expect(leach.umf.CaO).toBeCloseTo(0.758, 3);
    expect(leach.umf.K2O).toBeCloseTo(0.161, 3);
  });

  it('scales the flux oxides to 1', () => {
    const flux = ['K2O', 'Na2O', 'Li2O', 'CaO', 'MgO', 'BaO', 'SrO', 'ZnO'] as const;
    const total = flux.reduce((sum, oxide) => sum + (leach.umf[oxide] ?? 0), 0);
    expect(total).toBeCloseTo(1, 12);
  });

  it('gives mole % and analysis % that each add up to 100', () => {
    const sum = (v: Record<string, number | undefined>) => Object.values(v).reduce<number>((a, b) => a + (b ?? 0), 0);
    expect(sum(leach.molePct)).toBeCloseTo(100, 9);
    expect(sum(leach.analysisPct)).toBeCloseTo(100, 9);
  });

  it('does not depend on the batch size', () => {
    const doubled = calculateRecipe(
      [
        { material: 'Custer Feldspar', amount: 80 },
        { material: 'Silica', amount: 60 },
        { material: 'Vapenec Whiting', amount: 40 },
        { material: 'Kaolin', amount: 20 },
      ],
      materials,
    )!.chem;
    expectSameVector(doubled.umf, leach.umf);
  });
});
