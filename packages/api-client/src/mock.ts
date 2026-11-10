// In-memory stand-in for the backend, used when VITE_USE_MOCKS=true (`pnpm dev:mock`).
// It lets the apps be clicked through without credentials. Data resets on reload.
import {
  AccountStatus,
  MAX_VARIATIONS_PER_BASE,
  UploadStatus,
  UserRole,
  type AdminUploadDto,
  type BaseGlazeDto,
  type CaptureCodeDto,
  type ImageAssetDto,
  type ImportBatchDto,
  type ImportRecordDto,
  type JobDto,
  type MaterialRow,
  type RecipeDto,
  type UploadDto,
  type UserDto,
} from '@glazion/types';
import { uid } from './uid';
import { ApiError } from './index';
import { handleMaterialsRequest } from './mock-materials';
import { handleUmfRequest } from './mock-umf';
import {
  assignTasks,
  cancelTasksOf,
  captureTiles,
  handleTasksRequest,
  hasLiveTask,
  liveTasksFor,
  restoreTasksOf,
  seedTasks,
  taskApproved,
  taskForUpload,
  taskMaker,
  uploadTasks,
  type TaskContext,
} from './mock-tasks';
import { handleMatchCheckRequest } from './mock-match-check';
import { handleAiCopiesRequest } from './mock-ai-copies';

type Query = Record<string, string | number | boolean | null | undefined> | undefined;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const pad3 = (n: number) => String(n).padStart(3, '0');

// A flat glazed-tile swatch, so lists have something to show without real photos.
function tile(base: string, pool: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><radialGradient id="g" cx="38%" cy="32%" r="80%"><stop offset="0" stop-color="${pool}"/><stop offset="1" stop-color="${base}"/></radialGradient></defs><rect width="400" height="400" fill="#e9e6e1"/><rect x="60" y="60" width="280" height="280" rx="10" fill="url(#g)"/><rect x="60" y="60" width="280" height="280" rx="10" fill="none" stroke="rgba(0,0,0,.12)" stroke-width="2"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function user(username: string, displayName: string | null, minutes: number, extra: Partial<UserDto> = {}): UserDto {
  return { id: uid(), username, displayName, role: UserRole.Standard, accountStatus: AccountStatus.Active, createdAt: ago(minutes), updatedAt: ago(minutes), email: null, participantCode: null, ...extra };
}

const users: UserDto[] = [
  user('admin', 'Studio Admin', 60 * 24 * 40, { role: UserRole.Admin, email: 'studio@glazion.test' }),
  user('adaeze', 'Adaeze Okafor', 60 * 24 * 21, { participantCode: 'P01', email: 'adaeze@glazion.test', updatedAt: ago(60 * 24 * 2) }),
  user('tunde.b', 'Tunde Bakare', 60 * 24 * 14, { participantCode: 'P02' }),
  user('miriam', 'Miriam Holt', 60 * 24 * 9, { participantCode: 'P03', accountStatus: AccountStatus.Suspended, updatedAt: ago(60 * 24 * 1) }),
  user('kelechi', null, 60 * 5, { accountStatus: AccountStatus.Pending }),
];

function recipe(name: string | null, description: string | null, minutes: number, extra: Partial<RecipeDto> = {}): RecipeDto {
  return { id: uid(), name, description, recipeJson: null, isActive: true, createdAt: ago(minutes), updatedAt: ago(minutes), code: null, baseCode: null, recipeNumber: null, additionsJson: null, outcomeNote: null, ...extra };
}

const recipes: RecipeDto[] = [
  recipe('Leach 4321 Clear', 'Cone 10 reduction. Base glaze, applied over white stoneware.', 60 * 24 * 20),
  recipe('Tenmoku', 'Cone 10 reduction. Breaks rust on edges, thick application.', 60 * 24 * 18),
  recipe('Pinnell Celadon', 'Cone 10 reduction. 1% iron, porcelain test tiles.', 60 * 24 * 12),
  recipe('Floating Blue', 'Cone 6 oxidation. Slow cool, watch for pinholing.', 60 * 24 * 6),
  recipe('Tin White Majolica', 'Cone 04 oxidation.', 60 * 24 * 3, { isActive: false }),
];

// ─── Base-glaze register ──────────────────────────────────────────────────────

interface MockBase extends Omit<BaseGlazeDto, 'recipes' | 'variationCount' | 'nextRecipeNumber'> {
  lastRecipeNumber: number;
}

const bases: MockBase[] = [];

function baseView(base: MockBase): BaseGlazeDto {
  const { lastRecipeNumber, ...rest } = base;
  // Deleted variations keep their numbers but leave the list; a deleted base lists those deleted with it.
  const variations = recipes
    .filter((r) => r.baseCode === base.code && (r.deletedAt ?? null) === (base.deletedAt ?? null))
    .sort((a, b) => (a.recipeNumber ?? 0) - (b.recipeNumber ?? 0));
  const next = lastRecipeNumber + 1;
  return { ...rest, variationCount: variations.length, nextRecipeNumber: next > MAX_VARIATIONS_PER_BASE ? null : next, recipes: variations };
}

function findBase(code: string): MockBase {
  const base = bases.find((b) => b.code?.toLowerCase() === code.toLowerCase());
  if (!base) throw new ApiError(404, `There is no base glaze ${code}.`);
  return base;
}

const ATMOSPHERES = ['oxidation', 'reduction', 'neutral'];

/** As the API: a cone as written ("cone 6", "∆6" are "6"), "" when blank; refused when it isn't a cone. */
function normalizeCone(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value as null | undefined;
  const cone = String(value).trim().replace(/^(cone|∆|Δ|\^)\s*/i, '');
  if (cone && !/^(0\d{2}|\d{1,2}(\.\d)?)$/.test(cone)) throw new ApiError(400, `"${value}" isn’t a cone. Write it as 6, 04 or 10.`, { code: 'validation_error' });
  return cone;
}

function normalizeAtmosphere(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value as null | undefined;
  const atmosphere = String(value).trim().toLowerCase();
  if (atmosphere && !ATMOSPHERES.includes(atmosphere)) throw new ApiError(400, 'Atmosphere must be oxidation, reduction or neutral.', { code: 'validation_error' });
  return atmosphere;
}

/** How a variation's tiles are fired: its own firing, else its base's. Kept on the recipe, as the API returns it. */
function refreshFiring(r: RecipeDto) {
  const base = bases.find((b) => b.code === r.baseCode);
  r.firingCone = r.cone ?? base?.cone ?? null;
  r.firingAtmosphere = r.atmosphere ?? base?.atmosphere ?? null;
}

function registerBase(
  participantCode: string,
  body: { name?: string | null; description?: string | null; formulation?: MaterialRow[] | null; derivedFromBaseCode?: string | null; changeNote?: string | null; promotedFromRecipeCode?: string | null; cone?: string | null; atmosphere?: string | null },
  minutes = 0,
): MockBase {
  if (!body.formulation?.length) throw new ApiError(400, 'A base glaze needs its full formulation.');
  // A base derived from another fires the same way unless it says otherwise.
  const parent = body.derivedFromBaseCode ? findBase(body.derivedFromBaseCode) : undefined;
  const cone = normalizeCone(body.cone) || parent?.cone || null;
  const atmosphere = normalizeAtmosphere(body.atmosphere) || parent?.atmosphere || null;
  const baseNumber = bases.filter((b) => b.participantCode === participantCode).reduce((n, b) => Math.max(n, b.baseNumber), 0) + 1;
  if (baseNumber > 999) throw new ApiError(409, `${participantCode} already has 999 base glazes, the most a participant can have.`, { code: 'participant_full' });
  const base: MockBase = {
    id: uid(),
    code: `${participantCode}-B${baseNumber}`,
    participantCode,
    baseNumber,
    name: body.name || null,
    description: body.description || null,
    formulation: body.formulation,
    derivedFromBaseCode: body.derivedFromBaseCode || null,
    changeNote: body.changeNote || null,
    promotedFromRecipeCode: body.promotedFromRecipeCode || null,
    cone,
    atmosphere,
    createdAt: ago(minutes),
    lastRecipeNumber: 0,
  };
  bases.push(base);
  return base;
}

function addVariation(base: MockBase, body: { name?: string | null; description?: string | null; additions?: MaterialRow[] | null; cone?: string | null; atmosphere?: string | null }, minutes = 0): RecipeDto {
  if (base.deletedAt) throw new ApiError(409, `${base.code} is deleted. Restore it first to add variations.`, { code: 'base_deleted' });
  if (base.lastRecipeNumber >= MAX_VARIATIONS_PER_BASE) throw new ApiError(409, `${base.code} has used all ${MAX_VARIATIONS_PER_BASE} variation numbers. Make a good variation a new base to carry on.`);
  // Numbers are never reused, so this only ever goes up.
  base.lastRecipeNumber += 1;
  const code = `${base.code}-${pad3(base.lastRecipeNumber)}`;
  const created = recipe(body.name || code, body.description || null, minutes, {
    code,
    baseCode: base.code,
    recipeNumber: base.lastRecipeNumber,
    additionsJson: JSON.stringify(body.additions ?? []),
    // Stored as the API stores a variation: the base's formulation, the additions, and both together.
    recipeJson: JSON.stringify({ baseCode: base.code, baseFormulation: base.formulation, additions: body.additions ?? [], full: combined(base, body.additions ?? []) }),
  });
  // Its own firing only where it differs from the base's.
  const cone = normalizeCone(body.cone) || null;
  const atmosphere = normalizeAtmosphere(body.atmosphere) || null;
  created.cone = cone && cone !== base.cone ? cone : null;
  created.atmosphere = atmosphere && atmosphere !== base.atmosphere ? atmosphere : null;
  refreshFiring(created);
  recipes.push(created);
  return created;
}

/** As the API: why one variation is locked: a tile of it checked and approved by an admin, or photographed (meeting 2026-11-02). */
function recipeInUse(r: RecipeDto): string | null {
  const label = r.code ?? r.name ?? 'This recipe';
  if (uploads.some((u) => u.recipeId === r.id)) return `${label} has been photographed`;
  return taskApproved(r.id) ? `${label} has been checked and approved` : null;
}

/** As the API: a variation's full recipe from its base and its own additions. */
function rebuild(r: RecipeDto, base: MockBase, additions: MaterialRow[]) {
  r.additionsJson = JSON.stringify(additions);
  r.recipeJson = JSON.stringify({ baseCode: base.code, baseFormulation: base.formulation, additions, full: combined(base, additions) });
}

/** As the API: deletes a recipe and cancels its open tiles; its number stays taken. */
function deleteRecipe(r: RecipeDto, at: string) {
  if (r.deletedAt) return;
  const why = recipeInUse(r);
  if (why) throw new ApiError(409, `${why}, so it stays in the records.`, { code: 'recipe_in_use' });
  cancelTasksOf(taskContext, r.id, at, `${r.code ?? r.name} was deleted`);
  Object.assign(r, { deletedAt: at, isActive: false, updatedAt: at });
}

function restoreRecipe(r: RecipeDto) {
  if (!r.deletedAt) return;
  const base = bases.find((b) => b.code === r.baseCode);
  if (base?.deletedAt) throw new ApiError(409, `${base.code} is deleted. Restore the base first; its variations come back with it.`, { code: 'base_deleted' });
  restoreTasksOf(taskContext, r.id, r.deletedAt, `${r.code ?? r.name} was restored`);
  Object.assign(r, { deletedAt: null, isActive: true, updatedAt: new Date().toISOString() });
}

/** As the API: why the base's materials are locked, one line per variation with an approved tile or a photo. */
function baseMade(base: MockBase): string[] {
  return recipes
    .filter((r) => r.baseCode === base.code)
    .flatMap((r) => {
      const label = r.code ?? r.name ?? 'a variation';
      const why = recipeInUse(r);
      return why ? [why.replace(/^This recipe/, label)] : [];
    });
}

/** As the API: name, description and note always; the formulation only until a tile is made, then every variation's rows are rebuilt. */
function updateBase(
  base: MockBase,
  body: {
    name?: string | null;
    description?: string | null;
    formulation?: MaterialRow[] | null;
    changeNote?: string | null;
    cone?: string | null;
    atmosphere?: string | null;
    participantCode?: string | null;
  },
) {
  // Another participant, until stage 1 starts: it takes their next base number.
  const to = body.participantCode?.trim().toUpperCase();
  if (to && to !== base.participantCode) {
    if (recipes.some((r) => r.baseCode === base.code))
      throw new ApiError(409, `Stage 1 of ${base.code} has started, so its recipes carry the code and it stays with ${base.participantCode}.`, { code: 'base_started' });
    if (!users.some((u) => u.participantCode === to)) throw new ApiError(400, `No participant has the code ${to}.`, { code: 'participant_not_found' });
    const n = bases.filter((b) => b.participantCode === to).reduce((m, b) => Math.max(m, b.baseNumber), 0) + 1;
    base.participantCode = to;
    base.baseNumber = n;
    base.code = `${to}-B${n}`;
  }
  // The firing locks with the materials: null leaves it, "" clears it.
  const cone = normalizeCone(body.cone);
  const atmosphere = normalizeAtmosphere(body.atmosphere);
  const firingChanged = (cone != null && (cone || null) !== base.cone) || (atmosphere != null && (atmosphere || null) !== base.atmosphere);
  if (firingChanged && baseMade(base).length)
    throw new ApiError(409, `${base.code} is already in use (${baseMade(base).slice(0, 3).join('; ')}), so its firing stays as it is. Register a new base from ${base.code} instead.`, { code: 'base_in_use' });
  if (body.name != null) {
    if (!body.name.trim()) throw new ApiError(400, 'Base name is required (max 180 characters).');
    base.name = body.name.trim();
  }
  if (body.description != null) base.description = body.description.trim() || null;
  if (body.changeNote != null) {
    if (!body.changeNote.trim() && base.derivedFromBaseCode) throw new ApiError(400, 'A derived base keeps a note of what changed relative to the base it comes from.');
    base.changeNote = body.changeNote.trim() || null;
  }
  let rebuilt = 0;
  if (body.formulation != null && JSON.stringify(body.formulation) !== JSON.stringify(base.formulation)) {
    if (!body.formulation.length) throw new ApiError(400, 'At least one material row is required in formulation.');
    const made = baseMade(base);
    if (made.length)
      throw new ApiError(409, `${base.code} is already in use (${made.slice(0, 3).join('; ')}), so its materials stay as they are. Register a new base from ${base.code} instead.`, { code: 'base_in_use' });
    base.formulation = body.formulation;
    for (const r of recipes.filter((x) => x.baseCode === base.code)) {
      rebuild(r, base, JSON.parse(r.additionsJson || '[]'));
      r.mixChangedAt = new Date().toISOString();
      rebuilt++;
    }
  }
  if (cone != null) base.cone = cone || null;
  if (atmosphere != null) base.atmosphere = atmosphere || null;
  if (firingChanged)
    recipes.filter((r) => r.baseCode === base.code).forEach((r) => {
      refreshFiring(r);
      r.mixChangedAt = new Date().toISOString();
    });
  base.updatedAt = new Date().toISOString();
  return { base: { ...baseView(base), formulationEditable: baseMade(base).length === 0, formulationLockedBecause: baseMade(base) }, variationsRebuilt: rebuilt, recalculated: 0, recalculationFailed: [] };
}

/** The Register base form in one step, all or nothing as the API does: a refused step undoes the ones before it. */
function registerWithVariations(body: any) {
  if (!body?.base === !body?.baseCode) throw new ApiError(400, 'Send either a new base to register or the code of an existing base, not both.', { code: 'validation_error' });
  // Colorant stages make a cup experiment, which runs its arithmetic on the API.
  if (body?.experiment) throw new ApiError(400, 'Colorant stages make a cup experiment, which isn’t in the sample data. Try it against the API.', { code: 'validation_error' });
  const wanted: any[] = body?.variations ?? [];
  if (body?.assign && wanted.length === 0) throw new ApiError(400, 'Add at least one variation to assign.', { code: 'validation_error' });
  const before = { bases: bases.length, recipes: recipes.length };
  let base: MockBase | undefined;
  let lastNumber = 0;
  try {
    if (body.base) {
      const owner = body.base.userId ? find(users, body.base.userId, 'User') : null;
      const participantCode = String(body.base.participantCode ?? owner?.participantCode ?? '').trim().toUpperCase();
      if (!participantCode) throw new ApiError(400, 'Choose the participant this base belongs to.');
      base = registerBase(participantCode, body.base);
    } else base = findBase(String(body.baseCode));
    lastNumber = base.lastRecipeNumber;
    const left = MAX_VARIATIONS_PER_BASE - base.lastRecipeNumber;
    if (wanted.length > left) throw new ApiError(409, `${base.code} has room for ${left} more variation${left === 1 ? '' : 's'}, not ${wanted.length}.`);
    const created = wanted.map((v) => addVariation(base!, v));
    const assigned = body.assign ? assignTasks(taskContext, { ...body.assign, recipeIds: created.map((r) => r.id) }) : null;
    return { base: baseView(base), variations: created, assigned };
  } catch (err) {
    bases.length = before.bases;
    recipes.length = before.recipes;
    if (base && !body.base) base.lastRecipeNumber = lastNumber;
    throw err;
  }
}

const LEACH: MaterialRow[] = [
  { rawName: 'Custer Feldspar', amount: 40, unit: '%' },
  { rawName: 'Silica', amount: 30, unit: '%' },
  { rawName: 'Whiting', amount: 20, unit: '%' },
  { rawName: 'EPK Kaolin', amount: 10, unit: '%' },
];
const b1 = registerBase('P01', { name: 'Original base', description: 'Clear.', formulation: LEACH, cone: '10', atmosphere: 'reduction' }, 60 * 24 * 8);
[0.1, 0.2, 0.3].forEach((pct, i) =>
  addVariation(b1, { name: `B1 + ${pct}% cobalt carbonate`, additions: [{ rawName: 'Cobalt Carbonate', amount: pct, unit: '%' }] }, 60 * 24 * (7 - i)),
);
const b2 = registerBase('P01', { name: 'Original base + 2% rutile', formulation: [...LEACH, { rawName: 'Rutile', amount: 2, unit: '%' }], derivedFromBaseCode: 'P01-B1', changeNote: 'Added 2% rutile.' }, 60 * 24 * 4);
[
  [1, 0],
  [2, 0],
  [0, 2],
].forEach(([copper, iron], i) =>
  addVariation(b2, { name: `B2 + ${copper}% copper + ${iron}% iron`, additions: [{ rawName: 'Copper Carbonate', amount: copper, unit: '%' }, { rawName: 'Red Iron Oxide', amount: iron, unit: '%' }] }, 60 * 24 * (3 - i)),
);
registerBase('P02', { name: 'Satin matte base', cone: '6', atmosphere: 'oxidation', formulation: [{ rawName: 'Nepheline Syenite', amount: 45, unit: '%' }, { rawName: 'Dolomite', amount: 20, unit: '%' }, { rawName: 'Silica', amount: 25, unit: '%' }, { rawName: 'EPK Kaolin', amount: 10, unit: '%' }] }, 60 * 24 * 2);

const byCode = (code: string) => recipes.find((r) => r.code === code)!;

/** The base's formulation with the variation's additions on top: what a promoted variation starts from. */
function combined(base: MockBase, additions: MaterialRow[]): MaterialRow[] {
  const rows = (base.formulation ?? []).map((row) => ({ ...row }));
  for (const add of additions) {
    const same = rows.find((row) => row.rawName.toLowerCase() === add.rawName.toLowerCase() && (row.unit ?? '%') === (add.unit ?? '%'));
    if (same) same.amount += add.amount;
    else rows.push({ ...add });
  }
  return rows;
}

function promote(code: string, body: { name?: string | null; description?: string | null; participantCode?: string | null }): BaseGlazeDto {
  const r = recipeByCode(code);
  if (!r.baseCode) throw new ApiError(400, `${code} isn’t a variation of a base, so it can’t be made one.`);
  if (bases.some((b) => b.promotedFromRecipeCode === r.code)) throw new ApiError(409, `${code} has already been made a base.`);
  const from = findBase(r.baseCode);
  const participantCode = String(body.participantCode ?? from.participantCode ?? '').trim().toUpperCase();
  const additions: MaterialRow[] = r.additionsJson ? JSON.parse(r.additionsJson) : [];
  return baseView(
    registerBase(participantCode, {
      name: body.name || r.name,
      description: body.description || r.description,
      formulation: combined(from, additions),
      derivedFromBaseCode: from.code,
      changeNote: null,
      promotedFromRecipeCode: r.code,
    }),
  );
}

// ─── Capture codes and uploads ────────────────────────────────────────────────

interface MockCode extends Omit<CaptureCodeDto, 'recipeCount'> {
  recipeIds: string[];
}

const codes: MockCode[] = [
  { id: uid(), plainCode: null, maskedSuffix: '7Q4K', assignedUserId: users[1].id, assignedUsername: users[1].username, labelPrefix: 'LAB-A', isActive: true, createdAt: ago(60 * 24 * 10), expiresAt: null, revokedAt: null, recipeIds: [recipes[0].id, recipes[1].id, recipes[2].id, byCode('P01-B1-001').id, byCode('P01-B2-001').id, byCode('P01-B2-002').id] },
  { id: uid(), plainCode: null, maskedSuffix: 'M2XD', assignedUserId: users[2].id, assignedUsername: users[2].username, labelPrefix: 'LAB-B', isActive: true, createdAt: ago(60 * 24 * 5), expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(), revokedAt: null, recipeIds: [recipes[3].id] },
  { id: uid(), plainCode: null, maskedSuffix: '9TRA', assignedUserId: users[3].id, assignedUsername: users[3].username, labelPrefix: null, isActive: false, createdAt: ago(60 * 24 * 9), expiresAt: null, revokedAt: ago(60 * 24 * 1), recipeIds: [] },
];

function codeView({ recipeIds, ...code }: MockCode): CaptureCodeDto {
  return { ...code, recipeCount: recipeIds.length };
}

function recipeFields(r: RecipeDto | undefined) {
  return { recipeId: r?.id ?? null, recipeName: r?.name ?? null, recipeCode: r?.code ?? null };
}

function upload(owner: UserDto, code: MockCode | undefined, r: RecipeDto | undefined, fileName: string, status: UploadStatus, minutes: number, url: string, extra: Partial<AdminUploadDto> = {}): AdminUploadDto {
  return {
    id: uid(),
    ownerUserId: owner.id,
    ownerUsername: owner.username,
    captureCodeId: code?.id ?? null,
    status,
    objectKey: `prod/originals/uploads/${fileName}`,
    fileName,
    contentType: 'image/jpeg',
    declaredSizeBytes: 2_400_000 + Math.round(Math.random() * 1_800_000),
    actualSizeBytes: null,
    failureReason: null,
    reviewNote: null,
    createdAt: ago(minutes),
    uploadedAt: ago(minutes - 1),
    reviewedAt: null,
    downloadUrl: url,
    ...recipeFields(r),
    imageId: null,
    qualityStatus: status === UploadStatus.NeedsReview ? 'NeedsReview' : 'Passed',
    thumbnailUrl: url || null,
    clayBody: 'porcelain',
    ...extra,
  };
}

const uploads: AdminUploadDto[] = [
  upload(users[1], codes[0], byCode('P01-B2-002'), 'P01-B2-002_2026-10-05_091204.jpg', UploadStatus.NeedsReview, 30, tile('#1f5a4a', '#5aa48a')),
  upload(users[1], codes[0], recipes[1], 'tenmoku_2026-10-01_0912.jpg', UploadStatus.NeedsReview, 60 * 24 * 4, tile('#2a1a12', '#7a3b1c')),
  upload(users[1], codes[0], recipes[2], 'pinnell-celadon_2026-10-01_0904.jpg', UploadStatus.NeedsReview, 60 * 24 * 4 + 8, tile('#9fb8a5', '#cfe0d2')),
  upload(users[2], codes[1], recipes[3], 'floating-blue_2026-09-30_1640.jpg', UploadStatus.NeedsReview, 60 * 24 * 5, tile('#1f3f7a', '#6f9bd6')),
  // Photographed by its code: someone else made the tile, and the back (with the code) came with it.
  upload(users[2], undefined, byCode('P01-B2-002'), 'P01-B2-002_2026-10-29_101500.jpg', UploadStatus.NeedsReview, 12, tile('#2f6a58', '#6ab49a'), {
    backUrl: tile('#d9d4cc', '#f2efe9'),
    madeByUsername: 'adaeze',
    clayBody: 'stoneware',
  }),
  upload(users[1], codes[0], byCode('P01-B1-001'), 'P01-B1-001_2026-10-03_1105.jpg', UploadStatus.Approved, 60 * 24 * 2, tile('#3a5fae', '#8fb0e8'), { reviewedAt: ago(60 * 24 * 2 - 30), imageId: uid() }),
  upload(users[2], codes[1], recipes[3], 'floating-blue_2026-09-29_1502.jpg', UploadStatus.Rejected, 60 * 24 * 6, tile('#27406b', '#587fb5'), { reviewedAt: ago(60 * 24 * 6 - 60), reviewNote: 'Strong glare across the top half. Retake under diffuse light.' }),
  upload(users[1], codes[0], recipes[1], 'tenmoku_2026-09-28_1011.jpg', UploadStatus.Indexed, 60 * 24 * 7, tile('#23150f', '#63311a'), { reviewedAt: ago(60 * 24 * 7 - 120), imageId: uid(), clayBody: null }),
];

// ─── Photo library, imports and the search index ─────────────────────────────

function image(id: number, base: string, pool: string, extra: Partial<ImageAssetDto> = {}): ImageAssetDto {
  const url = tile(base, pool);
  return {
    imageId: uid(),
    sourceType: 'Import',
    uploadId: null,
    importRecordId: null,
    externalRecordId: `tile-${id}.jpg`,
    ownerUserId: null,
    tileVariantKey: 'white',
    originalKey: `prod/originals/imports/tile-${id}.jpg`,
    displayKey: `prod/display/tile-${id}.webp`,
    thumbnailKey: `prod/thumbs/tile-${id}.webp`,
    format: 'jpeg',
    width: 3024,
    height: 3024,
    sizeBytes: 2_800_000 + id * 41_000,
    sha256: null,
    qualityStatus: 'Passed',
    qualityReasonsJson: null,
    qualityPolicyVersion: 'q1',
    approvalStatus: 'Approved',
    approvedAt: ago(60 * 24 * (10 - id)),
    chemistryStatus: 'Linked',
    chemistry: null,
    recipes: null,
    duplicateOfImageId: null,
    coneMin: 10,
    coneMax: 10,
    atmosphere: 'reduction',
    labelsJson: null,
    sourceVersion: 1,
    createdAt: ago(60 * 24 * (12 - id)),
    validatedAt: ago(60 * 24 * (12 - id) - 5),
    downloadUrl: url,
    displayUrl: url,
    thumbnailUrl: url,
    derivativesCreatedAt: ago(60 * 24 * (12 - id) - 6),
    ...extra,
  };
}

const link = (r: RecipeDto) => [{ recipeId: r.id, recipeName: r.name, recipeCode: r.code, relationshipType: 'TestTile' as const, verified: true }];
const snapshot = (r: RecipeDto) => ({ id: uid(), recipeId: r.id, calculationProfile: 'flux-to-1', calculationVersion: 'umf-2026.10', materialAnalysisVersion: 'materials-2830', chemistrySchemaVersion: 'v22', inputHash: 'mock', fluxTotal: 0.264, umfJson: null, warningsJson: null });

const images: ImageAssetDto[] = [
  image(1, '#23150f', '#63311a', { recipes: link(recipes[1]), chemistry: snapshot(recipes[1]) }),
  image(2, '#d9d6cc', '#f3f1ea', { recipes: link(recipes[0]), chemistry: snapshot(recipes[0]) }),
  image(3, '#9fb8a5', '#cfe0d2', { recipes: link(recipes[2]), chemistry: snapshot(recipes[2]) }),
  image(4, '#3a5fae', '#8fb0e8', { sourceType: 'UserUpload', recipes: link(byCode('P01-B1-001')), chemistry: snapshot(byCode('P01-B1-001')), coneMin: 6, coneMax: 6, atmosphere: 'oxidation' }),
  image(5, '#1f5a4a', '#5aa48a', {
    approvalStatus: 'Pending', approvedAt: null, qualityStatus: 'NeedsReview', qualityReasonsJson: JSON.stringify(['glare', 'tile not centred']),
    recipes: link(byCode('P01-B2-002')), chemistry: snapshot(byCode('P01-B2-002')), coneMin: 6, coneMax: 6, atmosphere: 'oxidation',
  }),
  image(6, '#6b3a2a', '#b46a45', { approvalStatus: 'Pending', approvedAt: null, chemistryStatus: 'Missing', recipes: null, externalRecordId: 'old-library-0412.jpg' }),
  image(7, '#2c2c34', '#55556a', { approvalStatus: 'Rejected', approvedAt: null, qualityStatus: 'Failed', qualityReasonsJson: JSON.stringify(['blurry']), chemistryStatus: 'Invalid', recipes: null }),
];

const batchCounts = (o: Partial<ImportBatchDto['counts']>): ImportBatchDto['counts'] => ({
  total: 0, registered: 0, uploaded: 0, validated: 0, needsReview: 0, failed: 0, approved: 0, indexed: 0, chemistryLinked: 0, chemistryMissing: 0, chemistryInvalid: 0, ...o,
});

interface MockBatch extends ImportBatchDto {
  records: ImportRecordDto[];
  clayBody: string | null;
}

const batches: MockBatch[] = [
  {
    id: uid(), name: 'Studio library, September', sourceLabel: 'Old GlazionStudio photos', defaultTileVariantKey: 'white', autoApprove: false, status: 'Closed',
    createdBy: users[0].id, createdAt: ago(60 * 24 * 14), closedAt: ago(60 * 24 * 13),
    counts: batchCounts({ total: 3, registered: 3, uploaded: 3, validated: 3, approved: 3, indexed: 3, chemistryLinked: 3 }),
    records: [],
    clayBody: null,
  },
  // The photos already in the library, imported in bulk rather than through Capture.
  {
    id: uid(), name: 'Porcelain test tiles', sourceLabel: 'Studio archive', defaultTileVariantKey: null, autoApprove: false, status: 'Closed',
    createdBy: users[0].id, createdAt: ago(60 * 24 * 30), closedAt: ago(60 * 24 * 29),
    counts: batchCounts({ total: 11_214, approved: 10_980 }),
    records: [],
    clayBody: null,
  },
];

const jobs: JobDto[] = [
  { id: uid(), jobType: 'index.embed', entityType: 'image', entityId: images[3].imageId, status: 'Succeeded', attempts: 1, maxAttempts: 5, errorCode: null, errorDetail: null, availableAt: ago(60 * 30), startedAt: ago(60 * 30), completedAt: ago(60 * 29), createdAt: ago(60 * 30) },
  { id: uid(), jobType: 'image.derivatives', entityType: 'image', entityId: images[5].imageId, status: 'Failed', attempts: 5, maxAttempts: 5, errorCode: 'decode_error', errorDetail: 'The file could not be read as an image.', availableAt: ago(90), startedAt: ago(90), completedAt: ago(89), createdAt: ago(120) },
  { id: uid(), jobType: 'index.embed', entityType: 'image', entityId: images[4].imageId, status: 'Queued', attempts: 0, maxAttempts: 5, errorCode: null, errorDetail: null, availableAt: ago(2), startedAt: null, completedAt: null, createdAt: ago(2) },
];

function indexStatus() {
  const approved = images.filter((i) => i.approvalStatus === 'Approved').length;
  const indexed = Math.max(0, approved - 1);
  const count = (status: JobDto['status']) => jobs.filter((j) => j.status === status).length;
  return {
    approvedImages: approved,
    indexedImages: indexed,
    backlog: approved - indexed,
    vectorProvider: 'mock',
    embeddingModel: 'tile-embed-small',
    embeddingVersion: '2026-09',
    chemistrySchemaVersion: 'v22',
    namespaces: (['Chemistry', 'Text', 'Visual'] as const).map((modality) => ({
      namespace: `tiles-${modality.toLowerCase()}`, modality, embeddingModel: modality === 'Chemistry' ? 'umf-vector' : 'tile-embed-small', embeddingVersion: '2026-09',
      indexed, superseded: 0, errored: modality === 'Visual' ? 1 : 0, providerVectorCount: indexed,
    })),
    jobs: { queued: count('Queued'), running: count('Running'), succeeded: count('Succeeded'), failed: count('Failed'), deadLetter: count('DeadLetter') },
    providerError: null,
  };
}

function findImage(imageId: string): ImageAssetDto {
  const img = images.find((i) => i.imageId === imageId);
  if (!img) throw new ApiError(404, 'Photo not found.');
  return img;
}

function recount(batch: MockBatch) {
  const by = (status: ImportRecordDto['status']) => batch.records.filter((r) => r.status === status).length;
  batch.counts = batchCounts({
    total: batch.records.length,
    registered: batch.records.length,
    uploaded: batch.records.filter((r) => r.uploadedAt).length,
    validated: by('Validated'),
    needsReview: by('NeedsReview'),
    failed: by('Failed'),
    approved: batch.autoApprove ? by('Validated') : 0,
    chemistryLinked: batch.records.filter((r) => r.chemistryStatus === 'Linked').length,
    chemistryMissing: batch.records.filter((r) => r.chemistryStatus === 'Missing').length,
  });
}

/** Mock uploads sent with the back of the tile. */
const uploadBacks = new Set<string>();

// The account the mock session is signed in as. Any password works.
let currentUser: UserDto = users[1];
/** Strict firing in search, on by default as in the API. */
let searchSettings: { strictFiring: boolean; updatedAt: string | null } = { strictFiring: true, updatedAt: null };

const taskContext: TaskContext = {
  users,
  recipes,
  uploads,
  currentUser: () => currentUser,
  canUpload: (userId) => codes.some((c) => c.assignedUserId === userId && c.isActive),
};
// tunde.b has made one of the same tiles, so adaeze can photograph it by its code.
seedTasks(taskContext, users[1].id, users[0].id, [byCode('P01-B2-001').id, recipes[0].id, recipes[2].id], users[2].id);

function page<T>(items: T[], query: Query) {
  const size = Number(query?.pageSize ?? 50);
  return { items: items.slice(0, size), totalCount: items.length, nextCursor: null };
}

/** Pages a list the way the API does: an opaque cursor (here the offset) and a page size. */
function cursorPage<T>(items: T[], query: Query, size: number) {
  const start = Number(query?.cursor ?? 0) || 0;
  const end = start + (Number(query?.pageSize) || size);
  return { items: items.slice(start, end), totalCount: items.length, nextCursor: end < items.length ? String(end) : null };
}

function toUserUpload(u: AdminUploadDto): UploadDto {
  const { ownerUserId, ownerUsername, captureCodeId, qualityStatus, ...rest } = u;
  return { ...rest, completedAt: u.uploadedAt, nextAction: null, taskId: uploadTasks.get(u.id) ?? null };
}

function find<T extends { id: string }>(list: T[], id: string, what: string): T {
  const item = list.find((x) => x.id === id);
  if (!item) throw new ApiError(404, `${what} not found.`);
  return item;
}

function recipeByCode(code: string): RecipeDto {
  const r = recipes.find((x) => x.code?.toLowerCase() === code.toLowerCase());
  if (!r) throw new ApiError(404, `There is no recipe ${code}.`);
  return r;
}

const matches = (term: unknown, ...values: (string | null)[]) => {
  const t = String(term ?? '').trim().toLowerCase();
  return !t || values.some((v) => v?.toLowerCase().includes(t));
};

export async function handleMockRequest(method: string, path: string, query: Query, body: any): Promise<unknown> {
  await wait(250 + Math.random() * 250);
  const route = `${method} ${path.replace(/^\/api\/v2/, '')}`;
  const ids = route.match(/[0-9a-f]{8}-[0-9a-f-]{27}/gi) ?? [];
  const [id = '', id2 = ''] = ids;
  // Tile codes (P01-B2, P01-B2-009) sit in the path after base-glazes/ and by-code/.
  const code = decodeURIComponent(route.match(/(?:base-glazes|by-code|capture\/tiles)\/([^/]+)/)?.[1] ?? '');
  const shape = route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id').replace(/(base-glazes|by-code|capture\/tiles)\/[^/]+/, '$1/:code');

  // As the API does: a pending account can sign in and read /me, and nothing else.
  if (currentUser.accountStatus === AccountStatus.Pending && !shape.startsWith('POST /auth/') && shape !== 'GET /me') {
    throw new ApiError(403, 'This account is waiting for an admin to activate it.', { code: 'account_pending' });
  }

  const materials = handleMaterialsRequest(method, path.replace(/^\/api\/v2/, ''), query, body);
  if (materials.found) return materials.value;
  const umf = handleUmfRequest(method, path.replace(/^\/api\/v2/, ''), query, body);
  if (umf.found) return umf.value;
  const tasksResult = handleTasksRequest(taskContext, method, path.replace(/^\/api\/v2/, ''), query, body);
  if (tasksResult.found) return tasksResult.value;
  const matchCheck = handleMatchCheckRequest({ images, recipes, users }, method, path.replace(/^\/api\/v2/, ''), query);
  if (matchCheck.found) return matchCheck.value;
  const aiCopies = handleAiCopiesRequest(images, currentUser.id, method, path.replace(/^\/api\/v2/, ''), body);
  if (aiCopies.found) return aiCopies.value;
  if (route === 'POST /admin/base-glazes/with-variations') return registerWithVariations(body);

  switch (shape) {
    case 'POST /auth/login': {
      const username = String(body?.username ?? '').trim().toLowerCase();
      if (!username || !body?.password) throw new ApiError(400, 'Enter your username and password.');
      currentUser = users.find((u) => u.username === username) ?? users[1];
      return {
        tokens: { accessToken: 'mock-access', refreshToken: 'mock-refresh', expiresInSeconds: 3600 },
        userId: currentUser.id,
        username: currentUser.username,
        displayName: currentUser.displayName,
        role: currentUser.role,
        accountStatus: currentUser.accountStatus,
      };
    }
    case 'POST /auth/refresh':
      return { accessToken: 'mock-access', refreshToken: 'mock-refresh', expiresInSeconds: 3600 };
    case 'POST /auth/logout':
      return undefined;

    case 'GET /me': {
      const { updatedAt, ...me } = currentUser;
      return me;
    }
    case 'GET /me/capture-context': {
      const c = codes.find((x) => x.assignedUserId === currentUser.id && x.isActive);
      if (!c) throw new ApiError(404, 'No active capture code is assigned to this account.');
      return {
        codeId: c.id,
        maskedSuffix: c.maskedSuffix,
        labelPrefix: c.labelPrefix,
        expiresAt: c.expiresAt,
        recipes: recipes.filter((r) => c.recipeIds.includes(r.id) && r.isActive),
      };
    }

    case 'GET /uploads': {
      let list = uploads.filter((u) => u.ownerUserId === currentUser.id);
      if (query?.status !== undefined && query?.status !== null) list = list.filter((u) => u.status === Number(query.status));
      return page(list.map(toUserUpload), query);
    }
    case 'GET /capture/tiles/:code': {
      const r = recipes.find((x) => x.isActive && x.code?.toLowerCase() === code.trim().toLowerCase());
      if (!r) throw new ApiError(404, `No recipe has the code '${code.trim()}'. Check the code on the back of the tile.`, { code: 'recipe_code_not_found' });
      return captureTiles(taskContext, r, bases.find((b) => b.code === r.baseCode)?.name ?? null);
    }
    case 'POST /uploads': {
      // A photo of a tile task needs no capture code: anyone may photograph a tile once it is marked done.
      const c = body.captureCodeId || !body.taskId ? find(codes, body.captureCodeId, 'Capture code') : undefined;
      const picked = body.recipeId ? find(recipes, body.recipeId, 'Recipe') : body.recipeCode ? recipeByCode(body.recipeCode) : undefined;
      // A photo for a tile task takes the task's recipe and clay body, as the API does.
      const task = taskForUpload(taskContext, body.taskId, picked, body.clayBody);
      const r = picked ?? task?.recipe;
      if (r && !task && !c!.recipeIds.includes(r.id) && !hasLiveTask(currentUser.id, r.id)) throw new ApiError(400, 'That recipe isn’t on your capture code.');
      const created = upload(currentUser, c, r, body.fileName ?? 'photo.jpg', UploadStatus.AwaitingUpload, 0, '', {
        clayBody: body.clayBody ?? task?.clayBody ?? null,
        declaredSizeBytes: body.sizeBytes,
        contentType: body.contentType,
        uploadedAt: null,
        downloadUrl: null,
        qualityStatus: 'Pending',
        madeByUsername: task ? taskMaker(taskContext, task.id) : null,
      });
      uploads.unshift(created);
      if (task) uploadTasks.set(created.id, task.id);
      if (body.back) uploadBacks.add(created.id);
      return toUserUpload(created);
    }
    case 'GET /uploads/:id':
      return toUserUpload(find(uploads, id, 'Upload'));
    case 'POST /uploads/:id/presign': {
      const expiresAt = new Date(Date.now() + 600_000).toISOString();
      const back = uploadBacks.has(id) ? { method: 'PUT', url: `mock://storage/${id}/back`, objectKey: `prod/originals/uploads/${id}/back.jpg`, expiresAt, headers: null } : null;
      return { uploadId: id, method: 'PUT', url: `mock://storage/${id}`, objectKey: `prod/originals/uploads/${id}`, expiresAt, headers: null, back };
    }
    case 'POST /uploads/:id/complete': {
      const u = find(uploads, id, 'Upload');
      u.status = UploadStatus.NeedsReview;
      u.qualityStatus = 'NeedsReview';
      u.uploadedAt = new Date().toISOString();
      u.actualSizeBytes = u.declaredSizeBytes;
      // The mock keeps no files: a plain tile stands in for both sides.
      u.downloadUrl = u.thumbnailUrl = u.downloadUrl ?? tile('#7a8f86', '#c9d6cf');
      if (uploadBacks.has(id)) u.backUrl ??= tile('#d9d4cc', '#f2efe9');
      return toUserUpload(u);
    }
    case 'POST /uploads/:id/cancel':
      find(uploads, id, 'Upload').status = UploadStatus.Cancelled;
      return undefined;

    case 'GET /admin/overview':
      return {
        totalUsers: users.length,
        activeCaptureCodes: codes.filter((c) => c.isActive).length,
        activeRecipes: recipes.filter((r) => r.isActive).length,
        totalUploads: uploads.length,
        pendingReview: uploads.filter((u) => u.status === UploadStatus.NeedsReview).length,
      };

    case 'GET /admin/users': {
      let list = users.filter((u) => matches(query?.search, u.username, u.displayName, u.participantCode, u.email));
      if (query?.status !== undefined && query?.status !== null) list = list.filter((u) => u.accountStatus === Number(query.status));
      return page(list, query);
    }
    case 'GET /admin/users/:id':
      return find(users, id, 'User');
    case 'POST /admin/users': {
      if (users.some((u) => u.username === body.username)) throw new ApiError(409, 'That username is already taken.');
      // Left empty, the next free P code, as the API gives it.
      const nextCode = () => {
        const used = new Set(users.map((u) => u.participantCode));
        for (let n = 1; n <= 99; n++) if (!used.has(`P${String(n).padStart(2, '0')}`)) return `P${String(n).padStart(2, '0')}`;
        return null;
      };
      const participantCode = String(body.participantCode ?? '').trim().toUpperCase() || nextCode();
      if (participantCode && users.some((u) => u.participantCode === participantCode)) throw new ApiError(409, `Participant code ${participantCode} is already in use.`);
      const created = user(body.username, body.displayName || null, 0, { participantCode, email: body.email || null });
      users.unshift(created);
      return created;
    }
    case 'PATCH /admin/users/:id': {
      const u = find(users, id, 'User');
      if (body.participantCode !== undefined) {
        const participantCode = String(body.participantCode ?? '').trim().toUpperCase() || null;
        if (participantCode && users.some((x) => x.id !== u.id && x.participantCode === participantCode)) throw new ApiError(409, `Participant code ${participantCode} is already in use.`);
        if (u.participantCode && participantCode !== u.participantCode && bases.some((b) => b.participantCode === u.participantCode)) {
          throw new ApiError(409, `${u.participantCode} already has base glazes registered, so it can’t be changed.`);
        }
        u.participantCode = participantCode;
      }
      if (body.displayName !== undefined) u.displayName = body.displayName || null;
      u.updatedAt = new Date().toISOString();
      return u;
    }
    case 'PATCH /admin/users/:id/status':
      find(users, id, 'User').accountStatus = body.status;
      return undefined;
    case 'POST /admin/users/:id/password': {
      // As the API does: the password is checked, never echoed back, and every session ends.
      const password = typeof body?.password === 'string' ? body.password : '';
      if (password.length < 8 || password.length > 256) throw new ApiError(400, 'The password must be between 8 and 256 characters.');
      const u = find(users, id, 'User');
      u.updatedAt = new Date().toISOString();
      const ended = u.id === currentUser.id ? 1 : u.accountStatus === AccountStatus.Active ? 2 : 0;
      return { sessionsEnded: ended };
    }

    case 'GET /admin/recipes': {
      // As the API does: each recipe with its base's name and its live tasks, and the Recipes page's filters.
      // Deleted recipes leave the list; deleted=true lists only them.
      let list = recipes
        .filter((r) => (String(query?.deleted) === 'true' ? !!r.deletedAt : !r.deletedAt))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((r): RecipeDto => ({ ...r, baseName: bases.find((b) => b.code === r.baseCode)?.name ?? null, tasks: liveTasksFor(taskContext, r.id) }));
      if (query?.activeOnly) list = list.filter((r) => r.isActive);
      list = list.filter((r) => matches(query?.search, r.name, r.description, r.code, r.baseName ?? null));
      if (query?.baseCode) list = list.filter((r) => r.baseCode?.toLowerCase() === String(query.baseCode).toLowerCase());
      if (query?.assignedUserId) list = list.filter((r) => r.tasks?.some((t) => t.assignedUserId === query.assignedUserId));
      if (query?.assigned !== undefined && query?.assigned !== null) list = list.filter((r) => (r.tasks?.length ?? 0) > 0 === (String(query.assigned) === 'true'));
      if (query?.taskStage) list = list.filter((r) => r.tasks?.some((t) => t.stage === query.taskStage));
      if (query?.overdue) list = list.filter((r) => r.tasks?.some((t) => t.overdue));
      return page(list, query);
    }
    case 'POST /admin/recipes': {
      const created = recipe(body.name, body.description || null, 0, { recipeJson: body.recipeJson || null });
      recipes.unshift(created);
      return created;
    }
    case 'GET /admin/recipes/:id': {
      const r = find(recipes, id, 'Recipe');
      const why = recipeInUse(r);
      return { ...r, mixEditable: !why, mixLockedBecause: why ? [why] : [] };
    }
    case 'DELETE /admin/recipes/:id': {
      const r = find(recipes, id, 'Recipe');
      deleteRecipe(r, new Date().toISOString());
      return r;
    }
    case 'POST /admin/recipes/:id/restore': {
      const r = find(recipes, id, 'Recipe');
      restoreRecipe(r);
      return r;
    }
    case 'PATCH /admin/recipes/:id': {
      const r = find(recipes, id, 'Recipe');
      if (r.deletedAt) throw new ApiError(409, 'This recipe is deleted. Restore it first.', { code: 'recipe_deleted' });
      if (Array.isArray(body.additions) && JSON.stringify(body.additions) !== (r.additionsJson || '[]')) {
        const base = bases.find((b) => b.code === r.baseCode);
        if (!base) throw new ApiError(400, 'Only a variation of a registered base has additions to change.', { code: 'not_a_variation' });
        const why = recipeInUse(r);
        if (why) throw new ApiError(409, `${why}, so what goes in it stays as it is. Add a new variation to try a change.`, { code: 'recipe_in_use' });
        rebuild(r, base, body.additions);
        r.mixChangedAt = new Date().toISOString();
      }
      const cone = normalizeCone(body.cone);
      const atmosphere = normalizeAtmosphere(body.atmosphere);
      if ((cone != null && (cone || null) !== (r.cone ?? null)) || (atmosphere != null && (atmosphere || null) !== (r.atmosphere ?? null))) {
        const why = recipeInUse(r);
        if (why) throw new ApiError(409, `${why}, so its firing stays as it is. Make a new variation for a different firing.`, { code: 'recipe_in_use' });
        if (cone != null) r.cone = cone || null;
        if (atmosphere != null) r.atmosphere = atmosphere || null;
        refreshFiring(r);
      }
      if (body.name !== undefined && body.name !== null) r.name = body.name;
      if (body.description !== undefined) r.description = body.description || null;
      if (typeof body.isActive === 'boolean') r.isActive = body.isActive;
      r.updatedAt = new Date().toISOString();
      return r;
    }
    case 'GET /admin/recipes/by-code/:code':
      return recipeByCode(code);
    case 'PATCH /admin/recipes/by-code/:code': {
      const r = recipeByCode(code);
      if (body.outcomeNote !== undefined) r.outcomeNote = body.outcomeNote || null;
      if (typeof body.isActive === 'boolean') r.isActive = body.isActive;
      r.updatedAt = new Date().toISOString();
      return r;
    }

    case 'GET /admin/base-glazes': {
      const wanted = String(query?.participantCode ?? '').trim().toUpperCase();
      const deleted = String(query?.deleted) === 'true';
      return bases
        .filter((b) => (!wanted || b.participantCode === wanted) && !!b.deletedAt === deleted)
        .sort((a, b) => (a.participantCode ?? '').localeCompare(b.participantCode ?? '') || a.baseNumber - b.baseNumber)
        .map(baseView);
    }
    case 'POST /admin/base-glazes': {
      const owner = body.userId ? find(users, body.userId, 'User') : null;
      const participantCode = String(body.participantCode ?? owner?.participantCode ?? '').trim().toUpperCase();
      if (!participantCode) throw new ApiError(400, 'Choose the participant this base belongs to.');
      return baseView(registerBase(participantCode, body));
    }
    case 'GET /admin/base-glazes/:code': {
      const base = findBase(code);
      return { ...baseView(base), formulationEditable: baseMade(base).length === 0, formulationLockedBecause: baseMade(base) };
    }
    case 'PATCH /admin/base-glazes/:code':
      return updateBase(findBase(code), body ?? {});
    case 'DELETE /admin/base-glazes/:code': {
      const base = findBase(code);
      if (!base.deletedAt) {
        const made = baseMade(base);
        if (made.length) throw new ApiError(409, `${base.code} is already in use (${made.slice(0, 3).join('; ')}), so it stays in the records.`, { code: 'base_in_use' });
        const at = new Date().toISOString();
        recipes.filter((r) => r.baseCode === base.code && !r.deletedAt).forEach((r) => deleteRecipe(r, at));
        base.deletedAt = at;
      }
      return baseView(base);
    }
    case 'POST /admin/base-glazes/:code/restore': {
      const base = findBase(code);
      if (base.deletedAt) {
        const at = base.deletedAt;
        base.deletedAt = null;
        recipes.filter((r) => r.baseCode === base.code && r.deletedAt === at).forEach(restoreRecipe);
      }
      return baseView(base);
    }
    case 'POST /admin/base-glazes/:code/recipes':
      return addVariation(findBase(code), body);
    case 'POST /admin/base-glazes/:code/recipes/batch': {
      const base = findBase(code);
      const wanted: any[] = body?.variations ?? [];
      if (wanted.length === 0) throw new ApiError(400, 'Send at least one variation.');
      const left = MAX_VARIATIONS_PER_BASE - base.lastRecipeNumber;
      if (wanted.length > left) throw new ApiError(409, `${base.code} has room for ${left} more variation${left === 1 ? '' : 's'}, not ${wanted.length}.`);
      const target = body?.captureCodeId ? find(codes, body.captureCodeId, 'Capture code') : null;
      const created = wanted.map((v) => addVariation(base, v));
      if (target) target.recipeIds = Array.from(new Set([...target.recipeIds, ...created.map((r) => r.id)]));
      return created;
    }
    case 'POST /admin/recipes/by-code/:code/promote':
      return promote(code, body ?? {});

    case 'GET /admin/capture-codes': {
      let list = codes;
      if (query?.activeOnly) list = list.filter((c) => c.isActive);
      if (query?.assignedUserId) list = list.filter((c) => c.assignedUserId === query.assignedUserId);
      return page(list.map(codeView), query);
    }
    case 'POST /admin/capture-codes': {
      const owner = find(users, body.assignedUserId, 'User');
      const plain = Array.from({ length: 3 }, () => Math.random().toString(36).slice(2, 6).toUpperCase()).join('-');
      const created: MockCode = { id: uid(), plainCode: plain, maskedSuffix: plain.slice(-4), assignedUserId: owner.id, assignedUsername: owner.username, labelPrefix: body.labelPrefix || null, isActive: true, createdAt: new Date().toISOString(), expiresAt: body.expiresAt ?? null, revokedAt: null, recipeIds: [] };
      codes.unshift({ ...created, plainCode: null });
      return codeView(created);
    }
    case 'GET /admin/capture-codes/:id':
      return codeView(find(codes, id, 'Capture code'));
    case 'POST /admin/capture-codes/:id/revoke': {
      const c = find(codes, id, 'Capture code');
      c.isActive = false;
      c.revokedAt = new Date().toISOString();
      return undefined;
    }
    case 'GET /admin/capture-codes/:id/recipes': {
      const c = find(codes, id, 'Capture code');
      return recipes.filter((r) => c.recipeIds.includes(r.id));
    }
    case 'POST /admin/capture-codes/:id/recipes': {
      // Adds to the code's recipes; ids already on it are ignored. Every id must be an active recipe.
      const c = find(codes, id, 'Capture code');
      const ids: string[] = body.recipeIds ?? [];
      const inactive = ids.map((x) => find(recipes, x, 'Recipe')).find((r) => !r.isActive);
      if (inactive) throw new ApiError(400, `${inactive.code ?? inactive.name ?? 'A recipe'} isn’t active, so it can’t be added.`);
      c.recipeIds = Array.from(new Set([...c.recipeIds, ...ids]));
      return undefined;
    }
    case 'DELETE /admin/capture-codes/:id/recipes/:id': {
      const c = find(codes, id, 'Capture code');
      c.recipeIds = c.recipeIds.filter((x) => x !== id2);
      return undefined;
    }

    case 'GET /admin/images': {
      let list = images;
      if (query?.approval) list = list.filter((i) => i.approvalStatus === query.approval);
      if (query?.quality) list = list.filter((i) => i.qualityStatus === query.quality);
      if (query?.chemistry) list = list.filter((i) => i.chemistryStatus === query.chemistry);
      return cursorPage(list, query, 25);
    }
    case 'GET /admin/images/:id':
      return findImage(id);
    case 'POST /admin/images/:id/approve': {
      const img = findImage(id);
      if (body?.recipeId) {
        const r = find(recipes, body.recipeId, 'Recipe');
        img.recipes = link(r);
        img.chemistry = snapshot(r);
        img.chemistryStatus = 'Linked';
      }
      img.approvalStatus = 'Approved';
      img.approvedAt = new Date().toISOString();
      return undefined;
    }
    case 'POST /admin/images/:id/reject': {
      const img = findImage(id);
      img.approvalStatus = 'Rejected';
      img.approvedAt = null;
      return undefined;
    }
    case 'POST /admin/images/derivatives/backfill':
      return { enqueued: body?.imageIds?.length ?? images.length };

    case 'GET /admin/imports':
      return page([...batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ records, clayBody, ...b }) => b), query);
    case 'POST /admin/imports': {
      if (!String(body?.name ?? '').trim()) throw new ApiError(400, 'Give the import a name.');
      const created: MockBatch = {
        id: uid(), name: body.name, sourceLabel: body.sourceLabel || null, defaultTileVariantKey: body.defaultTileVariantKey || null, autoApprove: !!body.autoApprove,
        status: 'Open', createdBy: currentUser.id, createdAt: new Date().toISOString(), closedAt: null, counts: batchCounts({}), records: [], clayBody: null,
      };
      batches.push(created);
      const { records, clayBody, ...dto } = created;
      return dto;
    }
    case 'GET /admin/imports/:id': {
      const { records, clayBody, ...dto } = find(batches, id, 'Import');
      return dto;
    }
    case 'GET /admin/imports/:id/records': {
      let list = find(batches, id, 'Import').records;
      if (query?.status) list = list.filter((r) => r.status === query.status);
      return cursorPage(list, query, 25);
    }
    case 'POST /admin/imports/:id/records': {
      const batch = find(batches, id, 'Import');
      if (batch.status === 'Closed') throw new ApiError(409, 'This import is closed.');
      return {
        batchId: batch.id,
        records: (body?.records ?? []).map((row: any) => {
          const errors: string[] = [];
          if (batch.records.some((r) => r.externalRecordId === row.externalRecordId)) errors.push('Already in this import.');
          if (!String(row.contentType ?? '').startsWith('image/')) errors.push('Not an image.');
          const recipe = row.recipeCode ? recipes.find((r) => r.code?.toLowerCase() === String(row.recipeCode).toLowerCase()) : undefined;
          const warnings = row.recipeCode && !recipe ? [`No recipe ${row.recipeCode} in the register; the photo will have no chemistry.`] : !row.recipeCode ? ['No recipe given; the photo will have no chemistry.'] : [];
          if (errors.length) return { externalRecordId: row.externalRecordId, accepted: false, status: 'Failed', objectKey: null, upload: null, errors, warnings };
          const recordId = uid();
          batch.records.push({
            id: recordId, externalRecordId: row.externalRecordId, objectKey: `prod/originals/imports/${recordId}`, status: 'Registered', failureCode: null, failureDetail: null,
            imageId: null, qualityStatus: 'Pending', approvalStatus: 'Pending', chemistryStatus: recipe ? 'Linked' : 'Missing', chemistryWarningsJson: null, createdAt: new Date().toISOString(), uploadedAt: null,
          });
          recount(batch);
          return {
            externalRecordId: row.externalRecordId, accepted: true, status: 'Registered', objectKey: `prod/originals/imports/${recordId}`,
            upload: { uploadId: recordId, method: 'PUT', url: `mock://storage/${recordId}`, objectKey: `prod/originals/imports/${recordId}`, expiresAt: new Date(Date.now() + 600_000).toISOString(), headers: null },
            errors: [], warnings,
          };
        }),
      };
    }
    case 'POST /admin/imports/:id/records/complete': {
      const batch = find(batches, id, 'Import');
      const out = (body?.externalRecordIds ?? []).map((ext: string) => {
        const record = batch.records.find((r) => r.externalRecordId === ext);
        if (!record) return { externalRecordId: ext, status: 'Failed', imageId: null, error: 'Not registered in this import.' };
        record.uploadedAt = new Date().toISOString();
        record.status = /blur/i.test(ext) ? 'NeedsReview' : 'Validated';
        record.qualityStatus = record.status === 'NeedsReview' ? 'NeedsReview' : 'Passed';
        record.imageId = uid();
        return { externalRecordId: ext, status: record.status, imageId: record.imageId, error: null };
      });
      recount(batch);
      return { batchId: batch.id, records: out };
    }
    case 'POST /admin/imports/:id/close': {
      const batch = find(batches, id, 'Import');
      batch.status = 'Closed';
      batch.closedAt = new Date().toISOString();
      return undefined;
    }

    // Cup experiments run their arithmetic on the API; the sample data has none to show.
    case 'GET /admin/experiments':
    case 'GET /me/experiments':
      return [];
    case 'POST /admin/experiments':
      throw new ApiError(400, 'Cup experiments aren’t in the sample data. Try them against the API.', { code: 'validation_error' });

    case 'GET /admin/settings/search':
      return searchSettings;
    case 'PUT /admin/settings/search':
      if (typeof body?.strictFiring === 'boolean') searchSettings = { strictFiring: body.strictFiring, updatedAt: new Date().toISOString() };
      return searchSettings;
    case 'GET /admin/index/status':
      return indexStatus();
    case 'POST /admin/index/rebuild':
      return { enqueued: body?.imageIds?.length ?? indexStatus().approvedImages + (body?.includeNonApproved ? images.length - indexStatus().approvedImages : 0) };
    case 'GET /admin/jobs': {
      let list = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (query?.status) list = list.filter((j) => j.status === query.status);
      if (query?.jobType) list = list.filter((j) => j.jobType === query.jobType);
      return cursorPage(list, query, 25);
    }
    case 'POST /admin/jobs/:id/retry': {
      const job = find(jobs, id, 'Job');
      if (job.status !== 'Failed' && job.status !== 'DeadLetter') throw new ApiError(409, 'Only failed jobs can be retried.');
      Object.assign(job, { status: 'Queued', attempts: 0, errorCode: null, errorDetail: null, availableAt: new Date().toISOString(), startedAt: null, completedAt: null });
      return undefined;
    }

    case 'POST /admin/images/clay-body': {
      const clayBody = String(body?.clayBody ?? '').trim();
      if (!clayBody) throw new ApiError(400, 'Choose a clay body.');
      const onlyIfMissing = !!body?.onlyIfMissing;
      if (body?.importBatchId) {
        const batch = find(batches, body.importBatchId, 'Import');
        const updated = onlyIfMissing && batch.clayBody ? 0 : batch.counts.total;
        if (updated) batch.clayBody = clayBody;
        return { clayBody, matched: batch.counts.total, updated, reindexQueued: updated };
      }
      const ids: string[] = body?.imageIds ?? [];
      const matched = uploads.filter((u) => u.imageId && ids.includes(u.imageId));
      const changed = matched.filter((u) => !(onlyIfMissing && u.clayBody));
      changed.forEach((u) => (u.clayBody = clayBody));
      return { clayBody, matched: matched.length, updated: changed.length, reindexQueued: changed.length };
    }

    case 'GET /admin/uploads': {
      let list = uploads;
      if (query?.status !== undefined && query?.status !== null) list = list.filter((u) => u.status === Number(query.status));
      if (query?.ownerUserId) list = list.filter((u) => u.ownerUserId === query.ownerUserId);
      return page(list, query);
    }
    case 'POST /admin/uploads/:id/approve': {
      const u = find(uploads, id, 'Upload');
      if (body?.recipeId) Object.assign(u, recipeFields(find(recipes, body.recipeId, 'Recipe')));
      u.status = UploadStatus.Approved;
      u.qualityStatus = 'Passed';
      u.reviewedAt = new Date().toISOString();
      u.reviewNote = body?.note || null;
      return undefined;
    }
    case 'POST /admin/uploads/:id/reject': {
      const u = find(uploads, id, 'Upload');
      u.status = UploadStatus.Rejected;
      u.reviewedAt = new Date().toISOString();
      u.reviewNote = body?.reason || null;
      return undefined;
    }
  }

  throw new ApiError(404, `No mock for ${route}`);
}

export async function mockStorageUpload(uploadId: string, file: Blob, onProgress?: (fraction: number) => void, back = false) {
  for (let step = 1; step <= 10; step++) {
    await wait(120);
    onProgress?.(step / 10);
  }
  const u = uploads.find((x) => x.id === uploadId);
  if (u && back) u.backUrl = URL.createObjectURL(file);
  else if (u) {
    u.downloadUrl = URL.createObjectURL(file);
    u.thumbnailUrl = u.downloadUrl;
  }
}
