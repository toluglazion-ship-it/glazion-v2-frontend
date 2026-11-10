// Types for the main app features: the UMF calculator, recipe-to-image search, chat and registration.
//
// The calculator, chat and registration match the API as of 14 Oct 2026; search and its feedback
// as of 17 Oct 2026 (closest match, similar glazes, stains). The API types most strings loosely and marks most fields nullable; the client tidies responses
// into these shapes (see packages/api-client/src/main.ts).

import type { AccountStatus } from './index';

// ─── Chemistry ────────────────────────────────────────────────────────────────

/** Fixed oxide order used for chemistry vectors (PRD 11.2). */
export const OXIDES = [
  'Li2O', 'Na2O', 'K2O', 'MgO', 'CaO', 'SrO', 'BaO', 'ZnO', 'PbO',
  'B2O3', 'Al2O3', 'SiO2', 'TiO2', 'ZrO2', 'SnO2', 'Fe2O3',
  'Cr2O3', 'CuO', 'CoO', 'MnO', 'NiO', 'P2O5',
] as const;

export type Oxide = (typeof OXIDES)[number];

/**
 * Amount per oxide. Keyed by formula so it can carry oxides outside the fixed order above,
 * which the UMF calculation can produce (FeO, V2O5 and so on).
 */
export type Umf = { [oxide: string]: number | undefined };

export type Atmosphere = 'oxidation' | 'reduction' | 'neutral';

export type MaterialUnit = '%' | 'g' | 'kg' | 'oz' | 'lb';

/** A recipe row for search. materialId (from the materials list) wins over rawName when both are sent. */
export interface RecipeMaterialRow {
  materialId?: string;
  rawName?: string;
  amount: number;
  unit: MaterialUnit;
}

// ─── Cones ────────────────────────────────────────────────────────────────────

/** Orton pyrometric cones, regular cones at a 60 °C (108 °F) per hour heating rate. */
export const CONE_DATA: { cone: string; fahrenheit: number; celsius: number }[] = [
  { cone: '010', fahrenheit: 1657, celsius: 903 },
  { cone: '09', fahrenheit: 1688, celsius: 920 },
  { cone: '08', fahrenheit: 1728, celsius: 942 },
  { cone: '07', fahrenheit: 1789, celsius: 976 },
  { cone: '06', fahrenheit: 1828, celsius: 998 },
  { cone: '05.5', fahrenheit: 1859, celsius: 1015 },
  { cone: '05', fahrenheit: 1888, celsius: 1031 },
  { cone: '04', fahrenheit: 1945, celsius: 1063 },
  { cone: '03', fahrenheit: 1987, celsius: 1086 },
  { cone: '02', fahrenheit: 2016, celsius: 1102 },
  { cone: '01', fahrenheit: 2046, celsius: 1119 },
  { cone: '1', fahrenheit: 2079, celsius: 1137 },
  { cone: '2', fahrenheit: 2088, celsius: 1142 },
  { cone: '3', fahrenheit: 2106, celsius: 1152 },
  { cone: '4', fahrenheit: 2124, celsius: 1162 },
  { cone: '5', fahrenheit: 2167, celsius: 1186 },
  { cone: '5.5', fahrenheit: 2197, celsius: 1203 },
  { cone: '6', fahrenheit: 2232, celsius: 1222 },
  { cone: '7', fahrenheit: 2262, celsius: 1239 },
  { cone: '8', fahrenheit: 2280, celsius: 1249 },
  { cone: '9', fahrenheit: 2300, celsius: 1260 },
  { cone: '10', fahrenheit: 2345, celsius: 1285 },
  { cone: '11', fahrenheit: 2361, celsius: 1294 },
  { cone: '12', fahrenheit: 2383, celsius: 1306 },
];

/** The cones the backend has target ranges for. */
export const LIMIT_CONES = ['06', '6', '9', '10'];

/**
 * The cone whose target ranges stand in for one without its own: the nearest by temperature, so
 * cone 5 is compared with cone 6's targets and cone 04 with cone 06's.
 */
export function limitConeFor(cone: string): string {
  const celsius = (c: string) => CONE_DATA.find((data) => data.cone === c)?.celsius;
  const at = celsius(cone);
  if (LIMIT_CONES.includes(cone) || at === undefined) return cone;
  return LIMIT_CONES.reduce((best, c) => (Math.abs(celsius(c)! - at) < Math.abs(celsius(best)! - at) ? c : best));
}

/** "cone 6", or "cone 6, the nearest to cone 5" when another cone's targets stand in. */
export function limitConeText(cone: string): string {
  const limitCone = limitConeFor(cone);
  return limitCone === cone ? `cone ${cone}` : `cone ${limitCone}, the nearest to cone ${cone}`;
}

/**
 * Cones written with a leading zero sit below cone 1. The search API takes numbers, so "06"
 * travels as -6 and "05.5" as -5.5.
 */
export function coneToNumber(cone: string): number {
  return cone.startsWith('0') ? -Number(cone.slice(1)) : Number(cone);
}

export function coneFromNumber(value: number): string {
  return value < 0 ? `0${-value}` : String(value);
}

// ─── UMF calculator ───────────────────────────────────────────────────────────
// The backend works out every number; the apps send the recipe and show what comes back.

/** A recipe row for the calculator: materialId from the materials list, or a name for older recipes. */
export interface UmfCalculateRow {
  materialId?: string;
  material?: string;
  /** Parts, not percentages; read like parseFloat, so "40g" is 40. */
  amount: number | string;
}

export interface UmfCalculateRequest {
  /** "06" and -6 both mean cone 06. Only LIMIT_CONES have target ranges; limitConeFor picks the one to send. */
  cone?: string;
  rows: UmfCalculateRow[];
}

/** A row left out of the calculation. index is its 0-based position in the request's rows. */
export interface UmfSkippedRow {
  index: number;
  reason: string | null;
  material: string | null;
}

export interface GlazeLimit {
  cone: string | null;
  oxide: string | null;
  minUmf: number;
  maxUmf: number;
  notes: string | null;
}

export interface UmfSuggestion {
  oxide: string | null;
  current: number;
  /** The target range as text, e.g. "0.25 - 0.45". */
  target: string | null;
  direction: 'increase' | 'decrease' | null;
  /** The materials that move the oxide most; inRecipe says whether it's already in the recipe. */
  materials: { name: string | null; oxideContent: number; inRecipe: boolean }[] | null;
  minUmf: number;
  maxUmf: number;
  notes: string | null;
}

/** A ratio that can't be worked out is left out, so a missing one means "n/a". */
export interface UmfRatios {
  si_al?: number | null;
  alkali_over_alkaline?: number | null;
  b2o3_pct?: number | null;
}

export interface UmfResult {
  lines: { materialId: string | null; partsPct: number }[] | null;
  moles: Umf | null;
  molePct: Umf | null;
  /** Fired glass, weight %. */
  analysisPct: Umf | null;
  umf: Umf | null;
  fluxSum: number;
  warnings: string[] | null;
  ratios: UmfRatios | null;
  /** Estimated thermal expansion, ×10⁻⁷/°C. */
  cte: number;
  /** Empty without a cone. */
  suggestions: UmfSuggestion[] | null;
  clayBodyNote: string | null;
}

/** The UMF grouped in display order: R₂O, RO, R₂O₃, RO₂. */
export interface UmfDisplayGroup {
  key: string | null;
  label: string | null;
  oxides: { oxide: string | null; value: number }[] | null;
}

export type CteBand = 'low' | 'medium' | 'high';

export interface UmfVersions {
  calculationProfile: string | null;
  calculationVersion: string | null;
  oxidesVersion: string | null;
  materialsVersion: string | null;
  limitsVersion: string | null;
}

export interface UmfCalculateResponse {
  /** Opaque; changes whenever the materials list does. Kept with a saved recipe. */
  materialsVersion: string | null;
  skippedRows: UmfSkippedRow[] | null;
  /** Null (still a 200) when nothing could be calculated, e.g. an empty recipe. */
  result: UmfResult | null;
  cone: string | null;
  limits: GlazeLimit[] | null;
  displayGroups: UmfDisplayGroup[] | null;
  cteBand: CteBand | string | null;
  versions: UmfVersions | null;
}

// ─── Recipe-to-image search ───────────────────────────────────────────────────

export type SearchQuery =
  | { type: 'umf'; umf: Umf; oxideWeightPercent?: Umf; calculationProfile?: string; calculationVersion?: string }
  | { type: 'recipe'; recipeId?: string; recipeCode?: string }
  | { type: 'raw_recipe'; name?: string; materials: RecipeMaterialRow[] };

export interface FiringQuery {
  coneMin: number | null;
  coneMax: number | null;
  atmosphere: Atmosphere | null;
}

export interface SearchFiringInput extends FiringQuery {
  /** Only return tiles fired inside the range, rather than ranking close ones lower. */
  strict?: boolean | null;
}

export interface SearchFilters {
  /** porcelain, stoneware or red_body. A hard filter, like tileVariantKeys. */
  clayBodies?: string[];
  tileVariantKeys?: string[];
  surface?: string[];
  opacity?: string[];
  colourFamily?: string[];
}

export interface RecipeImageSearchRequest {
  query: SearchQuery;
  firing: SearchFiringInput;
  filters?: SearchFilters;
  topK: number;
  includeRecipeMetadata?: boolean;
}

export type ConfidenceBand = 'high' | 'medium' | 'low';

/** `synthetic_preview` must never be presented as a real fired tile. */
export type SearchResultType = 'real_tile' | 'synthetic_preview';

export interface ScoreBreakdown {
  chemistrySimilarity: number | null;
  firingCompatibility: number | null;
  labelOrTextSimilarity: number | null;
  imageSimilarity: number | null;
  /** Finer parts of the scores above, when the ranker reports them. */
  chemistryCosine?: number | null;
  chemistryDistance?: number | null;
  chemistryCoverage?: number | null;
  textSimilarity?: number | null;
  labelMatch?: number | null;
  /**
   * Colorants of both kinds, metallic oxides from the UMF and stains by name and amount: 1 the same, about 0.6 the
   * same colorant at double, under 0.3 a different colour. Null when the tile has no chemistry.
   */
  colourantSimilarity?: number | null;
}

/** A stain or other material with no oxide analysis, which a UMF can't show. The ranker compares these by name and amount. */
export interface Colourant {
  materialId: string | null;
  name: string | null;
  /** Parts per 100 parts of the rest of the recipe. */
  percentOfBase: number;
}

/** metallic_oxide: shows in the UMF (iron, cobalt, copper...); stain: a made colour with no oxide analysis. */
export type ColorantKind = 'metallic_oxide' | 'stain';

/** One colorant in the searched recipe, of either kind. */
export interface ColorantMaterial {
  materialId: string;
  name: string;
  kind: ColorantKind;
  /** Parts per 100 parts of the rest of the recipe: added on top of the base. */
  percentOfBase: number;
}

export interface SearchResultItem {
  rank: number;
  resultType: SearchResultType;
  imageId: string;
  /** Either can be missing; when only one is there it stands in for the other. */
  displayUrl: string | null;
  thumbnailUrl: string | null;
  score: number;
  confidenceBand: ConfidenceBand;
  scoreBreakdown: ScoreBreakdown;
  matchedFields: string[];
  tile: {
    variant: string | null;
    surface: string | null;
    opacity: string | null;
    colourFamily: string | null;
    /** porcelain, stoneware or red_body. */
    clayBody: string | null;
  };
  firing: FiringQuery;
  source: {
    recordType: string;
    /** Only sent when the search asked for includeRecipeMetadata. */
    recipeId: string | null;
    /** The lab code, e.g. P01-B1-005. */
    recipeCode: string | null;
    /** The recipe's name, e.g. "Absence ∆10 · Lab 1 · Without Colorants"; most imported recipes have no lab code. */
    recipeName: string | null;
    metadataVisibility: string;
  };
  limitations: string[];
}

export interface RecipeImageSearchResponse {
  searchId: string;
  query: {
    type: SearchQuery['type'];
    inputHash: string;
    calculationProfile: string | null;
    recipeCode: string | null;
    /** The chemistry the search used; for a recipe, calculated from its materials. */
    umf: Umf | null;
    /** Stains the recipe has. Null when unknown, as for a UMF search. */
    colourants: Colourant[] | null;
    /** Every colorant the recipe has, metallic oxides and stains, largest first. Null for a UMF search, and from an older API. */
    colorantMaterials: ColorantMaterial[] | null;
  };
  ranker: {
    version: string;
    candidateCount: number;
    returnedCount: number;
    minimumConfidence: number;
  };
  /** Ranked; can hold several photos of the same recipe. */
  items: SearchResultItem[];
  /** The best tile (items[0]); null when nothing matched. */
  closestMatch: SearchResultItem | null;
  /** Other recipes, the best photo of each, best first. Not always in items. */
  similar: SearchResultItem[];
  /** Contains "no_reliable_match" when nothing clears the confidence threshold. */
  warnings: string[];
  createdAt: string;
}

/** What the search could make of one recipe row, sent with a 422 materials_unresolved. */
export interface MaterialResolution {
  /** 1-based position of the row in query.materials, as the API counts. */
  position: number;
  rawName: string | null;
  /** resolved, unresolved or invalid_amount. */
  status: string | null;
  /** Materials the row may have meant. */
  suggestions: { materialId: string | null; name: string }[];
}

export type SearchFeedbackValue = 'relevant' | 'not_relevant';

export interface SearchFeedbackRequest {
  searchId: string;
  imageId: string;
  feedback: SearchFeedbackValue;
  note?: string;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type ChatSourceKind = 'knowledge' | 'recipe' | 'material' | 'image';

export interface ChatSource {
  id: string;
  kind: ChatSourceKind;
  title: string;
  snippet: string;
}

export type ChatToolName = 'calculate_umf' | 'search_recipe_images' | 'get_recipe' | 'get_upload_status' | 'get_material';

export interface ChatToolCall {
  name: ChatToolName;
  /** One line describing what the tool did, written for the user. */
  summary: string;
  /** Set for search_recipe_images so the UI can link to the results. */
  searchId?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  sources?: ChatSource[];
  toolCalls?: ChatToolCall[];
  /** Low-confidence answers are flagged so the UI can say so (CHAT-06). */
  confidence?: ConfidenceBand;
}

export interface Conversation extends ConversationSummary {
  messages: ChatMessage[];
}

export interface CreateConversationRequest {
  /** Optional; without one the conversation is titled from its first message. */
  title?: string;
}

export interface SendMessageRequest {
  content: string;
  /** The search result the message is about. The server tells the model its recipe; the conversation shows only content. */
  tile?: ChatTileRef;
}

export interface ChatTileRef {
  searchId: string;
  imageId: string;
}

export interface SendMessageResponse {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  /** The server may title a new conversation from its first message. */
  conversation: ConversationSummary;
}

export interface ChatFeedbackRequest {
  messageId: string;
  feedback: 'helpful' | 'not_helpful';
  note?: string;
}

// ─── Registration ─────────────────────────────────────────────────────────────

export interface RegisterRequest {
  displayName: string;
  username: string;
  email: string;
  password: string;
}

export interface RegisterResult {
  userId: string;
  accountStatus: AccountStatus;
}
