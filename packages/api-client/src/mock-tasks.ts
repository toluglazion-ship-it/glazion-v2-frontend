// Tile tasks for the in-memory mock (mock.ts): the same rules as the API (Glazion-v2 docs/tile-tasks.md), kept small.
// A task's photo stages are read from the mock uploads, so approving or rejecting a photo in the admin moves its task.
import {
  AccountStatus,
  UploadStatus,
  UserRole,
  type AdminUploadDto,
  type CaptureLookupDto,
  type ClayBody,
  type MatchCheckMaterial,
  type RecipeDto,
  type TaskRecipeDto,
  type TileTaskDto,
  type TileTaskEventDto,
  type TileTaskEventKind,
  type TileTaskStage,
  type UserDto,
} from '@glazion/types';
import { uid } from './uid';
import { ApiError } from './index';

type Query = Record<string, string | number | boolean | null | undefined> | undefined;

export interface TaskContext {
  users: UserDto[];
  recipes: RecipeDto[];
  uploads: AdminUploadDto[];
  currentUser: () => UserDto;
  /** Whether the participant has an active capture code. */
  canUpload: (userId: string) => boolean;
}

interface MockTask {
  id: string;
  recipeId: string;
  clayBody: ClayBody;
  assignedUserId: string;
  assignedAt: string;
  dueOn: string | null;
  note: string | null;
  startedAt?: string | null;
  doneAt: string | null;
  approvedAt?: string | null;
  returnNote?: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: string;
  events: Omit<TileTaskEventDto, 'actorUsername' | 'fromUsername' | 'toUsername'>[];
}

const ALL_BODIES: ClayBody[] = ['porcelain', 'stoneware', 'red_body'];
const SENT = [UploadStatus.Uploaded, UploadStatus.Validating, UploadStatus.NeedsReview, UploadStatus.Approved, UploadStatus.Rejected, UploadStatus.Indexing, UploadStatus.Indexed, UploadStatus.Failed];
const REVIEWING = [UploadStatus.Uploaded, UploadStatus.Validating, UploadStatus.NeedsReview];
const ACCEPTED = [UploadStatus.Approved, UploadStatus.Indexing, UploadStatus.Indexed];

const tasks: MockTask[] = [];
/** Which task each mock upload was taken for. */
export const uploadTasks = new Map<string, string>();

const isoDay = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const today = () => isoDay(0);

function event(task: MockTask, kind: TileTaskEventKind, actorUserId: string, extra: Partial<MockTask['events'][number]> = {}) {
  task.events.push({ kind, at: new Date().toISOString(), actorUserId, fromUserId: null, toUserId: null, note: null, ...extra });
}

function touch(task: MockTask) {
  task.updatedAt = new Date().toISOString();
  task.version = uid();
}

/** The latest photo sent for the task's current assignment. */
function photo(ctx: TaskContext, task: MockTask): AdminUploadDto | undefined {
  return ctx.uploads
    .filter((u) => uploadTasks.get(u.id) === task.id && SENT.includes(u.status) && u.createdAt >= task.assignedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** As the API: assigned → started (recipe shown and locked) → made → checked and approved → photo in review → approved. */
function stageOf(ctx: TaskContext, task: MockTask): TileTaskStage {
  const p = photo(ctx, task);
  if (task.cancelledAt) return 'Cancelled';
  if (p && ACCEPTED.includes(p.status)) return 'Approved';
  if (p && REVIEWING.includes(p.status)) return 'InReview';
  if (p || task.approvedAt) return 'AwaitingPhoto';
  if (task.doneAt) return 'Done';
  return task.startedAt ? 'Started' : 'Assigned';
}

/** The recipe as the participant mixes it, rows marked by kind (a rough guess from the name in the mock). */
function recipeOf(recipe: RecipeDto | undefined): TaskRecipeDto | null {
  if (!recipe) return null;
  const kind = (name: string) => (/stain|mason/i.test(name) ? 'stain' : /oxide|carbonate|rutile|ilmenite|cobalt|copper|chrome/i.test(name) ? 'colorant' : null);
  const rows = (list: any): MatchCheckMaterial[] =>
    Array.isArray(list) ? list.map((r: any) => ({ name: r.rawName ?? r.name ?? '?', amount: Number.isFinite(Number(r.amount)) ? Number(r.amount) : null, unit: r.unit ?? '%', kind: kind(String(r.rawName ?? r.name ?? '')) })) : [];
  let stored: any = {};
  try {
    stored = JSON.parse(recipe.recipeJson || '{}') ?? {};
  } catch {
    stored = {};
  }
  let additions: MatchCheckMaterial[] = [];
  try {
    additions = rows(JSON.parse(recipe.additionsJson || '[]'));
  } catch {
    additions = [];
  }
  return {
    description: recipe.description || null,
    baseCode: recipe.baseCode,
    baseName: null,
    base: rows(stored.baseFormulation),
    additions,
    materials: rows(stored.full ?? stored.materials ?? stored.rows),
    cone: recipe.firingCone ?? null,
    atmosphere: recipe.firingAtmosphere ?? null,
  };
}

function view(ctx: TaskContext, task: MockTask, withHistory = false, withRecipe = false): TileTaskDto {
  const recipe = ctx.recipes.find((r) => r.id === task.recipeId);
  const user = ctx.users.find((u) => u.id === task.assignedUserId);
  const name = (id: string | null) => (id ? (ctx.users.find((u) => u.id === id)?.username ?? null) : null);
  const p = photo(ctx, task);
  const stage = stageOf(ctx, task);
  const retake = stage === 'AwaitingPhoto' && p ? (p.status === UploadStatus.Rejected ? (p.reviewNote ?? 'The photo was rejected.') : (p.failureReason ?? 'The photo did not pass the quality checks.')) : null;
  return {
    ...task,
    events: undefined,
    recipeCode: recipe?.code ?? null,
    recipeName: recipe?.name ?? 'Recipe',
    baseCode: recipe?.baseCode ?? null,
    assignedUsername: user?.username ?? 'unknown',
    assignedDisplayName: user?.displayName ?? null,
    participantCode: user?.participantCode ?? null,
    stage,
    overdue: (stage === 'Assigned' || stage === 'Started') && !!task.dueOn && task.dueOn < today(),
    photoUploadId: p?.id ?? null,
    photoStatus: p?.status ?? null,
    retakeReason: retake,
    // Only once they press Start: until then the admin may still change it.
    recipe: withRecipe && stage !== 'Assigned' ? recipeOf(recipe) : null,
    startedAt: task.startedAt ?? null,
    approvedAt: task.approvedAt ?? null,
    returnNote: stage === 'Started' ? (task.returnNote ?? null) : null,
    // The admin changed the recipe after Start, until the tile is approved.
    recipeChangedAt: task.startedAt && !task.approvedAt && recipe?.mixChangedAt && recipe.mixChangedAt > task.startedAt ? recipe.mixChangedAt : null,
    history: withHistory
      ? task.events.map((e) => ({ ...e, actorUsername: name(e.actorUserId), fromUsername: name(e.fromUserId), toUsername: name(e.toUserId) }))
      : null,
  } as TileTaskDto;
}

function participant(ctx: TaskContext, userId: string): UserDto {
  const user = ctx.users.find((u) => u.id === userId);
  if (!user) throw new ApiError(400, 'That participant does not exist.', { code: 'validation_error' });
  if (user.role !== UserRole.Standard) throw new ApiError(400, 'Tasks go to participants, not administrators.', { code: 'validation_error' });
  if (user.accountStatus !== AccountStatus.Active) throw new ApiError(400, `@${user.username}'s account is not active.`, { code: 'validation_error' });
  return user;
}

function checkDue(dueOn: string | null | undefined) {
  if (dueOn && dueOn < today()) throw new ApiError(400, 'The due date has already passed.', { code: 'validation_error' });
  return dueOn || null;
}

function locked(ctx: TaskContext, task: MockTask): string | null {
  const stage = stageOf(ctx, task);
  return stage === 'Cancelled' ? 'cancelled' : stage === 'InReview' ? 'in_review' : stage === 'Approved' ? 'approved' : null;
}

const REASON: Record<TileTaskStage, string> = {
  Assigned: 'not_started',
  Started: 'not_done',
  Done: 'done',
  AwaitingPhoto: 'awaiting_photo',
  InReview: 'in_review',
  Approved: 'approved',
  Cancelled: 'cancelled',
};

/** A tile moves to someone else until an admin has checked it (meeting 2026-11-02). */
function notMovable(ctx: TaskContext, task: MockTask): string | null {
  const stage = stageOf(ctx, task);
  return stage === 'Assigned' || stage === 'Started' || stage === 'Done' ? null : REASON[stage];
}

/** A photo only once an admin has checked the made tile and approved it. */
function notPhotographable(ctx: TaskContext, task: MockTask): string | null {
  const stage = stageOf(ctx, task);
  if (stage === 'AwaitingPhoto') return null;
  if (stage === 'Done') return 'not_approved';
  return stage === 'Assigned' || stage === 'Started' ? 'not_made' : REASON[stage];
}

function refuse(why: string): never {
  if (why === 'not_made') throw new ApiError(409, 'This tile isn’t made yet. It can be photographed once it is made and an admin has checked it.', { code: 'task_not_done' });
  if (why === 'not_approved') throw new ApiError(409, 'This tile is waiting for an admin to check it. It can be photographed once it is approved.', { code: 'task_not_approved' });
  if (why === 'done') throw new ApiError(409, 'This tile is already made. Return it first if it should be made again by someone else.', { code: 'task_done' });
  if (why === 'awaiting_photo') throw new ApiError(409, 'This tile is made and approved, waiting for its photo, so it stays with whoever made it.', { code: 'task_awaiting_photo' });
  if (why === 'cancelled') throw new ApiError(409, 'This task was cancelled.', { code: 'task_cancelled' });
  if (why === 'in_review') throw new ApiError(409, 'A photo of this tile is waiting for review. Approve or reject it first.', { code: 'task_in_review' });
  if (why === 'approved') throw new ApiError(409, 'This tile’s photo is already approved.', { code: 'task_approved' });
  if (why === 'same_participant') throw new ApiError(400, 'This task is already with that participant.', { code: 'validation_error' });
  throw new ApiError(404, 'No task with this ID was found.', { code: 'task_not_found' });
}

function ordered(ctx: TaskContext, list: MockTask[]): MockTask[] {
  return [...list].sort((a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') || a.createdAt.localeCompare(b.createdAt));
}

function filtered(ctx: TaskContext, query: Query): MockTask[] {
  const q = String(query?.q ?? '').trim().toLowerCase();
  return tasks.filter((t) => {
    if (query?.userId && t.assignedUserId !== query.userId) return false;
    if (query?.recipeId && t.recipeId !== query.recipeId) return false;
    if (query?.clayBody && t.clayBody !== query.clayBody) return false;
    if (q) {
      const r = ctx.recipes.find((x) => x.id === t.recipeId);
      const u = ctx.users.find((x) => x.id === t.assignedUserId);
      if (![r?.name, r?.code, u?.username].some((v) => v?.toLowerCase().includes(q))) return false;
    }
    return true;
  });
}

function assign(ctx: TaskContext, body: any) {
  const recipeIds: string[] = [...new Set<string>(body?.recipeIds ?? [])];
  if (recipeIds.length === 0) throw new ApiError(400, 'Choose at least one recipe.', { code: 'validation_error' });
  const bodies: ClayBody[] = body?.clayBodies?.length ? body.clayBodies : ALL_BODIES;
  const user = participant(ctx, body.assignedUserId);
  const dueOn = checkDue(body.dueOn);
  const admin = ctx.currentUser();
  const created: MockTask[] = [];
  const skipped = [];
  for (const recipeId of recipeIds) {
    const recipe = ctx.recipes.find((r) => r.id === recipeId && r.isActive);
    if (!recipe) throw new ApiError(400, 'One or more recipes do not exist or are not active.', { code: 'validation_error' });
    for (const clayBody of bodies) {
      const existing = tasks.find((t) => t.recipeId === recipeId && t.clayBody === clayBody && !t.cancelledAt);
      if (existing) {
        skipped.push({ recipeId, recipeCode: recipe.code, recipeName: recipe.name ?? 'Recipe', clayBody, existingTaskId: existing.id, assignedUserId: existing.assignedUserId,
          assignedUsername: ctx.users.find((u) => u.id === existing.assignedUserId)?.username ?? 'unknown' });
        continue;
      }
      const now = new Date(Date.now() + created.length).toISOString();
      const task: MockTask = { id: uid(), recipeId, clayBody, assignedUserId: user.id, assignedAt: now, dueOn, note: body.note?.trim() || null, doneAt: null, cancelledAt: null,
        createdAt: now, updatedAt: now, version: uid(), events: [] };
      event(task, 'Assigned', admin.id, { toUserId: user.id });
      created.push(task);
    }
  }
  tasks.push(...created);
  return { created: created.map((t) => view(ctx, t)), skipped, participantCanUpload: ctx.canUpload(user.id) };
}

function reassign(ctx: TaskContext, ids: string[], body: any, single: boolean) {
  const user = participant(ctx, body.assignedUserId);
  const dueOn = checkDue(body.dueOn);
  const admin = ctx.currentUser();
  const moved: MockTask[] = [];
  const skipped: { taskId: string; reason: string }[] = [];
  for (const id of ids) {
    const task = tasks.find((t) => t.id === id);
    const why = !task ? 'not_found' : (notMovable(ctx, task) ?? (task.assignedUserId === user.id ? 'same_participant' : null));
    if (single && why) refuse(why);
    if (single && body.version && body.version !== task!.version) throw new ApiError(409, 'Someone changed this task since you opened it. Refresh and try again.', { code: 'task_changed' });
    if (why) { skipped.push({ taskId: id, reason: why }); continue; }
    event(task!, 'Reassigned', admin.id, { fromUserId: task!.assignedUserId, toUserId: user.id, note: body.reason?.trim() || null });
    Object.assign(task!, { assignedUserId: user.id, assignedAt: new Date().toISOString(), startedAt: null, doneAt: null, approvedAt: null, returnNote: null, dueOn: dueOn ?? task!.dueOn });
    touch(task!);
    moved.push(task!);
  }
  return { reassigned: moved.map((t) => view(ctx, t)), skipped, participantCanUpload: ctx.canUpload(user.id) };
}

function mine(ctx: TaskContext, id: string): MockTask {
  const task = tasks.find((t) => t.id === id && t.assignedUserId === ctx.currentUser().id && !t.cancelledAt);
  if (!task) refuse('not_found');
  return task;
}

/**
 * The task a new mock photo is for, as the API decides it: the one named (checked), or the caller's task for the same
 * recipe and clay body. Either way only once an admin has approved the made tile; then anyone may photograph it.
 */
export function taskForUpload(ctx: TaskContext, taskId: string | null | undefined, recipe: RecipeDto | undefined, clayBody: string | null | undefined) {
  const user = ctx.currentUser();
  let task: MockTask | undefined;
  if (taskId) {
    task = tasks.find((t) => t.id === taskId && !t.cancelledAt);
    if (!task) throw new ApiError(400, 'This tile task does not exist, or it was cancelled.', { code: 'task_not_found' });
    const why = notPhotographable(ctx, task);
    if (why) refuse(why);
  } else if (recipe && clayBody) {
    task = tasks.find((t) => t.recipeId === recipe.id && t.clayBody === clayBody && t.assignedUserId === user.id && !t.cancelledAt);
    const why = task ? notPhotographable(ctx, task) : null;
    if (why === 'not_made' || why === 'not_approved') refuse(why);
    if (why) task = undefined;
  }
  return task ? { id: task.id, recipe: ctx.recipes.find((r) => r.id === task!.recipeId), clayBody: task.clayBody } : null;
}

/** GET /capture/tiles/{code}: the recipe with this code and its tiles, and which can be photographed now. */
export function captureTiles(ctx: TaskContext, recipe: RecipeDto, baseName: string | null): CaptureLookupDto {
  const user = ctx.currentUser();
  const list = tasks.filter((t) => t.recipeId === recipe.id && !t.cancelledAt).sort((a, b) => a.clayBody.localeCompare(b.clayBody) || a.assignedAt.localeCompare(b.assignedAt));
  return {
    recipeId: recipe.id,
    code: recipe.code,
    name: recipe.name,
    baseCode: recipe.baseCode,
    baseName,
    cone: recipe.firingCone ?? null,
    atmosphere: recipe.firingAtmosphere ?? null,
    tiles: list.map((t) => {
      const v = view(ctx, t);
      const mine = t.assignedUserId === user.id;
      const status =
        v.stage === 'AwaitingPhoto' ? 'ready' : v.stage === 'Done' ? 'not_approved' : v.stage === 'Assigned' || v.stage === 'Started' ? 'not_done' : v.stage === 'InReview' ? 'in_review' : 'approved';
      return { taskId: t.id, clayBody: t.clayBody, stage: v.stage, status, madeByUsername: v.assignedUsername, mine, doneAt: t.doneAt, retakeReason: v.retakeReason };
    }),
  };
}

/** Picks tasks for approve or return; the rest are skipped with why. */
function pick(ctx: TaskContext, ids: string[], ok: (task: MockTask, stage: TileTaskStage) => boolean) {
  if (!ids.length) throw new ApiError(400, 'Choose at least one task.', { code: 'validation_error' });
  const picked: MockTask[] = [];
  const skipped: { taskId: string; reason: string }[] = [];
  for (const id of ids) {
    const task = tasks.find((t) => t.id === id);
    if (!task) skipped.push({ taskId: id, reason: 'not_found' });
    else if (ok(task, stageOf(ctx, task))) picked.push(task);
    else skipped.push({ taskId: id, reason: REASON[stageOf(ctx, task)] });
  }
  return { picked, skipped };
}

/** As the API: a live task locks its recipe once its participant has started it (or the tile was made). */
/** As the API: a recipe locks once a tile of it has been checked and approved (meeting 2026-11-02). */
export const taskApproved = (recipeId: string) => tasks.some((t) => t.recipeId === recipeId && !!t.approvedAt);

/** Deleting a recipe cancels its open tiles, at the same moment, so restoring it brings exactly those back. */
export function cancelTasksOf(ctx: TaskContext, recipeId: string, at: string, note: string) {
  for (const task of tasks.filter((t) => t.recipeId === recipeId && !t.cancelledAt)) {
    task.cancelledAt = at;
    event(task, 'Cancelled', ctx.currentUser().id, { note });
    touch(task);
  }
}

export function restoreTasksOf(ctx: TaskContext, recipeId: string, at: string, note: string) {
  for (const task of tasks.filter((t) => t.recipeId === recipeId && t.cancelledAt === at)) {
    if (tasks.some((t) => t.recipeId === recipeId && t.clayBody === task.clayBody && !t.cancelledAt)) continue;
    task.cancelledAt = null;
    event(task, 'Restored', ctx.currentUser().id, { note });
    touch(task);
  }
}

/** A recipe's live tasks, soonest due first, as the admin recipes list carries them. */
export function liveTasksFor(ctx: TaskContext, recipeId: string): TileTaskDto[] {
  return ordered(ctx, tasks.filter((t) => t.recipeId === recipeId && !t.cancelledAt)).map((t) => view(ctx, t));
}

/** POST /admin/tasks, for the one-step base registration. */
export const assignTasks = (ctx: TaskContext, body: any) => assign(ctx, body);

export const hasLiveTask = (userId: string, recipeId: string) => tasks.some((t) => t.assignedUserId === userId && t.recipeId === recipeId && !t.cancelledAt);

/** Starter tasks for the Capture user, so the mock shows every stage. */
export function seedTasks(ctx: TaskContext, participantId: string, adminId: string, recipeIds: string[], otherId?: string) {
  if (tasks.length > 0) return;
  const [a, b, c] = recipeIds;
  const make = (recipeId: string, clayBody: ClayBody, dueIn: number, note: string | null, to = participantId) => {
    const at = new Date(Date.now() - 86_400_000 * 2 + tasks.length).toISOString();
    const task: MockTask = { id: uid(), recipeId, clayBody, assignedUserId: to, assignedAt: at, dueOn: isoDay(dueIn), note, doneAt: null, cancelledAt: null,
      createdAt: at, updatedAt: at, version: uid(), events: [] };
    event(task, 'Assigned', adminId, { toUserId: to });
    tasks.push(task);
    return task;
  };
  const now = () => new Date().toISOString();
  const started = (task: MockTask, by: string) => { task.startedAt = now(); event(task, 'Started', by); return task; };
  const made = (task: MockTask, by: string) => { started(task, by); task.doneAt = now(); event(task, 'MarkedDone', by); return task; };
  make(a, 'porcelain', 2, 'Two dips, 3 seconds each.'); // not started: the recipe is hidden
  started(make(a, 'stoneware', 2, null), participantId);
  make(b, 'red_body', -1, null); // overdue
  made(make(c, 'porcelain', 5, null), participantId); // waiting for the admin to check it
  // Made and approved: on their To photograph tab, ready to snap.
  const ready = made(make(c, 'stoneware', 5, null), participantId);
  ready.approvedAt = now();
  event(ready, 'CompositionApproved', adminId);
  if (otherId) {
    // tunde.b made one and the admin approved it: anyone can photograph it by its code.
    const theirs = made(make(a, 'red_body', 3, null, otherId), otherId);
    theirs.approvedAt = now();
    event(theirs, 'CompositionApproved', adminId);
  }
}

/** Who a task is with: the tile's maker. */
export const taskMaker = (ctx: TaskContext, taskId: string) => ctx.users.find((u) => u.id === tasks.find((t) => t.id === taskId)?.assignedUserId)?.username ?? null;

export function handleTasksRequest(ctx: TaskContext, method: string, path: string, query: Query, body: any): { found: boolean; value?: unknown } {
  const route = `${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')}`;
  const id = path.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0] ?? '';
  const found = (value: unknown) => ({ found: true, value });
  const page = (list: MockTask[]) => {
    const start = Number(query?.cursor ?? 0) || 0;
    const end = start + (Number(query?.pageSize) || 25);
    return { items: list.slice(start, end).map((t) => view(ctx, t)), totalCount: list.length, nextCursor: end < list.length ? String(end) : null };
  };

  switch (route) {
    case 'GET /admin/tasks': {
      let list = filtered(ctx, query);
      list = query?.stage ? list.filter((t) => stageOf(ctx, t) === query.stage) : list.filter((t) => !t.cancelledAt);
      if (String(query?.overdue) === 'true') list = list.filter((t) => view(ctx, t).overdue);
      return found(page(ordered(ctx, list)));
    }
    case 'GET /admin/tasks/summary': {
      const list = filtered(ctx, query);
      const count = (stage: TileTaskStage) => list.filter((t) => stageOf(ctx, t) === stage).length;
      return found({ assigned: count('Assigned'), started: count('Started'), done: count('Done'), awaitingPhoto: count('AwaitingPhoto'), inReview: count('InReview'),
        approved: count('Approved'), cancelled: count('Cancelled'), overdue: list.filter((t) => view(ctx, t).overdue).length });
    }
    case 'GET /admin/tasks/:id': {
      const task = tasks.find((t) => t.id === id) ?? refuse('not_found');
      return found(view(ctx, task, true));
    }
    case 'POST /admin/tasks':
      return found(assign(ctx, body));
    case 'PATCH /admin/tasks/:id': {
      const task = tasks.find((t) => t.id === id) ?? refuse('not_found');
      if (task.cancelledAt) refuse('cancelled');
      if (body?.version && body.version !== task.version) throw new ApiError(409, 'Someone changed this task since you opened it. Refresh and try again.', { code: 'task_changed' });
      if (body?.clearDueOn) task.dueOn = null;
      else if (body?.dueOn) task.dueOn = checkDue(body.dueOn);
      if (body?.note !== undefined && body?.note !== null) task.note = String(body.note).trim() || null;
      event(task, 'Updated', ctx.currentUser().id);
      touch(task);
      return found(view(ctx, task, true));
    }
    case 'POST /admin/tasks/:id/reassign':
      return found(reassign(ctx, [id], body, true).reassigned[0]);
    case 'POST /admin/tasks/reassign':
      return found(reassign(ctx, body?.taskIds ?? [], body, false));
    case 'POST /admin/tasks/approve': {
      const { picked, skipped } = pick(ctx, body?.taskIds ?? [], (_, stage) => stage === 'Done');
      for (const task of picked) {
        task.approvedAt = new Date().toISOString();
        event(task, 'CompositionApproved', ctx.currentUser().id);
        touch(task);
      }
      return found({ updated: picked.map((t) => view(ctx, t)), skipped });
    }
    case 'POST /admin/tasks/return': {
      const reason = String(body?.reason ?? '').trim();
      if (!reason) throw new ApiError(400, 'Say what needs to change, so the participant knows.', { code: 'validation_error' });
      const { picked, skipped } = pick(ctx, body?.taskIds ?? [], (task, stage) => stage === 'Done' || (stage === 'AwaitingPhoto' && !photo(ctx, task)));
      for (const task of picked) {
        Object.assign(task, { doneAt: null, approvedAt: null, startedAt: task.startedAt ?? new Date().toISOString(), returnNote: reason });
        event(task, 'Returned', ctx.currentUser().id, { note: reason });
        touch(task);
      }
      return found({ updated: picked.map((t) => view(ctx, t)), skipped });
    }
    case 'POST /admin/tasks/:id/cancel': {
      const task = tasks.find((t) => t.id === id) ?? refuse('not_found');
      if (!task.cancelledAt) {
        const why = locked(ctx, task);
        if (why) refuse(why);
        task.cancelledAt = new Date().toISOString();
        event(task, 'Cancelled', ctx.currentUser().id, { note: body?.reason?.trim() || null });
        touch(task);
      }
      return found(view(ctx, task, true));
    }

    case 'POST /admin/tasks/:id/restore': {
      const task = tasks.find((t) => t.id === id) ?? refuse('not_found');
      if (task.cancelledAt) {
        const recipe = ctx.recipes.find((r) => r.id === task.recipeId);
        if (recipe?.deletedAt) throw new ApiError(409, `${recipe.code ?? recipe.name} is deleted. Restore the recipe; its tiles come back with it.`, { code: 'recipe_deleted' });
        if (tasks.some((t) => t.id !== task.id && t.recipeId === task.recipeId && t.clayBody === task.clayBody && !t.cancelledAt))
          throw new ApiError(409, 'This tile has been given out again since, so this one stays deleted.', { code: 'task_exists' });
        task.cancelledAt = null;
        event(task, 'Restored', ctx.currentUser().id);
        touch(task);
      }
      return found(view(ctx, task, true));
    }
    case 'GET /admin/tasks/activity/:id': {
      // As the API: their tasks' history and the photos they sent, newest first.
      const userName = (uid: string | null) => (uid ? (ctx.users.find((u) => u.id === uid)?.username ?? null) : null);
      const recipeOf = (rid: string | null) => ctx.recipes.find((r) => r.id === rid);
      const fromTasks = tasks
        .filter((t) => t.assignedUserId === id || t.events.some((e) => e.actorUserId === id || e.fromUserId === id || e.toUserId === id))
        .flatMap((t) =>
          t.events.map((e) => ({ kind: e.kind, at: e.at, taskId: t.id, recipeId: t.recipeId, recipeCode: recipeOf(t.recipeId)?.code ?? null, recipeName: recipeOf(t.recipeId)?.name ?? null,
            clayBody: t.clayBody, actorUsername: userName(e.actorUserId), note: e.note ?? null })),
        );
      const fromUploads = ctx.uploads
        .filter((u) => u.ownerUserId === id && SENT.includes(u.status))
        .map((u) => ({ kind: 'PhotoSent', at: u.createdAt, taskId: uploadTasks.get(u.id) ?? null, recipeId: u.recipeId ?? null, recipeCode: recipeOf(u.recipeId ?? null)?.code ?? null,
          recipeName: recipeOf(u.recipeId ?? null)?.name ?? null, clayBody: u.clayBody ?? null, actorUsername: userName(id), note: u.reviewNote ?? null, uploadId: u.id, uploadStatus: u.status }));
      return found([...fromTasks, ...fromUploads].sort((a, b) => b.at.localeCompare(a.at)).slice(0, Number(query?.limit) || 200));
    }

    case 'GET /me/tasks': {
      const rank = (t: MockTask) => ({ Assigned: 0, Started: 0, AwaitingPhoto: 1, Done: 2, InReview: 3, Approved: 4, Cancelled: 5 })[stageOf(ctx, t)];
      let list = tasks.filter((t) => t.assignedUserId === ctx.currentUser().id && !t.cancelledAt);
      if (query?.stage) list = list.filter((t) => stageOf(ctx, t) === query.stage);
      return found(ordered(ctx, list).sort((a, b) => rank(a) - rank(b)).map((t) => view(ctx, t, false, true)));
    }
    case 'GET /me/tasks/:id':
      return found(view(ctx, mine(ctx, id), false, true));
    case 'POST /me/tasks/:id/start': {
      const task = mine(ctx, id);
      if (!task.startedAt) {
        task.startedAt = new Date().toISOString();
        event(task, 'Started', ctx.currentUser().id);
        touch(task);
      }
      return found(view(ctx, task, false, true));
    }
    case 'POST /me/tasks/:id/done': {
      const task = mine(ctx, id);
      if (!task.startedAt && !task.doneAt) throw new ApiError(409, 'Press Start and make the tile before marking it done.', { code: 'task_not_started' });
      if (!task.doneAt && !task.approvedAt && !photo(ctx, task)) {
        task.returnNote = null;
        task.doneAt = new Date().toISOString();
        event(task, 'MarkedDone', ctx.currentUser().id);
        touch(task);
      }
      return found(view(ctx, task, false, true));
    }
    case 'DELETE /me/tasks/:id/done': {
      const task = mine(ctx, id);
      if (photo(ctx, task)) throw new ApiError(409, 'A photo of this tile has already been sent, so it stays done.', { code: 'task_photo_sent' });
      if (task.approvedAt) throw new ApiError(409, 'Your admin has already checked this tile, so it stays done.', { code: 'task_approved_for_photo' });
      if (task.doneAt) {
        task.doneAt = null;
        event(task, 'DoneUndone', ctx.currentUser().id);
        touch(task);
      }
      return found(view(ctx, task, false, true));
    }
  }
  return { found: false };
}
