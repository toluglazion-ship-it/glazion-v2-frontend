import type { OxideDef } from './types';

export const OXIDES: OxideDef[] = [
  { symbol: 'SiO2', name: 'Silica', mw: 60.0843, roles: ['former'], colorant: false },
  { symbol: 'Al2O3', name: 'Alumina', mw: 101.961, roles: ['intermediate'], colorant: false },
  { symbol: 'B2O3', name: 'Boron oxide', mw: 69.62, roles: ['former', 'flux_RO'], colorant: false },
  { symbol: 'P2O5', name: 'Phosphorus pentoxide', mw: 141.944, roles: ['former'], colorant: false },

  { symbol: 'K2O', name: 'Potash', mw: 94.196, roles: ['flux_R2O'], colorant: false },
  { symbol: 'Na2O', name: 'Soda', mw: 61.979, roles: ['flux_R2O'], colorant: false },
  { symbol: 'Li2O', name: 'Lithia', mw: 29.881, roles: ['flux_R2O'], colorant: false },

  { symbol: 'CaO', name: 'Lime', mw: 56.077, roles: ['flux_RO'], colorant: false },
  { symbol: 'MgO', name: 'Magnesia', mw: 40.304, roles: ['flux_RO'], colorant: false },
  { symbol: 'BaO', name: 'Baryta', mw: 153.326, roles: ['flux_RO'], colorant: false },
  { symbol: 'SrO', name: 'Strontia', mw: 103.619, roles: ['flux_RO'], colorant: false },
  { symbol: 'ZnO', name: 'Zinc', mw: 81.379, roles: ['flux_RO', 'intermediate'], colorant: false },
  { symbol: 'PbO', name: 'Lead(II) oxide', mw: 223.199, roles: ['flux_RO'], colorant: false },

  { symbol: 'ZrO2', name: 'Zirconia', mw: 123.222, roles: ['intermediate', 'opacifier'], colorant: false },
  { symbol: 'TiO2', name: 'Titania', mw: 79.866, roles: ['intermediate', 'opacifier'], colorant: false },
  { symbol: 'SnO2', name: 'Tin oxide', mw: 150.71, roles: ['intermediate', 'opacifier'], colorant: false },

  { symbol: 'Fe2O3', name: 'Ferric oxide', mw: 159.687, roles: ['intermediate', 'colorant'], colorant: true },
  { symbol: 'FeO', name: 'Ferrous oxide', mw: 71.844, roles: ['flux_RO', 'colorant'], colorant: true },
  { symbol: 'MnO', name: 'Manganese(II) oxide', mw: 70.937, roles: ['flux_RO', 'colorant'], colorant: true },
  { symbol: 'CoO', name: 'Cobalt(II) oxide', mw: 74.932, roles: ['flux_RO', 'colorant'], colorant: true },
  { symbol: 'NiO', name: 'Nickel(II) oxide', mw: 74.692, roles: ['flux_RO', 'colorant'], colorant: true },
  { symbol: 'CuO', name: 'Copper(II) oxide', mw: 79.545, roles: ['flux_RO', 'colorant'], colorant: true },
  { symbol: 'Cr2O3', name: 'Chromium oxide', mw: 151.99, roles: ['intermediate', 'colorant'], colorant: true },
  { symbol: 'V2O5', name: 'Vanadium(V) oxide', mw: 181.88, roles: ['intermediate', 'colorant'], colorant: true },

  { symbol: 'MoO3', name: 'Molybdenum trioxide', mw: 143.95, roles: ['intermediate'], colorant: true },
  { symbol: 'WO3', name: 'Tungsten trioxide', mw: 231.84, roles: ['intermediate'], colorant: false },

  { symbol: 'CeO2', name: 'Cerium dioxide', mw: 172.115, roles: ['intermediate', 'opacifier'], colorant: false },
  { symbol: 'La2O3', name: 'Lanthanum oxide', mw: 325.809, roles: ['intermediate'], colorant: false },
  { symbol: 'Y2O3', name: 'Yttria', mw: 225.809, roles: ['intermediate'], colorant: false },
  { symbol: 'Nb2O5', name: 'Niobium pentoxide', mw: 265.812, roles: ['intermediate'], colorant: false },
  { symbol: 'Ta2O5', name: 'Tantalum pentoxide', mw: 441.893, roles: ['intermediate'], colorant: false },
];

export const OXIDE_INDEX: Partial<Record<string, OxideDef>> = Object.fromEntries(OXIDES.map((o) => [o.symbol, o]));
