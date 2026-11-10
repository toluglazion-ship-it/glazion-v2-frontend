import { describe, expect, it } from 'vitest';
import { coneFromNumber, coneToNumber, findClosestConeByCelsius, getConeData } from '../src/cones';
import { LIMIT_CONES, limitsForCone } from '../src/limits';
import { findMaterial, normaliseMaterials, presentOxides, retotal, suggestOptimisations, toNumber, totalOf } from '../src/recipe';

const materials = normaliseMaterials([
  { name: 'Silica', oxideAnalysis: { SiO2: 100 }, loi: 0 },
  { name: 'Potash Feldspar', oxideAnalysis: { K2O: 16.9, Al2O3: 18.3, SiO2: 64.8 }, loi: 0 },
  { name: '  Padded Name  ', oxideAnalysis: {}, loi: 0 },
  { name: '', oxideAnalysis: {}, loi: 0 },
]);

describe('materials', () => {
  it('drops unnamed entries and trims the rest', () => {
    expect(materials.map((m) => m.name)).toEqual(['Silica', 'Potash Feldspar', 'Padded Name']);
  });

  it('finds a material whatever the capitals or spacing', () => {
    expect(findMaterial(materials, ' potash FELDSPAR ')?.name).toBe('Potash Feldspar');
    expect(findMaterial(materials, 'Potash')).toBeUndefined();
  });
});

describe('amounts', () => {
  it('reads numbers typed as text', () => {
    expect(toNumber('12.5')).toBe(12.5);
    expect(toNumber(' 7 ')).toBe(7);
    expect(toNumber('')).toBeNaN();
  });

  it('totals only the rows with a number', () => {
    expect(totalOf([{ material: 'a', amount: '40' }, { material: 'b', amount: '' }, { material: 'c', amount: 10 }])).toBe(50);
  });

  it('retotals to 100 with two decimals and leaves empty rows alone', () => {
    const rows = [
      { material: 'a', amount: '30' },
      { material: 'b', amount: '10' },
      { material: 'c', amount: '' },
    ];
    expect(retotal(rows, 40).map((row) => row.amount)).toEqual(['75', '25', '']);
    expect(retotal([{ material: 'a', amount: '1' }, { material: 'b', amount: '2' }], 3).map((row) => row.amount)).toEqual(['33.33', '66.67']);
  });

  it('does nothing when the total is zero', () => {
    const rows = [{ material: 'a', amount: '' }];
    expect(retotal(rows, 0)).toBe(rows);
  });
});

describe('cones', () => {
  it('writes cones below 1 as negative numbers and back', () => {
    expect(coneToNumber('06')).toBe(-6);
    expect(coneToNumber('05.5')).toBe(-5.5);
    expect(coneToNumber('10')).toBe(10);
    for (const cone of ['010', '06', '05.5', '1', '5.5', '12']) expect(coneFromNumber(coneToNumber(cone))).toBe(cone);
  });

  it('knows the temperature of a cone and the cone nearest a temperature', () => {
    expect(getConeData('6')?.celsius).toBe(1222);
    expect(findClosestConeByCelsius(1280).cone).toBe('10');
  });
});

describe('target ranges and suggestions', () => {
  it('has ranges for the four supported cones', () => {
    expect(LIMIT_CONES).toEqual(['06', '6', '9', '10']);
    expect(limitsForCone('6').length).toBeGreaterThan(0);
    expect(limitsForCone('7')).toEqual([]);
  });

  it('suggests the richest materials for an oxide that is out of range', () => {
    const limits = limitsForCone('6');
    const suggestions = suggestOptimisations({ SiO2: 6, Al2O3: 0.4, K2O: 0.2, CaO: 0.5 }, limits, materials, [{ materialId: 'silica', partsPct: 100 }]);
    const silica = suggestions.find((s) => s.oxide === 'SiO2')!;
    expect(silica.direction).toBe('decrease');
    expect(silica.target).toBe('2.00 - 4.00');
    expect(silica.materials[0]).toEqual({ name: 'Silica', oxideContent: 100, inRecipe: true });
    // Alumina, potash and lime are inside their ranges, so they aren't mentioned.
    expect(suggestions.map((s) => s.oxide)).toEqual(['SiO2']);
  });

  it('lists the oxides of a group that are present, largest first', () => {
    expect(presentOxides({ Na2O: 0.1, K2O: 0.3, Li2O: 0 }, ['Na2O', 'K2O', 'Li2O'])).toEqual([
      { oxide: 'K2O', value: 0.3 },
      { oxide: 'Na2O', value: 0.1 },
    ]);
  });
});
