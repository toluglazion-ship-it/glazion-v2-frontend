export type OxideSymbol =
  | 'SiO2' | 'Al2O3' | 'B2O3' | 'P2O5'
  | 'K2O' | 'Na2O' | 'Li2O'
  | 'CaO' | 'MgO' | 'BaO' | 'SrO' | 'ZnO' | 'PbO'
  | 'ZrO2' | 'TiO2' | 'SnO2'
  | 'Fe2O3' | 'FeO'
  | 'MnO' | 'CoO' | 'NiO' | 'CuO' | 'Cr2O3' | 'V2O5'
  | 'MoO3' | 'WO3'
  | 'CeO2' | 'La2O3' | 'Y2O3' | 'Nb2O5' | 'Ta2O5';

export type OxideRole = 'former' | 'intermediate' | 'flux_R2O' | 'flux_RO' | 'opacifier' | 'colorant';

export interface OxideDef {
  symbol: OxideSymbol;
  name: string;
  /** Molecular weight, g/mol. */
  mw: number;
  roles: OxideRole[];
  colorant: boolean;
}

/** Amount per oxide. What the number means depends on the basis: moles, mole %, weight % or UMF. */
export type OxideVector = Partial<Record<OxideSymbol, number>>;

/** A material as it is stored in data/materials.json. */
export interface RawMaterial {
  name: string;
  /** Weight % per oxide. Keys are not limited to OxideSymbol; unknown ones are reported and skipped. */
  oxideAnalysis: Record<string, number>;
  loi: number;
}

export interface Material {
  id: string;
  name: string;
  type: 'raw' | 'frit' | 'stain' | 'opacifier' | 'additive';
  /** Loss on ignition, 0..100. */
  loi_pct: number;
  oxideAnalysis: Record<string, number>;
}

export interface RecipeLine {
  materialId: string;
  /** 0..100; the lines of a recipe add up to 100. */
  partsPct: number;
}

export interface Recipe {
  id: string;
  name: string;
  category: 'glaze' | 'engobe' | 'slip' | 'body';
  cone?: string;
  lines: RecipeLine[];
}

export type FluxSet = OxideSymbol[];

export interface CalcOptions {
  fluxSet: FluxSet;
  unityMode?: 'flux_to_1';
}

export interface ChemistryResult {
  moles: OxideVector;
  molePct: OxideVector;
  /** Fired glass, weight %. */
  analysisPct: OxideVector;
  umf: OxideVector;
  fluxSum: number;
  warnings: string[];
  ratios: {
    si_al?: number;
    /** (K2O + Na2O + Li2O) / (CaO + MgO + BaO + SrO + ZnO) */
    alkali_over_alkaline?: number;
    /** B2O3 in the fired analysis, weight %. */
    b2o3_pct?: number;
  };
  /** Estimated coefficient of thermal expansion, shown as ×10⁻⁷/°C. */
  cte: number;
}

export interface GlazeLimit {
  cone: string;
  oxide: string;
  minUmf: number;
  maxUmf: number;
  notes: string;
}
