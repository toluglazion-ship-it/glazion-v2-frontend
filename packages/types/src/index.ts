// Shapes mirror the Glazion v2 API schema (schema.json). Keep them in sync when the backend changes.

import type { Colourant, ScoreBreakdown } from './main';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum AccountStatus {
  /** Can sign in and read /me; everything else is refused (403 account_pending) until an admin activates it. */
  Pending = 0,
  Active = 1,
  /** Can't sign in, and existing sessions are ended. */
  Suspended = 2,
  Disabled = 3,
}

/** The usual path is AwaitingUpload, Uploaded, Validating, NeedsReview, Approved, Indexed. */
export enum UploadStatus {
  Created = 0,
  AwaitingUpload = 1,
  Uploaded = 2,
  Validating = 3,
  NeedsReview = 4,
  Approved = 5,
  Rejected = 6,
  /** Defined by the API but not used at the moment. */
  Indexing = 7,
  Indexed = 8,
  Failed = 9,
  Cancelled = 10,
}

// The schema only has the numbers; the backend confirmed these meanings on 5 Oct 2026.
export enum UserRole {
  Admin = 0,
  /** A participant: signs in to Capture. */
  Standard = 1,
}

/** The automatic quality check on a photo. The API sends the name, not a number. */
export type QualityStatus = 'Pending' | 'Passed' | 'NeedsReview' | 'Failed';

// ─── Shared ───────────────────────────────────────────────────────────────────

export interface PagedResult<T> {
  items: T[] | null;
  totalCount: number;
  nextCursor: string | null;
}

export interface PageParams {
  cursor?: string;
  pageSize?: number;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthTokensResult {
  accessToken: string | null;
  refreshToken: string | null;
  expiresInSeconds: number;
}

export interface LoginCommand {
  username: string;
  password: string;
}

export interface LoginResult {
  tokens: AuthTokensResult;
  userId: string;
  username: string | null;
  displayName: string | null;
  role: UserRole;
  accountStatus: AccountStatus;
}

export interface RefreshCommand {
  refreshToken: string;
}

export interface CurrentUserDto {
  id: string;
  username: string | null;
  displayName: string | null;
  role: UserRole;
  accountStatus: AccountStatus;
  createdAt: string;
  email: string | null;
  /** Group and participant, e.g. "P01": the first part of every tile code they work with. */
  participantCode: string | null;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface UserDto {
  id: string;
  username: string | null;
  displayName: string | null;
  role: UserRole;
  accountStatus: AccountStatus;
  createdAt: string;
  updatedAt: string;
  email: string | null;
  participantCode: string | null;
}

export type UserDtoPagedResult = PagedResult<UserDto>;

export interface CreateUserRequest {
  username: string;
  password: string;
  displayName?: string | null;
  participantCode?: string | null;
  email?: string | null;
}

export interface UpdateUserRequest {
  displayName?: string | null;
  participantCode?: string | null;
}

export interface UserListParams extends PageParams {
  status?: AccountStatus;
  search?: string;
}

export interface SetStatusRequest {
  status: AccountStatus;
}

/** An admin replacing a user's password: 8 to 256 characters. */
export interface SetPasswordRequest {
  password: string;
}

/** The user is signed out everywhere; `sessionsEnded` is how many sign-ins that ended, when the API says. */
export interface SetPasswordResult {
  sessionsEnded: number | null;
}

// ─── Recipes ──────────────────────────────────────────────────────────────────

export interface RecipeDto {
  id: string;
  name: string | null;
  description: string | null;
  recipeJson: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** The tile code, e.g. "P01-B1-002". Null for recipes made before codes, or outside the register. */
  code: string | null;
  /** The base it was made from, e.g. "P01-B1". */
  baseCode: string | null;
  recipeNumber: number | null;
  /** JSON list of what was added to the base, as MaterialRow objects. */
  additionsJson: string | null;
  /** How the test came out. A failed test keeps its number, so this is where that's recorded. */
  outcomeNote: string | null;
  /** The base's name, e.g. "Bamboo". Admin recipes list only. */
  baseName?: string | null;
  /** Who has this recipe to make and how far each tile has got: its live tasks, one per clay body at most. Admin recipes list only. */
  tasks?: TileTaskDto[] | null;
  /** This variation's own firing, when it fires differently from its base; null follows the base. */
  cone?: string | null;
  atmosphere?: string | null;
  /** How its tiles are fired: its own firing, else its base's. */
  firingCone?: string | null;
  firingAtmosphere?: string | null;
  /** When an admin deleted it; it can be restored. Its code stays taken. */
  deletedAt?: string | null;
  /** When an admin last changed what goes in it (its additions, its base, its firing). */
  mixChangedAt?: string | null;
  /** One recipe only: whether its additions and firing can still change (until a tile of it is checked and approved). */
  mixEditable?: boolean | null;
  /** One recipe only: why not ("P01-B1-003 has been checked and approved"). */
  mixLockedBecause?: string[] | null;
}

export type RecipeDtoPagedResult = PagedResult<RecipeDto>;

export interface CreateRecipeRequest {
  name: string;
  description?: string | null;
  recipeJson?: string | null;
  /** Firing cone as written ("6", "04"). Null: not set (a variation then follows its base). */
  cone?: string | null;
  /** oxidation, reduction or neutral. */
  atmosphere?: string | null;
}

export interface RecipeListParams extends PageParams {
  activeOnly?: boolean;
  /** Matches the recipe's name or code, and its base glaze's name ("bamboo" finds every Bamboo variation). */
  search?: string;
  /** One base's variations, e.g. "P01-B1". */
  baseCode?: string;
  /** Recipes this person has a live task for. */
  assignedUserId?: string;
  /** false: recipes nobody has been given yet. */
  assigned?: boolean;
  /** Recipes with a task at this stage. */
  taskStage?: TileTaskStage;
  /** Recipes with a task past its due date. */
  overdue?: boolean;
  /** true: only deleted recipes, to restore. Otherwise deleted ones are left out. */
  deleted?: boolean;
}

/** Changes by id: the parts of a recipe that aren't its formulation. */
export interface UpdateRecipeDetailsRequest {
  name?: string | null;
  description?: string | null;
  isActive?: boolean | null;
  /** The firing: left out unchanged, "" clears it. Locked, like the materials, once a tile of it is checked and approved. */
  cone?: string | null;
  atmosphere?: string | null;
  /** A variation's additions (its colorants on top of the base), replaced as a whole. Same lock as the firing. */
  additions?: MaterialRow[] | null;
}

/** Changes by tile code. */
export interface UpdateRecipeRequest {
  outcomeNote?: string | null;
  isActive?: boolean | null;
  /** The firing: left out unchanged, "" clears it. Locked, like the materials, once a tile is in use. */
  cone?: string | null;
  atmosphere?: string | null;
}

// ─── Base-glaze register ──────────────────────────────────────────────────────

/** One material and its amount, in a base formulation or in what a variation adds to its base. */
export interface MaterialRow {
  rawName: string;
  amount: number;
  /** "%" unless said otherwise. */
  unit?: string | null;
}

export interface BaseGlazeDto {
  id: string;
  /** e.g. "P01-B2" */
  code: string | null;
  participantCode: string | null;
  baseNumber: number;
  name: string | null;
  description: string | null;
  formulation: MaterialRow[] | null;
  /** The base this one changes, e.g. "P01-B1". Once tiles of a base are made, a change is a new base. */
  derivedFromBaseCode: string | null;
  changeNote: string | null;
  variationCount: number;
  nextRecipeNumber: number | null;
  createdAt: string;
  /** The variations registered under this base. */
  recipes: RecipeDto[] | null;
  /** Set when this base was a variation that turned out well and was made a base, e.g. "P01-B1-002". */
  promotedFromRecipeCode?: string | null;
  /** When the base was last edited; null if never. */
  updatedAt?: string | null;
  /**
   * One base only (not in the list): whether its formulation can still be corrected. False once a tile of any of its
   * variations has been checked and approved by an admin, or photographed. Name, description and note can always change.
   */
  formulationEditable?: boolean | null;
  /** One base only: why its formulation is locked, one line per variation in use ("P01-B1-003 has been checked and approved"). */
  formulationLockedBecause?: string[] | null;
  /** How its tiles are fired; its variations follow it unless one fires differently. Locked with the formulation. */
  cone?: string | null;
  atmosphere?: string | null;
  /** When an admin deleted it with its variations; it can be restored. Its number stays taken. */
  deletedAt?: string | null;
}

/** Only the fields sent change. formulation replaces the whole base formulation. */
export interface UpdateBaseGlazeRequest {
  name?: string | null;
  description?: string | null;
  formulation?: MaterialRow[] | null;
  changeNote?: string | null;
  /** The firing: left out unchanged, "" clears it. Locked, like the materials, once a tile is in use. */
  cone?: string | null;
  atmosphere?: string | null;
  /** Gives the base to another participant, only before stage 1 starts: it takes their next base number. */
  participantCode?: string | null;
}

export interface RecalculationFailure {
  recipeCode: string | null;
  code: string;
  message: string;
}

/**
 * variationsRebuilt: variations whose full recipe was rebuilt from the new formulation. recalculated: those whose stored
 * chemistry was worked out again; recalculationFailed: those that could not be, with why.
 */
export interface UpdateBaseGlazeResponse {
  base: BaseGlazeDto;
  variationsRebuilt: number;
  recalculated: number;
  recalculationFailed: RecalculationFailure[];
}

export interface RegisterBaseGlazeRequest {
  participantCode?: string | null;
  userId?: string | null;
  name?: string | null;
  description?: string | null;
  formulation: MaterialRow[];
  derivedFromBaseCode?: string | null;
  changeNote?: string | null;
  /** How its tiles are fired. A base derived from another takes that one's firing when left out. */
  cone?: string | null;
  atmosphere?: string | null;
}

/** A recipe under a base: the base plus what's added. Its number is given by the server. */
export interface RegisterVariationRequest {
  name?: string | null;
  description?: string | null;
  additions: MaterialRow[];
  /** Only when this variation fires differently from its base. */
  cone?: string | null;
  atmosphere?: string | null;
}

/** Several variations of one base at once, numbered in order. */
export interface RegisterVariationsRequest {
  variations: RegisterVariationRequest[];
  /** Also puts the new recipes on this capture code. */
  captureCodeId?: string | null;
}

/**
 * Makes a variation a base of its own. It takes its participant's next base number
 * (P01-B1-002 becomes P01-B2), so codes never grow longer.
 */
export interface PromoteVariationRequest {
  name?: string | null;
  description?: string | null;
  /** Left out, the new base belongs to the same participant as the variation. */
  participantCode?: string | null;
}

/** Who makes the new variations: one task per variation per clay body (all three when left out). */
export interface AssignVariationsRequest {
  assignedUserId: string;
  clayBodies?: ClayBody[] | null;
  /** YYYY-MM-DD */
  dueOn?: string | null;
  note?: string | null;
}

/**
 * The Register base form in one step: a new base (or an existing one by code), its variations, and who makes them.
 * All or nothing: if any part is refused, nothing is saved.
 */
export interface RegisterBaseWithVariationsRequest {
  base?: RegisterBaseGlazeRequest | null;
  baseCode?: string | null;
  variations?: RegisterVariationRequest[] | null;
  assign?: AssignVariationsRequest | null;
  /** The base's cup experiment: each colorant row of the form is a stage. */
  experiment?: BaseExperimentRequest | null;
}

/** The cup experiment registered with a base. Stage 1 sets the cups (one per amount, 1–20); the name defaults to the base's. */
export interface BaseExperimentRequest {
  participantUserId: string;
  cups: number;
  dryGrams?: number;
  waterGrams?: number;
  tilesPerStep?: number;
  clayBodies?: ClayBody[];
  minReserveGrams?: number;
  stages: ExperimentStageInput[];
  name?: string | null;
}

export interface RegisterBaseWithVariationsResponse {
  base: BaseGlazeDto;
  variations: RecipeDto[];
  /** Null when the variations were not assigned. */
  assigned: AssignTileTasksResponse | null;
  /** Null when the base has no stages. */
  experiment?: ExperimentDto | null;
}

/** Numbers run 001 to 999 under each base, then 1000 to 2000, and are never reused. Codes on tiles never change. */
export const MAX_VARIATIONS_PER_BASE = 2000;

// ─── Materials ────────────────────────────────────────────────────────────────

/** Where a material's analysis comes from: the backend's materials.json, an administrator's correction, or a material an administrator added. */
export type MaterialSource = 'file' | 'override' | 'custom';

export type MaterialCategory = 'silica' | 'clay' | 'feldspar' | 'flux' | 'frit' | 'opacifier' | 'colorant' | 'stain' | 'ash' | 'additive' | 'other';

export interface MaterialCategoryOption {
  key: MaterialCategory;
  label: string | null;
}

/** A material from the backend's materials list, which is what recipes are calculated against. */
export interface MaterialSummary {
  /** The name's slug: "CP#7 Ball Clay" and "CP-7 Ball Clay" are both "cp-7-ball-clay". */
  id: string | null;
  name: string | null;
  type: string | null;
  loi_pct: number;
  oxideAnalysis: Record<string, number> | null;
  hasAnalysis: boolean;
  source?: MaterialSource;
  category?: MaterialCategory | null;
  /** On the studio short list. */
  common?: boolean;
  /** Other names potters type for it, e.g. "EPK" for EP Kaolin. */
  aliases?: string[] | null;
  /** Set when only an alias matched the search, e.g. "EPK". */
  matchedAlias?: string | null;
}

export interface MaterialListResponse {
  /** Changes whenever an override changes. Saved calculations keep the version they used. */
  materialsVersion: string | null;
  total: number;
  items: MaterialSummary[] | null;
  nextCursor?: string | null;
  categories?: MaterialCategoryOption[] | null;
}

export interface MaterialListParams {
  /** Ranked search over names and aliases; forgives one typo per word of four letters or more. */
  q?: string;
  /** Only the studio short list (74 materials), grouped by category. */
  common?: boolean;
  category?: MaterialCategory;
  /** Leaves out materials with no oxide analysis. */
  withAnalysis?: boolean;
  /** Up to 500. */
  pageSize?: number;
  cursor?: string;
  limit?: number;
  offset?: number;
}

// The admin materials routes, as in the backend Swagger of 14 Oct 2026.

/** One line of materials.json in a group that shares an id. */
export interface MaterialDuplicateEntry {
  /** Where it sits in the file, counting from 0. */
  position: number;
  name: string | null;
  oxideAnalysis: Record<string, number> | null;
  loi: number | null;
  /** The entry the calculator uses today (the later one in the file), unless an override settles it. */
  usedByCalculator: boolean;
}

/** materials.json names that slug to the same id. */
export interface MaterialDuplicateGroup {
  materialId: string | null;
  /** The entries' figures are the same, so nothing needs deciding. */
  identical: boolean;
  /** An administrator has settled it with an override (see the overrides list for the figures). */
  resolvedByOverride: boolean;
  entries: MaterialDuplicateEntry[] | null;
}

/** An administrator's correction to a material, or a material they added. */
export interface MaterialOverrideDto {
  materialId: string | null;
  name: string | null;
  oxideAnalysis: Record<string, number> | null;
  loi: number | null;
  /** Where the figures came from. */
  note: string | null;
  /** True when it corrects a material in materials.json; false for one an administrator added. */
  inFile: boolean;
  createdAt: string;
  updatedAt: string;
  materialsVersion: string | null;
}

/**
 * Corrects a material (its id is in the file) or adds one (it isn't). The name must slug to the
 * id in the path; oxide symbols must be ones the calculator knows; each value 0 to 100, total at most 105.
 */
export interface UpsertMaterialRequest {
  name: string;
  oxideAnalysis: Record<string, number>;
  loi?: number | null;
  note?: string | null;
}

// ─── Clay body ────────────────────────────────────────────────────────────────

/**
 * The clay a test tile is made of. Every photo needs one. The API takes a plain string; these are
 * the three bodies the studio uses, spelled as the search filters spell them (red clay is
 * "red_body"), so a photo's clay body and a search filter always agree.
 */
export type ClayBody = 'porcelain' | 'stoneware' | 'red_body';

export const CLAY_BODIES: { value: ClayBody; label: string }[] = [
  { value: 'porcelain', label: 'Porcelain' },
  { value: 'stoneware', label: 'Stoneware' },
  { value: 'red_body', label: 'Red clay' },
];

/** Sets the clay body on stored photos: the ones listed, or every photo from an import. */
export interface SetClayBodyRequest {
  clayBody: string;
  imageIds?: string[] | null;
  importBatchId?: string | null;
  /** Leaves photos that already have a clay body alone. */
  onlyIfMissing?: boolean | null;
}

export interface SetClayBodyResponse {
  clayBody: string | null;
  matched: number;
  updated: number;
  reindexQueued: number;
}

/** A bulk import of photos (such as the existing porcelain set); the full shape is under Imports below. */
export type ImportBatchDtoPagedResult = PagedResult<ImportBatchDto>;

// ─── Capture codes ────────────────────────────────────────────────────────────

export interface CaptureCodeDto {
  id: string;
  /** The full code. Only returned by the create call; store nothing, show it once. */
  plainCode: string | null;
  maskedSuffix: string | null;
  assignedUserId: string;
  assignedUsername: string | null;
  labelPrefix: string | null;
  isActive: boolean;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  recipeCount: number;
}

export type CaptureCodeDtoPagedResult = PagedResult<CaptureCodeDto>;

export interface CreateCodeRequest {
  assignedUserId: string;
  labelPrefix?: string | null;
  instructionVersionId?: string | null;
  defaultTileVariantId?: string | null;
  expiresAt?: string | null;
}

export interface AssignRecipesRequest {
  recipeIds: string[];
}

export interface CaptureCodeListParams extends PageParams {
  assignedUserId?: string;
  activeOnly?: boolean;
}

/** What a signed-in capture user is allowed to photograph. */
export interface CaptureContextDto {
  codeId: string;
  maskedSuffix: string | null;
  labelPrefix: string | null;
  expiresAt: string | null;
  recipes: RecipeDto[] | null;
}

// ─── Uploads ──────────────────────────────────────────────────────────────────

export interface UploadDto {
  id: string;
  status: UploadStatus;
  objectKey: string | null;
  fileName: string | null;
  contentType: string | null;
  declaredSizeBytes: number;
  actualSizeBytes: number | null;
  failureReason: string | null;
  reviewNote: string | null;
  createdAt: string;
  uploadedAt: string | null;
  completedAt: string | null;
  reviewedAt: string | null;
  downloadUrl: string | null;
  recipeId: string | null;
  recipeName: string | null;
  recipeCode: string | null;
  imageId: string | null;
  nextAction: string | null;
  thumbnailUrl: string | null;
  clayBody: string | null;
  /** The tile task the photo was taken for, if any. */
  taskId?: string | null;
  /** The back of the tile, with its code on it, when it was sent. */
  backUrl?: string | null;
}

export type UploadDtoPagedResult = PagedResult<UploadDto>;

export interface AdminUploadDto {
  id: string;
  ownerUserId: string;
  /** Who took the photo. */
  ownerUsername: string | null;
  /** Null for a photo of a tile task taken by its code. */
  captureCodeId: string | null;
  status: UploadStatus;
  objectKey: string | null;
  fileName: string | null;
  contentType: string | null;
  declaredSizeBytes: number;
  actualSizeBytes: number | null;
  failureReason: string | null;
  reviewNote: string | null;
  createdAt: string;
  uploadedAt: string | null;
  reviewedAt: string | null;
  downloadUrl: string | null;
  recipeId: string | null;
  recipeName: string | null;
  recipeCode: string | null;
  imageId: string | null;
  qualityStatus: QualityStatus;
  thumbnailUrl: string | null;
  clayBody: string | null;
  /** The back of the tile, with its code on it. */
  backUrl?: string | null;
  /** Who made the tile, when the photo was taken for a tile task. */
  madeByUsername?: string | null;
}

export type AdminUploadDtoPagedResult = PagedResult<AdminUploadDto>;

export interface AdminUploadListParams extends PageParams {
  status?: UploadStatus;
  ownerUserId?: string;
}

export interface CreateUploadRequest {
  /** Needed unless taskId is sent: anyone may photograph a tile task once it is marked done. */
  captureCodeId?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  sizeBytes: number;
  sha256?: string | null;
  recipeId?: string | null;
  recipeCode?: string | null;
  /** Required by the Capture app: no photo goes up without it. */
  clayBody?: string | null;
  /** The tile task the photo is for. Its recipe and clay body are used, so those may be left out. */
  taskId?: string | null;
  /** The back of the tile, with its code: a second file, presigned next to the front. */
  back?: { fileName?: string | null; contentType?: string | null; sizeBytes: number } | null;
}

export interface UploadListParams extends PageParams {
  status?: UploadStatus;
}

export interface CompleteUploadRequest {
  sha256?: string | null;
}

export interface PresignDto {
  uploadId: string;
  method: string | null;
  url: string | null;
  objectKey: string | null;
  expiresAt: string;
  headers: Record<string, string> | null;
  /** A second PUT for the back of the tile, when the upload has one. */
  back?: { method: string; url: string; objectKey: string; expiresAt: string; headers: Record<string, string> | null } | null;
}

export interface ApproveRequest {
  note?: string | null;
  /** Sets or corrects the recipe the photo shows. Left out, the upload keeps its own. */
  recipeId?: string | null;
}

export interface RejectRequest {
  reason: string;
}

// ─── Tile tasks ───────────────────────────────────────────────────────────────
// A recipe on one clay body for one participant, usually by a due date (Glazion-v2 docs/tile-tasks.md).

/**
 * Assigned: to make, not started (the recipe is hidden and can still change). Started: being made, the recipe shown and
 * locked (also after an admin returned it; see returnNote). Done: made, waiting for an admin to check it. AwaitingPhoto:
 * checked and approved; anyone can photograph it by its code (also after a photo was rejected; see retakeReason).
 * InReview: photo sent, waiting for an admin. Approved: photo approved. Cancelled: withdrawn.
 */
export type TileTaskStage = 'Assigned' | 'Started' | 'Done' | 'AwaitingPhoto' | 'InReview' | 'Approved' | 'Cancelled';

export type TileTaskEventKind =
  | 'Assigned'
  | 'Reassigned'
  | 'MarkedDone'
  | 'DoneUndone'
  | 'Updated'
  | 'Cancelled'
  | 'Started'
  | 'CompositionApproved'
  | 'Returned'
  | 'Restored';

/**
 * A task's recipe as the participant mixes it: the base's rows, what this variation adds (its colorants, usually) and the
 * whole. kind: colorant (a metallic oxide), stain, clay, …; null when the material isn't in the list.
 */
export interface TaskRecipeDto {
  description: string | null;
  baseCode: string | null;
  baseName: string | null;
  base: MatchCheckMaterial[];
  additions: MatchCheckMaterial[];
  materials: MatchCheckMaterial[];
  /** How the tile is fired: the variation's own or its base's. Cone as written ("6", "04"); atmosphere oxidation, reduction or neutral. */
  cone?: string | null;
  atmosphere?: string | null;
}

/**
 * Capture by code (GET /api/v2/capture/tiles/{code}): the recipe written on the tile and one entry per tile someone
 * has been given. Send the photo with the chosen tile's taskId.
 */
export interface CaptureLookupDto {
  recipeId: string;
  code: string | null;
  name: string | null;
  baseCode: string | null;
  baseName: string | null;
  cone: string | null;
  atmosphere: string | null;
  tiles: CaptureTileDto[];
}

/**
 * status: ready (made and checked by an admin: photograph it now), not_done (not made yet), not_approved (made, waiting
 * for an admin to check it), in_review (a photo is waiting for an admin), approved (its photo is in the library).
 */
export type CaptureTileStatus = 'ready' | 'not_done' | 'not_approved' | 'in_review' | 'approved';

export interface CaptureTileDto {
  taskId: string;
  clayBody: string;
  stage: TileTaskStage;
  status: CaptureTileStatus;
  madeByUsername: string;
  mine: boolean;
  doneAt: string | null;
  /** Why the last photo was turned down, when it was. */
  retakeReason: string | null;
}

export interface TileTaskEventDto {
  kind: TileTaskEventKind;
  at: string;
  actorUserId: string;
  actorUsername: string | null;
  fromUserId: string | null;
  fromUsername: string | null;
  toUserId: string | null;
  toUsername: string | null;
  note: string | null;
}

export interface TileTaskDto {
  id: string;
  recipeId: string;
  recipeCode: string | null;
  recipeName: string;
  baseCode: string | null;
  clayBody: ClayBody;
  assignedUserId: string;
  assignedUsername: string;
  assignedDisplayName: string | null;
  participantCode: string | null;
  stage: TileTaskStage;
  /** Past its due date and not made yet (Assigned or Started). */
  overdue: boolean;
  /** YYYY-MM-DD. */
  dueOn: string | null;
  /** The admin's instructions. */
  note: string | null;
  assignedAt: string;
  doneAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** The latest photo sent for the current assignment. */
  photoUploadId: string | null;
  photoStatus: UploadStatus | null;
  /** Why the photo has to be taken again (rejected, or failed the quality checks). */
  retakeReason: string | null;
  /** Send back on changes; a stale one is refused with task_changed. */
  version: string;
  /** Only on GET /admin/tasks/{id}. */
  history?: TileTaskEventDto[] | null;
  /** Only on the participant's own tasks (/me/tasks), once they have pressed Start. */
  recipe?: TaskRecipeDto | null;
  /** When the participant pressed Start (the recipe is shown from then). */
  startedAt?: string | null;
  /** When an admin checked the made tile and approved it for its photo. The recipe locks then. */
  approvedAt?: string | null;
  /** Why an admin sent the made tile back (stage Started). */
  returnNote?: string | null;
  /** The admin changed the recipe after the participant pressed Start (until the tile is approved): check the new amounts. */
  recipeChangedAt?: string | null;
}

/**
 * One thing that happened to a participant's work, newest first on their admin page. kind: a task event
 * (TileTaskEventKind) or 'PhotoSent' (a photo they sent, with its current status).
 */
export interface ParticipantActivityDto {
  kind: TileTaskEventKind | 'PhotoSent';
  at: string;
  taskId: string | null;
  recipeId: string | null;
  recipeCode: string | null;
  recipeName: string | null;
  clayBody: string | null;
  actorUsername: string | null;
  note: string | null;
  uploadId?: string | null;
  uploadStatus?: UploadStatus | null;
}

export interface TileTaskSummaryDto {
  assigned: number;
  started?: number;
  done: number;
  awaitingPhoto?: number;
  inReview: number;
  approved: number;
  cancelled: number;
  /** Overlaps assigned and started. */
  overdue: number;
}

/** updated: the tasks approved or returned; skipped: the rest, with why. */
export interface TileTaskBatchResponse {
  updated: TileTaskDto[];
  skipped: { taskId: string; reason: string }[];
}

export interface TileTaskListParams extends PageParams {
  /** All but Cancelled when left out. */
  stage?: TileTaskStage;
  overdue?: boolean;
  userId?: string;
  recipeId?: string;
  clayBody?: ClayBody;
  /** Recipe code or name, or username. */
  q?: string;
}

export interface AssignTileTasksRequest {
  recipeIds: string[];
  /** All three when left out. */
  clayBodies?: ClayBody[];
  assignedUserId: string;
  dueOn?: string | null;
  note?: string | null;
}

/** A tile that already has a live task, and who has it. */
export interface SkippedTileDto {
  recipeId: string;
  recipeCode: string | null;
  recipeName: string;
  clayBody: ClayBody;
  existingTaskId: string;
  assignedUserId: string;
  assignedUsername: string;
}

export interface AssignTileTasksResponse {
  created: TileTaskDto[];
  skipped: SkippedTileDto[];
  /** False when the participant has no active capture code, so they can't send photos yet. */
  participantCanUpload: boolean;
}

export interface ReassignTileTaskRequest {
  assignedUserId: string;
  dueOn?: string | null;
  /** Goes into the task's history, e.g. "Didn't come in". */
  reason?: string | null;
  version?: string | null;
}

export interface ReassignTileTasksRequest {
  taskIds: string[];
  assignedUserId: string;
  dueOn?: string | null;
  reason?: string | null;
}

export interface ReassignTileTasksResponse {
  reassigned: TileTaskDto[];
  /** reason: not_found, cancelled, in_review, approved or same_participant. */
  skipped: { taskId: string; reason: string }[];
  participantCanUpload: boolean;
}

export interface UpdateTileTaskRequest {
  dueOn?: string | null;
  clearDueOn?: boolean;
  /** A blank note removes it. */
  note?: string | null;
  version?: string | null;
}

export interface CancelTileTaskRequest {
  reason?: string | null;
  version?: string | null;
}

// ─── Photo library (admin) ────────────────────────────────────────────────────
// Every photo the search can show, from Capture uploads and from imports, and the index behind it.
// The API sends these statuses as names, not numbers.

export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected' | 'Superseded';
export type ChemistryStatus = 'Missing' | 'Pending' | 'Linked' | 'Invalid';
export type ImageSourceType = 'UserUpload' | 'Import';
export type RecipeImageRelationship = 'TestTile' | 'Reference' | 'Variant';

export interface RecipeLinkDto {
  recipeId: string;
  recipeName: string | null;
  recipeCode: string | null;
  relationshipType: RecipeImageRelationship;
  verified: boolean;
}

/** The chemistry pinned to a photo when it was linked to its recipe. */
export interface CalculationSnapshotDto {
  id: string;
  recipeId: string;
  calculationProfile: string | null;
  calculationVersion: string | null;
  materialAnalysisVersion: string | null;
  chemistrySchemaVersion: string | null;
  inputHash: string | null;
  fluxTotal: number;
  umfJson: string | null;
  warningsJson: string | null;
}

export interface ImageAssetDto {
  imageId: string;
  sourceType: ImageSourceType;
  uploadId: string | null;
  importRecordId: string | null;
  externalRecordId: string | null;
  ownerUserId: string | null;
  tileVariantKey: string | null;
  originalKey: string | null;
  displayKey: string | null;
  thumbnailKey: string | null;
  format: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  sha256: string | null;
  qualityStatus: QualityStatus;
  /** JSON list of reasons from the automatic photo check. */
  qualityReasonsJson: string | null;
  qualityPolicyVersion: string | null;
  approvalStatus: ApprovalStatus;
  approvedAt: string | null;
  chemistryStatus: ChemistryStatus;
  chemistry: CalculationSnapshotDto | null;
  recipes: RecipeLinkDto[] | null;
  duplicateOfImageId: string | null;
  coneMin: number | null;
  coneMax: number | null;
  atmosphere: string | null;
  labelsJson: string | null;
  sourceVersion: number;
  createdAt: string;
  validatedAt: string | null;
  downloadUrl: string | null;
  displayUrl: string | null;
  thumbnailUrl: string | null;
  derivativesCreatedAt: string | null;
  /** The approved AI copy shown in place of this photo; null when the photo itself is shown. */
  displayCopyId?: string | null;
}

export interface ImageListParams extends PageParams {
  approval?: ApprovalStatus;
  quality?: QualityStatus;
  chemistry?: ChemistryStatus;
}

export interface BackfillDerivativesRequest {
  imageIds?: string[] | null;
  regenerate?: boolean | null;
}

export interface EnqueuedResponse {
  enqueued: number;
}

// Imports: bringing in existing tile photos in bulk. A batch is created, its records registered
// (each gets an upload link), the files sent to storage, the records completed, then it's closed.

export type ImportBatchStatus = 'Open' | 'Closed';
export type ImportRecordStatus = 'Registered' | 'Uploaded' | 'Validated' | 'NeedsReview' | 'Failed';

export interface ImportBatchCounts {
  total: number;
  registered: number;
  uploaded: number;
  validated: number;
  needsReview: number;
  failed: number;
  approved: number;
  indexed: number;
  chemistryLinked: number;
  chemistryMissing: number;
  chemistryInvalid: number;
}

export interface ImportBatchDto {
  id: string;
  name: string | null;
  sourceLabel: string | null;
  defaultTileVariantKey: string | null;
  autoApprove: boolean;
  status: ImportBatchStatus;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
  counts: ImportBatchCounts;
}

export interface CreateImportBatchRequest {
  name: string;
  sourceLabel?: string | null;
  defaultTileVariantKey?: string | null;
  autoApprove: boolean;
}

export interface ImportManifestRow {
  /** Unique within the batch; the apps use the file name. */
  externalRecordId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256?: string | null;
  tileVariantKey?: string | null;
  coneMin?: number | null;
  coneMax?: number | null;
  atmosphere?: string | null;
  labels?: Record<string, string> | null;
  recipeId?: string | null;
  recipeCode?: string | null;
}

export interface ImportRecordRegistration {
  externalRecordId: string | null;
  accepted: boolean;
  status: ImportRecordStatus;
  objectKey: string | null;
  upload: PresignDto | null;
  errors: string[] | null;
  warnings: string[] | null;
}

export interface RegisterImportRecordsResponse {
  batchId: string;
  records: ImportRecordRegistration[] | null;
}

export interface ImportRecordCompletion {
  externalRecordId: string | null;
  status: ImportRecordStatus;
  imageId: string | null;
  error: string | null;
}

export interface CompleteImportRecordsResponse {
  batchId: string;
  records: ImportRecordCompletion[] | null;
}

export interface ImportRecordDto {
  id: string;
  externalRecordId: string | null;
  objectKey: string | null;
  status: ImportRecordStatus;
  failureCode: string | null;
  failureDetail: string | null;
  imageId: string | null;
  qualityStatus: QualityStatus;
  approvalStatus: ApprovalStatus;
  chemistryStatus: ChemistryStatus;
  chemistryWarningsJson: string | null;
  createdAt: string;
  uploadedAt: string | null;
}

export interface ImportRecordListParams extends PageParams {
  status?: ImportRecordStatus;
}

// The search index: what has been turned into searchable vectors, and the background jobs doing it.

export type IndexModality = 'Chemistry' | 'Text' | 'Visual';
export type JobStatus = 'Queued' | 'Running' | 'Succeeded' | 'Failed' | 'DeadLetter';

export interface IndexNamespaceStatus {
  namespace: string | null;
  modality: IndexModality;
  embeddingModel: string | null;
  embeddingVersion: string | null;
  indexed: number;
  superseded: number;
  errored: number;
  providerVectorCount: number | null;
}

/**
 * Strict firing, on unless an admin turns it off (meeting 2026-10-29): a search with a cone shows only tiles fired
 * within ±1 cone of it, in the atmosphere asked for, and never a tile whose cone wasn't recorded.
 */
export interface SearchSettingsDto {
  strictFiring: boolean;
  updatedAt: string | null;
}

export interface IndexStatusDto {
  approvedImages: number;
  indexedImages: number;
  backlog: number;
  vectorProvider: string | null;
  embeddingModel: string | null;
  embeddingVersion: string | null;
  chemistrySchemaVersion: string | null;
  namespaces: IndexNamespaceStatus[] | null;
  jobs: { queued: number; running: number; succeeded: number; failed: number; deadLetter: number };
  providerError: string | null;
}

export interface RebuildIndexRequest {
  imageIds?: string[] | null;
  includeNonApproved: boolean;
}

export interface JobDto {
  id: string;
  jobType: string | null;
  entityType: string | null;
  entityId: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  errorCode: string | null;
  errorDetail: string | null;
  availableAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface JobListParams extends PageParams {
  status?: JobStatus;
  jobType?: string;
}

// ─── AI copies (admin) ────────────────────────────────────────────────────────
// A library photo remade by an image model as a new photo of the same glaze (Glazion-v2 docs/ai-copies.md).

/** Queued and Generating while it is made; Ready to compare; Approved is the one shown instead of the photo. */
export type AiCopyStatus = 'Queued' | 'Generating' | 'Ready' | 'Failed' | 'Approved' | 'Rejected';

export interface AiCopyDto {
  id: string;
  imageId: string;
  status: AiCopyStatus;
  model: string;
  quality: string;
  instruction: string | null;
  displayUrl: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  /** Why it failed, in the model's words. */
  error: string | null;
  /** Tokens the model reported: what the copy cost. */
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  reviewedAt: string | null;
}

export interface MakeAiCopyRequest {
  /** Anything to add for this copy, e.g. "less shine". */
  instruction?: string | null;
  /** low, medium, high, xhigh or max. The server's default (high) when left out. */
  quality?: string | null;
}

// ─── Match check (admin) ──────────────────────────────────────────────────────
// Every search beside the tiles it suggested, and where each tile came from (Glazion-v2 docs/match-check.md).

export interface MatchCheckPerson {
  id: string;
  username: string;
  displayName: string | null;
  participantCode: string | null;
}

/** A material row on a search or a recipe. kind is its category: "colorant" (a metallic oxide), "stain", "clay"…; null when not in the list. */
export interface MatchCheckMaterial {
  name: string;
  amount: number | null;
  unit: string | null;
  kind: string | null;
}

export interface MatchCheckTile {
  imageId: string;
  thumbnailUrl: string | null;
  recipeCode: string | null;
  recipeName: string | null;
}

export interface SearchCheckSummary {
  id: string;
  createdAt: string;
  requester: MatchCheckPerson | null;
  queryType: 'raw_recipe' | 'recipe' | 'umf';
  /** The name typed with the recipe, if any. */
  name: string | null;
  recipeCode: string | null;
  /** Material names as typed (searches from 27 Oct 2026 on). */
  materials: string[];
  colourants: Colourant[] | null;
  resultCount: number;
  topScore: number | null;
  topBand: string | null;
  top: MatchCheckTile | null;
  /** How many results the person marked not relevant. */
  notRelevant: number;
}

/** Match check's tile list: the photo list's filters, plus where the photo came from. Newest first, up to 50 a page. */
export interface ImageTraceListParams extends PageParams {
  approval?: ApprovalStatus;
  source?: ImageSourceType;
  /** A lab code, or the start of one such as P01-B1. */
  recipeCode?: string;
  clayBody?: string;
  participantCode?: string;
  /** File name, record id, recipe name or lab code. */
  q?: string;
}

export interface SearchCheckListParams extends PageParams {
  type?: 'raw_recipe' | 'recipe' | 'umf';
  /** Only searches where a result was marked not relevant. */
  notRelevant?: boolean;
  userId?: string;
  /** Matches the person's username or name. */
  q?: string;
}

export interface SearchCheckQuery {
  type: 'raw_recipe' | 'recipe' | 'umf';
  name: string | null;
  recipeId: string | null;
  recipeCode: string | null;
  recipeName: string | null;
  materials: MatchCheckMaterial[] | null;
  /** False: the rows are the searched recipe's as it is now, not what was typed. */
  materialsAsTyped: boolean;
  umf: Record<string, number> | null;
  colourants: Colourant[] | null;
  coneMin: number | null;
  coneMax: number | null;
  atmosphere: string | null;
  strict: boolean;
  clayBodies: string[];
}

export type OxideGroup = 'flux' | 'stabiliser' | 'glass' | 'colourant' | 'opacifier' | 'other';

/** One oxide in UMF, searched against tile. difference is tile minus searched. */
export interface OxideComparison {
  oxide: string;
  group: OxideGroup;
  searched: number | null;
  tile: number | null;
  difference: number | null;
}

export interface TracedRecipe {
  id: string;
  code: string | null;
  name: string;
  verified: boolean;
  relationship: string;
  baseCode: string | null;
  baseName: string | null;
  /** The whole recipe as mixed. */
  materials: MatchCheckMaterial[];
  /** What a variation adds to its base (empty otherwise). */
  additions: MatchCheckMaterial[];
}

export interface TracedChemistry {
  calculationResultId: string;
  /** Imported as numbers, not calculated from materials. */
  supplied: boolean;
  umf: Record<string, number>;
  /** true: the snapshot the search compared; false: re-calculated since; null: not recorded (photo library). */
  comparedAtSearch: boolean | null;
}

/** Where a tile came from and the recipe and chemistry it carries. */
export interface ImageTrace {
  imageId: string;
  displayUrl: string | null;
  thumbnailUrl: string | null;
  source: ImageSourceType;
  fileName: string | null;
  recordId: string | null;
  batchName: string | null;
  owner: MatchCheckPerson | null;
  clayBody: string | null;
  coneMin: number | null;
  coneMax: number | null;
  atmosphere: string | null;
  approvalStatus: ApprovalStatus;
  recipes: TracedRecipe[];
  chemistry: TracedChemistry | null;
  colourants: Colourant[] | null;
  /** The back of the tile, with its code on it, when it was photographed. Never searched. */
  backUrl?: string | null;
  /** Who made the tile, when it was photographed for a tile task (owner took the photo). */
  madeByUsername?: string | null;
}

/** closest: the big card; similar: the row of other glazes; ranked: further down the full list. */
export type SearchCheckShown = 'closest' | 'similar' | 'ranked';

export interface SearchCheckResult {
  rank: number | null;
  shown: SearchCheckShown;
  score: number;
  confidenceBand: string;
  scoreBreakdown: ScoreBreakdown;
  matchedFields: string[];
  limitations: string[];
  feedback: 'relevant' | 'not_relevant' | null;
  feedbackNote: string | null;
  image: ImageTrace | null;
  comparison: OxideComparison[];
}

export interface SearchCheckDetail {
  id: string;
  createdAt: string;
  requester: MatchCheckPerson | null;
  query: SearchCheckQuery;
  results: SearchCheckResult[];
  warnings: string[];
  rankerVersion: string;
  candidateCount: number;
  latencyMs: number | null;
}

// ─── Overview ─────────────────────────────────────────────────────────────────

export interface OverviewDto {
  totalUsers: number;
  activeCaptureCodes: number;
  activeRecipes: number;
  totalUploads: number;
  pendingReview: number;
}

// ─── Main app (search, chat, registration) ───────────────────────────────────

export * from './main';

// ─── Cup experiments (Glazion-v2 docs/cup-experiments.md, meeting 2026-11-02) ─────────────────────

export type ExperimentStageMode = 'variable' | 'constant';

/** A stage as set up. Stage 1 always varies by cup (start, step); a later one is variable (start, step, levels) or constant. */
export interface ExperimentStageInput {
  material: string;
  mode?: ExperimentStageMode;
  start?: number | null;
  step?: number | null;
  levels?: number | null;
  constant?: number | null;
}

export interface CreateExperimentRequest {
  name?: string | null;
  baseCode: string;
  participantUserId: string;
  cups?: number;
  dryGrams?: number;
  waterGrams?: number;
  tilesPerStep?: number;
  /** One tile task per distinct clay body; the same one three times means three tiles of that clay. */
  clayBodies?: ClayBody[];
  minReserveGrams?: number;
  stages: ExperimentStageInput[];
}

export interface UpdateExperimentRequest {
  name?: string | null;
  stages?: ExperimentStageInput[] | null;
  tilesPerStep?: number | null;
  clayBodies?: ClayBody[] | null;
  minReserveGrams?: number | null;
  /** Before the first step only (409 experiment_started after): the cups are mixed then. */
  cups?: number | null;
  dryGrams?: number | null;
  waterGrams?: number | null;
  participantUserId?: string | null;
}

export interface ExperimentStageDto {
  index: number;
  number: number;
  material: string;
  mode: ExperimentStageMode;
  start: number;
  step: number;
  levels: number;
  constant: number;
  /** "0.5% in cup 1 up to 5% in cup 10", "2% in every cup". */
  summary: string;
  stepsTotal: number;
  stepsDone: number;
  /** Not started yet, so the admin can still change it. */
  editable: boolean;
}

export interface CupMaterialDto {
  material: string;
  grams: number;
  /** % of the dry base in the cup (0 on refill amounts). */
  percent: number;
}

export interface ExperimentCupDto {
  number: number;
  dryGrams: number;
  waterGrams: number;
  wetGrams: number;
  materials: CupMaterialDto[];
  /** Too low for another dip: add fresh glaze (with the admin) before it takes part again. */
  needsGlaze: boolean;
}

/** One cup in a step: what to add and its recipe (mix), or the fresh glaze and grams of each material (refill). */
export interface StepCupDto {
  number: number;
  targetPercent: number | null;
  addGrams: number | null;
  wetBeforeGrams: number | null;
  wetAfterGrams: number | null;
  recipeId: string | null;
  recipeCode: string | null;
  recipeName: string | null;
  /** Too low: left out of this step. */
  skipped: boolean;
  freshDryGrams?: number | null;
  freshWaterGrams?: number | null;
  refillAdds?: CupMaterialDto[] | null;
}

/** A step: without an id, the next one not started yet (a preview with the grams to add). */
export interface ExperimentStepDto {
  id: string | null;
  kind: 'mix' | 'refill';
  stageIndex: number | null;
  stageNumber: number | null;
  level: number | null;
  levels: number | null;
  material: string | null;
  mode: ExperimentStageMode | null;
  cups: StepCupDto[];
  startedAt: string | null;
  dippedAt: string | null;
  weighedCup: number | null;
  weighedGrams: number | null;
  retention: number | null;
  actorUsername: string | null;
}

export interface ExperimentDto {
  id: string;
  name: string;
  baseCode: string;
  baseName: string | null;
  participantUserId: string;
  participantUsername: string;
  participantDisplayName: string | null;
  participantCode: string | null;
  cupCount: number;
  dryGrams: number;
  waterGrams: number;
  tilesPerStep: number;
  clayBodies: ClayBody[];
  minReserveGrams: number;
  stages: ExperimentStageDto[];
  cups: ExperimentCupDto[];
  /** The open step (started, not dipped yet), else the next one as a preview; null when every step is done. */
  current: ExperimentStepDto | null;
  history: ExperimentStepDto[];
  progress: { stepsDone: number; stepsTotal: number; recipes: number; tiles: number };
  finished: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
