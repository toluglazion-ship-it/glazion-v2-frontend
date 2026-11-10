import type {
  AdminUploadDtoPagedResult,
  AdminUploadListParams,
  ApproveRequest,
  AssignRecipesRequest,
  AuthTokensResult,
  BaseGlazeDto,
  CaptureCodeDto,
  CaptureCodeDtoPagedResult,
  CaptureCodeListParams,
  CaptureContextDto,
  CompleteImportRecordsResponse,
  CompleteUploadRequest,
  CreateImportBatchRequest,
  BackfillDerivativesRequest,
  EnqueuedResponse,
  ImageAssetDto,
  ImageListParams,
  ImportBatchDto,
  ImportManifestRow,
  ImportRecordDto,
  ImportRecordListParams,
  IndexStatusDto,
  SearchSettingsDto,
  JobDto,
  JobListParams,
  RebuildIndexRequest,
  RegisterImportRecordsResponse,
  CreateCodeRequest,
  CreateRecipeRequest,
  CreateUploadRequest,
  CreateUserRequest,
  CurrentUserDto,
  ImportBatchDtoPagedResult,
  LoginCommand,
  LoginResult,
  MaterialDuplicateGroup,
  MaterialListParams,
  MaterialListResponse,
  MaterialOverrideDto,
  OverviewDto,
  PagedResult,
  CreateExperimentRequest,
  ExperimentDto,
  UpdateExperimentRequest,
  ParticipantActivityDto,
  PresignDto,
  PromoteVariationRequest,
  RecipeDto,
  RecipeDtoPagedResult,
  RecipeListParams,
  CaptureLookupDto,
  RefreshCommand,
  RegisterBaseGlazeRequest,
  UpdateBaseGlazeRequest,
  UpdateBaseGlazeResponse,
  RegisterVariationRequest,
  RegisterVariationsRequest,
  RejectRequest,
  SetClayBodyRequest,
  SetClayBodyResponse,
  SetPasswordRequest,
  SetPasswordResult,
  SetStatusRequest,
  UpdateRecipeDetailsRequest,
  UpdateRecipeRequest,
  UpdateUserRequest,
  UpsertMaterialRequest,
  UploadDto,
  UploadDtoPagedResult,
  UploadListParams,
  UserDto,
  UserDtoPagedResult,
  UserListParams,
  AssignTileTasksRequest,
  AssignTileTasksResponse,
  CancelTileTaskRequest,
  ReassignTileTaskRequest,
  ReassignTileTasksRequest,
  ReassignTileTasksResponse,
  TileTaskBatchResponse,
  TileTaskDto,
  TileTaskListParams,
  TileTaskStage,
  TileTaskSummaryDto,
  UpdateTileTaskRequest,
  ImageTrace,
  RegisterBaseWithVariationsRequest,
  RegisterBaseWithVariationsResponse,
  SearchCheckDetail,
  SearchCheckListParams,
  ImageTraceListParams,
  SearchCheckSummary,
  AiCopyDto,
  MakeAiCopyRequest,
} from '@glazion/types';
import { API_URL, USE_MOCKS, defaultStorage } from './platform';
import type { KeyValueStorage } from './storage';

export { USE_MOCKS };
export type { KeyValueStorage };

const BASE_URL = (API_URL ?? 'https://glazion-api-prod-production.up.railway.app').replace(/\/$/, '');

// Where the session is kept. Browser storage on the web; the mobile app passes secure storage.
let storage: KeyValueStorage = defaultStorage;

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Thrown for any non-2xx response. `message` is safe to show to the user. */
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** A 403 because the account hasn't been activated yet, rather than because it lacks access. */
export function isAccountPending(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 403) return false;
  try {
    return JSON.stringify(err.body ?? '').includes('account_pending');
  } catch {
    return false;
  }
}

/** Titles that only restate the HTTP status, which say nothing a person can act on. */
const STATUS_TITLE = /^(bad request|unauthorized|forbidden|not found|method not allowed|conflict|(payload|content) too large|unsupported media type|unprocessable (entity|content)|too many requests|internal server error|bad gateway|service unavailable|gateway timeout)$/i;

/** The first message from a validation problem's `errors`, e.g. { email: ['A valid email address is required.'] }. */
function firstFieldError(errors: unknown): string | null {
  if (!errors || typeof errors !== 'object') return null;
  for (const messages of Object.values(errors)) {
    const first = Array.isArray(messages) ? messages[0] : messages;
    if (typeof first === 'string' && first.trim()) return first;
  }
  return null;
}

function messageFor(status: number, body: any): string {
  // The API answers with RFC 7807 problem details: `detail` is written for people, `errors` says
  // which field a validation problem is about, and `title` is often just the status in words.
  if (body?.detail) return body.detail;
  const fieldError = firstFieldError(body?.errors);
  if (fieldError) return fieldError;
  if (typeof body?.title === 'string' && !STATUS_TITLE.test(body.title.trim())) return body.title;
  if (status === 400 || status === 422) return "Some of the details weren't accepted. Check them and try again.";
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "We couldn't find what you were looking for.";
  if (status === 409) return 'That clashes with something that already exists.';
  if (status === 413) return "That's too large to send.";
  if (status === 429) return 'Too many tries in a row. Wait a moment and try again.';
  if (status >= 500) return 'The server ran into a problem. Please try again shortly.';
  return `Something went wrong (error ${status}). Please try again.`;
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return "Can't reach the server. Check your connection and try again.";
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// ─── Token store ──────────────────────────────────────────────────────────────

const ACCESS_KEY = 'glazion_access';
const REFRESH_KEY = 'glazion_refresh';

let accessToken: string | null = null;
let refreshToken: string | null = null;
const listeners = new Set<() => void>();
/** The last session ran out on its own (it couldn't be refreshed), rather than being signed out of. */
let sessionEnded = false;

/** True from a session running out until the next sign-in, so the sign-in screen can say why it's back. */
export function sessionHasEnded(): boolean {
  return sessionEnded;
}

function notify() {
  listeners.forEach((listener) => listener());
}

export const tokenStore = {
  get access() {
    return accessToken;
  },
  get refresh() {
    return refreshToken;
  },
  set(access: string, refresh: string) {
    accessToken = access;
    refreshToken = refresh;
    storage.setItem(ACCESS_KEY, access);
    storage.setItem(REFRESH_KEY, refresh);
    notify();
  },
  load() {
    accessToken = storage.getItem(ACCESS_KEY);
    refreshToken = storage.getItem(REFRESH_KEY);
  },
  clear() {
    accessToken = null;
    refreshToken = null;
    storage.removeItem(ACCESS_KEY);
    storage.removeItem(REFRESH_KEY);
    notify();
  },
  /** Fires on sign-in, sign-out and when a session can no longer be refreshed. */
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

tokenStore.load();

/** Points the client at a different place to keep the session, and picks up whatever is stored there. */
export function configureApiClient(options: { storage: KeyValueStorage }) {
  storage = options.storage;
  tokenStore.load();
  notify();
}

// ─── Core request ─────────────────────────────────────────────────────────────

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** Cancels the request, e.g. when a newer calculation replaces it. */
  signal?: AbortSignal;
  /** Set to false for calls that must not attach a token or try to refresh. */
  auth?: boolean;
  /** Extra headers, such as Idempotency-Key. */
  headers?: Record<string, string>;
}

function buildUrl(path: string, query?: Query) {
  if (!query) return `${BASE_URL}${path}`;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return `${BASE_URL}${path}${qs ? `?${qs}` : ''}`;
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Several requests can hit a 401 at once; they all wait on the same refresh call.
let refreshing: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const current = refreshToken;
    if (!current) return false;
    try {
      const tokens = await request<AuthTokensResult>('POST', '/api/v2/auth/refresh', {
        body: { refreshToken: current } satisfies RefreshCommand,
        auth: false,
      });
      if (!tokens?.accessToken) return false;
      tokenStore.set(tokens.accessToken, tokens.refreshToken ?? current);
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { query, body, signal, auth = true, headers: extra } = options;

  if (USE_MOCKS) {
    const { handleMockRequest } = await import('./mock');
    return handleMockRequest(method, path, query, body) as Promise<T>;
  }

  const send = () => {
    const headers: Record<string, string> = { ...extra, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  };

  let res = await send();

  if (res.status === 401 && auth) {
    if (refreshToken && (await refreshSession())) {
      res = await send();
    } else {
      // Nothing left to recover the session with; subscribers send the user back to sign-in.
      if (accessToken) sessionEnded = true;
      tokenStore.clear();
    }
  }

  const data = await parse(res);
  if (!res.ok) throw new ApiError(res.status, messageFor(res.status, data), data);
  return data as T;
}

/** The raw authenticated request, for feature modules that live outside this file. */
export { request as apiRequest };
export type { Query as ApiQuery, RequestOptions as ApiRequestOptions };

const get = <T>(path: string, query?: Query) => request<T>('GET', path, { query });
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, { body });
const patch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body });
const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, { body });
const del = <T>(path: string) => request<T>('DELETE', path);

/** Tile codes such as "P01-B1" go in the path as they are, escaped in case one ever holds a slash. */
const seg = (value: string) => encodeURIComponent(value);

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (cmd: LoginCommand) => request<LoginResult>('POST', '/api/v2/auth/login', { body: cmd, auth: false }),
  logout: () => post<void>('/api/v2/auth/logout'),
};

const USER_KEY = 'glazion_user';

export interface StoredUser {
  id: string;
  username: string | null;
  displayName: string | null;
}

/** Signs in and keeps the tokens. Callers decide whether the returned account may use their app. */
export async function signIn(username: string, password: string): Promise<LoginResult> {
  const result = await authApi.login({ username, password });
  if (!result.tokens?.accessToken || !result.tokens.refreshToken) {
    throw new ApiError(500, 'Sign-in succeeded but no session was returned. Please try again.');
  }
  storage.setItem(
    USER_KEY,
    JSON.stringify({ id: result.userId, username: result.username, displayName: result.displayName } satisfies StoredUser),
  );
  sessionEnded = false;
  tokenStore.set(result.tokens.accessToken, result.tokens.refreshToken);
  return result;
}

export async function signOut(): Promise<void> {
  try {
    if (accessToken) await authApi.logout();
  } catch {
    // The local session is dropped either way.
  }
  storage.removeItem(USER_KEY);
  sessionEnded = false;
  tokenStore.clear();
}

export function getStoredUser(): StoredUser | null {
  try {
    const raw = storage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  } catch {
    return null;
  }
}

// ─── Current user ─────────────────────────────────────────────────────────────

export const meApi = {
  get: () => get<CurrentUserDto>('/api/v2/me'),
};

export const captureApi = {
  getContext: () => get<CaptureContextDto>('/api/v2/me/capture-context'),
  /** Capture by code: the recipe with the code written on a tile, and its tiles (who made each, which are ready to photograph). */
  tiles: (code: string) => get<CaptureLookupDto>(`/api/v2/capture/tiles/${encodeURIComponent(code.trim())}`),
};

/** The signed-in participant's tile tasks, each with its recipe as mixed: to make, made and waiting for a photo, in review, approved. */
export const myTasksApi = {
  list: (params?: { stage?: TileTaskStage }) => get<TileTaskDto[]>('/api/v2/me/tasks', { ...params }),
  getOne: (taskId: string) => get<TileTaskDto>(`/api/v2/me/tasks/${taskId}`),
  /** Shows the recipe (in the answer). */
  start: (taskId: string) => post<TileTaskDto>(`/api/v2/me/tasks/${taskId}/start`),
  /** The tile is made: it goes to an admin to check before it is photographed. Only after start. */
  markDone: (taskId: string) => post<TileTaskDto>(`/api/v2/me/tasks/${taskId}/done`),
  /** Takes back "done"; refused once an admin has checked it. */
  undoDone: (taskId: string) => del<TileTaskDto>(`/api/v2/me/tasks/${taskId}/done`),
};

export const myUploadsApi = {
  list: (params?: UploadListParams) => get<UploadDtoPagedResult>('/api/v2/uploads', { ...params }),
  create: (body: CreateUploadRequest) => post<UploadDto>('/api/v2/uploads', body),
  getOne: (uploadId: string) => get<UploadDto>(`/api/v2/uploads/${uploadId}`),
  presign: (uploadId: string) => post<PresignDto>(`/api/v2/uploads/${uploadId}/presign`),
  complete: (uploadId: string, body: CompleteUploadRequest = {}) =>
    post<UploadDto>(`/api/v2/uploads/${uploadId}/complete`, body),
  cancel: (uploadId: string) => post<void>(`/api/v2/uploads/${uploadId}/cancel`),
};

/**
 * Sends the file straight to storage using the presigned URL. The request goes to
 * Cloudflare R2, not our API, so it carries no bearer token.
 */
export function uploadToStorage(
  presign: PresignDto,
  file: Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  if (!presign.url) return Promise.reject(new ApiError(500, 'The server did not return an upload address.'));
  const url = presign.url;

  if (USE_MOCKS) {
    return import('./mock').then(({ mockStorageUpload }) => mockStorageUpload(presign.uploadId, file, onProgress, url.endsWith('/back')));
  }

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(presign.method ?? 'PUT', url);
    const headers = { 'Content-Type': file.type, ...(presign.headers ?? {}) };
    for (const [key, value] of Object.entries(headers)) {
      if (value) xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError(xhr.status, 'The photo could not be stored. Please try again.'));
    };
    xhr.onerror = () => reject(new TypeError('Network error during upload'));
    xhr.onabort = () => reject(new ApiError(0, 'Upload cancelled.'));
    xhr.send(file);
  });
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export const overviewApi = {
  get: () => get<OverviewDto>('/api/v2/admin/overview'),
};

export const usersApi = {
  list: (params?: UserListParams) => get<UserDtoPagedResult>('/api/v2/admin/users', { ...params }),
  getOne: (userId: string) => get<UserDto>(`/api/v2/admin/users/${userId}`),
  create: (body: CreateUserRequest) => post<UserDto>('/api/v2/admin/users', body),
  update: (userId: string, body: UpdateUserRequest) => patch<UserDto>(`/api/v2/admin/users/${userId}`, body),
  setStatus: (userId: string, body: SetStatusRequest) => patch<void>(`/api/v2/admin/users/${userId}/status`, body),
  /** Replaces the password and signs the user out on every device. Used on yourself, it signs you out too. */
  setPassword: async (userId: string, body: SetPasswordRequest): Promise<SetPasswordResult> =>
    normaliseSetPassword(await post<unknown>(`/api/v2/admin/users/${userId}/password`, body)),
};

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;

/** Why the API would refuse this password, or null if it's fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use no more than ${PASSWORD_MAX} characters.`;
  return null;
}

// The count of ended sessions isn't in the Swagger yet, so take it from a bare number or the first
// numeric field that names sessions.
export function normaliseSetPassword(raw: unknown): SetPasswordResult {
  if (typeof raw === 'number') return { sessionsEnded: raw };
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'number' && /session/i.test(key)) return { sessionsEnded: value };
    }
  }
  return { sessionsEnded: null };
}

export const recipesApi = {
  list: (params?: RecipeListParams) => get<RecipeDtoPagedResult>('/api/v2/admin/recipes', { ...params }),
  getOne: (recipeId: string) => get<RecipeDto>(`/api/v2/admin/recipes/${recipeId}`),
  create: (body: CreateRecipeRequest) => post<RecipeDto>('/api/v2/admin/recipes', body),
  update: (recipeId: string, body: UpdateRecipeDetailsRequest) => patch<RecipeDto>(`/api/v2/admin/recipes/${recipeId}`, body),
  getByCode: (code: string) => get<RecipeDto>(`/api/v2/admin/recipes/by-code/${seg(code)}`),
  updateByCode: (code: string, body: UpdateRecipeRequest) => patch<RecipeDto>(`/api/v2/admin/recipes/by-code/${seg(code)}`, body),
  /** Makes a variation a new base: P01-B1-002 becomes the participant's next base, e.g. P01-B2. */
  promote: (code: string, body: PromoteVariationRequest) => post<BaseGlazeDto>(`/api/v2/admin/recipes/by-code/${seg(code)}/promote`, body),
  /** Deletes a recipe and cancels its open tiles; its code stays taken. Refused once a tile of it is approved. */
  remove: (recipeId: string) => del<RecipeDto>(`/api/v2/admin/recipes/${recipeId}`),
  /** Brings a deleted recipe back with the tiles its deletion cancelled. */
  restore: (recipeId: string) => post<RecipeDto>(`/api/v2/admin/recipes/${recipeId}/restore`),
};

export const baseGlazesApi = {
  list: (participantCode?: string) => get<BaseGlazeDto[]>('/api/v2/admin/base-glazes', { participantCode }),
  /** Deleted bases, to restore. */
  deleted: () => get<BaseGlazeDto[]>('/api/v2/admin/base-glazes', { deleted: true }),
  /** Deletes a base with all its variations and their open tiles. Refused once a tile of any of them is approved. */
  remove: (code: string) => del<BaseGlazeDto>(`/api/v2/admin/base-glazes/${seg(code)}`),
  restore: (code: string) => post<BaseGlazeDto>(`/api/v2/admin/base-glazes/${seg(code)}/restore`),
  getOne: (code: string) => get<BaseGlazeDto>(`/api/v2/admin/base-glazes/${seg(code)}`),
  register: (body: RegisterBaseGlazeRequest) => post<BaseGlazeDto>('/api/v2/admin/base-glazes', body),
  /** Corrects a base. The formulation only until a tile of it is checked and approved (409 base_in_use after that). */
  update: (code: string, body: UpdateBaseGlazeRequest) => patch<UpdateBaseGlazeResponse>(`/api/v2/admin/base-glazes/${seg(code)}`, body),
  addVariation: (code: string, body: RegisterVariationRequest) =>
    post<RecipeDto>(`/api/v2/admin/base-glazes/${seg(code)}/recipes`, body),
  /** Several variations in one go, numbered in the order sent. */
  addVariations: (code: string, body: RegisterVariationsRequest) =>
    post<RecipeDto[]>(`/api/v2/admin/base-glazes/${seg(code)}/recipes/batch`, body),
  /** A base (new, or an existing one by code), its variations and who makes them, in one step. All or nothing. */
  registerWithVariations: (body: RegisterBaseWithVariationsRequest) =>
    post<RegisterBaseWithVariationsResponse>('/api/v2/admin/base-glazes/with-variations', body),
};

export const materialsApi = {
  list: (params?: MaterialListParams) => get<MaterialListResponse>('/api/v2/materials', { ...params }),
  search: (q: string, pageSize = 20) => get<MaterialListResponse>('/api/v2/materials', { q, pageSize }),
};

/**
 * A material's id as the backend makes it from a name: lower case, every run of other characters
 * becomes one hyphen. "CP#7 Ball Clay" -> "cp-7-ball-clay", "Stain (blue)" -> "stain-blue-".
 * The server checks it; this is only so the admin knows which id a name lands on.
 */
export function materialId(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/**
 * The oxides the calculator knows, in its order, and the backend's limit for a correction's total.
 * Mirrors packages/chemistry's OXIDES, which the backend copied; the server still checks.
 */
export const MATERIAL_OXIDES = [
  'SiO2', 'Al2O3', 'B2O3', 'P2O5', 'K2O', 'Na2O', 'Li2O', 'CaO', 'MgO', 'BaO', 'SrO', 'ZnO', 'PbO', 'ZrO2', 'TiO2', 'SnO2',
  'Fe2O3', 'FeO', 'MnO', 'CoO', 'NiO', 'CuO', 'Cr2O3', 'V2O5', 'MoO3', 'WO3', 'CeO2', 'La2O3', 'Y2O3', 'Nb2O5', 'Ta2O5',
] as const;
export const MATERIAL_TOTAL_MAX = 105;

/** Every page of a short cursor-paged list, as one array. */
async function all<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page: PagedResult<T> = await get<PagedResult<T>>(path, { cursor, pageSize: 200 });
    items.push(...(page.items ?? []));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

export const adminMaterialsApi = {
  duplicates: () => all<MaterialDuplicateGroup>('/api/v2/admin/materials/duplicates'),
  overrides: () => all<MaterialOverrideDto>('/api/v2/admin/materials/overrides'),
  /** Corrects the material with this id, or adds it when the file has no such id. */
  save: (id: string, body: UpsertMaterialRequest) => put<MaterialOverrideDto>(`/api/v2/admin/materials/${seg(id)}`, body),
  /** Back to the file's analysis, or removes a material an administrator added. */
  revert: (id: string) => del<void>(`/api/v2/admin/materials/${seg(id)}`),
};

export const captureCodesApi = {
  list: (params?: CaptureCodeListParams) => get<CaptureCodeDtoPagedResult>('/api/v2/admin/capture-codes', { ...params }),
  getOne: (codeId: string) => get<CaptureCodeDto>(`/api/v2/admin/capture-codes/${codeId}`),
  create: (body: CreateCodeRequest) => post<CaptureCodeDto>('/api/v2/admin/capture-codes', body),
  revoke: (codeId: string) => post<void>(`/api/v2/admin/capture-codes/${codeId}/revoke`),
  listRecipes: (codeId: string) => get<RecipeDto[]>(`/api/v2/admin/capture-codes/${codeId}/recipes`),
  assignRecipes: (codeId: string, body: AssignRecipesRequest) =>
    post<void>(`/api/v2/admin/capture-codes/${codeId}/recipes`, body),
  removeRecipe: (codeId: string, recipeId: string) => del<void>(`/api/v2/admin/capture-codes/${codeId}/recipes/${recipeId}`),
};

/** Tile tasks: recipes given to participants per clay body, with due dates (Glazion-v2 docs/tile-tasks.md). */
export const tasksApi = {
  list: (params?: TileTaskListParams) => get<PagedResult<TileTaskDto>>('/api/v2/admin/tasks', { ...params }),
  summary: (params?: Omit<TileTaskListParams, 'stage' | 'overdue' | 'cursor' | 'pageSize'>) =>
    get<TileTaskSummaryDto>('/api/v2/admin/tasks/summary', { ...params }),
  getOne: (taskId: string) => get<TileTaskDto>(`/api/v2/admin/tasks/${taskId}`),
  assign: (body: AssignTileTasksRequest) => post<AssignTileTasksResponse>('/api/v2/admin/tasks', body),
  update: (taskId: string, body: UpdateTileTaskRequest) => patch<TileTaskDto>(`/api/v2/admin/tasks/${taskId}`, body),
  reassign: (taskId: string, body: ReassignTileTaskRequest) => post<TileTaskDto>(`/api/v2/admin/tasks/${taskId}/reassign`, body),
  reassignMany: (body: ReassignTileTasksRequest) => post<ReassignTileTasksResponse>('/api/v2/admin/tasks/reassign', body),
  /** Deletes the task (it can be restored). */
  cancel: (taskId: string, body: CancelTileTaskRequest = {}) => post<TileTaskDto>(`/api/v2/admin/tasks/${taskId}/cancel`, body),
  restore: (taskId: string) => post<TileTaskDto>(`/api/v2/admin/tasks/${taskId}/restore`),
  /** Everything that happened to one participant's work, newest first. */
  activity: (userId: string, limit = 200) => get<ParticipantActivityDto[]>(`/api/v2/admin/tasks/activity/${userId}`, { limit }),
  /** Approves made tiles after checking them: each can then be fired and photographed. */
  approve: (taskIds: string[]) => post<TileTaskBatchResponse>('/api/v2/admin/tasks/approve', { taskIds }),
  /** Sends made tiles back to make again, with a reason the participant sees (required). */
  returnToParticipant: (taskIds: string[], reason: string) => post<TileTaskBatchResponse>('/api/v2/admin/tasks/return', { taskIds, reason }),
};

/** Cup experiments, set up and watched by an admin (who can also do the participant's steps). */
export const experimentsApi = {
  list: (params?: { participantUserId?: string; baseCode?: string; deleted?: boolean }) => get<ExperimentDto[]>('/api/v2/admin/experiments', { ...params }),
  getOne: (id: string) => get<ExperimentDto>(`/api/v2/admin/experiments/${id}`),
  create: (body: CreateExperimentRequest) => post<ExperimentDto>('/api/v2/admin/experiments', body),
  update: (id: string, body: UpdateExperimentRequest) => patch<ExperimentDto>(`/api/v2/admin/experiments/${id}`, body),
  remove: (id: string) => del<ExperimentDto>(`/api/v2/admin/experiments/${id}`),
  restore: (id: string) => post<ExperimentDto>(`/api/v2/admin/experiments/${id}/restore`),
  refill: (id: string, cup: number, body: { dryGrams: number; waterGrams: number }) => post<ExperimentDto>(`/api/v2/admin/experiments/${id}/cups/${cup}/refill`, body),
};

/** The participant's own cup experiments: start a step, dip, weigh one cup; fresh glaze for a cup that ran low. */
export const myExperimentsApi = {
  list: () => get<ExperimentDto[]>('/api/v2/me/experiments'),
  getOne: (id: string) => get<ExperimentDto>(`/api/v2/me/experiments/${id}`),
  start: (id: string) => post<ExperimentDto>(`/api/v2/me/experiments/${id}/steps/start`),
  cancelStep: (id: string) => post<ExperimentDto>(`/api/v2/me/experiments/${id}/steps/cancel`),
  /** The stage is completed. Without a weighed cup, the API takes a set amount of glaze per tile (no weighing for now). */
  dipped: (id: string, body: { cupNumber?: number; wetGrams?: number } = {}) => post<ExperimentDto>(`/api/v2/me/experiments/${id}/steps/dipped`, body),
  refill: (id: string, cup: number, body: { dryGrams: number; waterGrams: number }) => post<ExperimentDto>(`/api/v2/me/experiments/${id}/cups/${cup}/refill`, body),
};

export const uploadsApi = {
  list: (params?: AdminUploadListParams) => get<AdminUploadDtoPagedResult>('/api/v2/admin/uploads', { ...params }),
  approve: (uploadId: string, body: ApproveRequest = {}) =>
    post<void>(`/api/v2/admin/uploads/${uploadId}/approve`, body),
  reject: (uploadId: string, body: RejectRequest) => post<void>(`/api/v2/admin/uploads/${uploadId}/reject`, body),
};

// ─── Photo library (admin) ────────────────────────────────────────────────────

export const imagesApi = {
  /** Paged: up to 200 a page. */
  list: (params?: ImageListParams) => get<PagedResult<ImageAssetDto>>('/api/v2/admin/images', { ...params }),
  getOne: (imageId: string) => get<ImageAssetDto>(`/api/v2/admin/images/${imageId}`),
  approve: (imageId: string, body: ApproveRequest = {}) => post<void>(`/api/v2/admin/images/${imageId}/approve`, body),
  reject: (imageId: string, body: RejectRequest) => post<void>(`/api/v2/admin/images/${imageId}/reject`, body),
  /** Remakes the display size and thumbnail. */
  rebuildDerivatives: (body: BackfillDerivativesRequest) => post<EnqueuedResponse>('/api/v2/admin/images/derivatives/backfill', body),
  /** Where the photo came from, and the recipe and UMF it carries. */
  trace: (imageId: string) => get<ImageTrace>(`/api/v2/admin/images/${imageId}/trace`),
  /** The photo's AI copies, newest first. */
  aiCopies: (imageId: string) => get<AiCopyDto[]>(`/api/v2/admin/images/${imageId}/ai-copies`),
  /** Starts an AI copy; it is ready in a minute or so. */
  makeAiCopy: (imageId: string, body: MakeAiCopyRequest = {}) => post<AiCopyDto>(`/api/v2/admin/images/${imageId}/ai-copies`, body),
  /** Shows the copy in place of the photo everywhere. */
  approveAiCopy: (imageId: string, copyId: string) => post<AiCopyDto>(`/api/v2/admin/images/${imageId}/ai-copies/${copyId}/approve`),
  rejectAiCopy: (imageId: string, copyId: string) => post<AiCopyDto>(`/api/v2/admin/images/${imageId}/ai-copies/${copyId}/reject`),
  /** Shows the photo itself again; the copy is kept. */
  revertAiCopy: (imageId: string) => post<void>(`/api/v2/admin/images/${imageId}/ai-copies/revert`),
};

/** Match check: every search beside the tiles it suggested (Glazion-v2 docs/match-check.md). */
export const matchCheckApi = {
  list: (params?: SearchCheckListParams) => get<PagedResult<SearchCheckSummary>>('/api/v2/admin/searches', { ...params }),
  getOne: (searchId: string) => get<SearchCheckDetail>(`/api/v2/admin/searches/${searchId}`),
  /** Every photo beside its recipe and chemistry, newest first, to check imported photos and new uploads. */
  tiles: (params?: ImageTraceListParams) => get<PagedResult<ImageTrace>>('/api/v2/admin/images/traces', { ...params }),
};

export const adminImagesApi = {
  /** Sets the clay body on the photos listed, or on every photo from an import. */
  setClayBody: (body: SetClayBodyRequest) => post<SetClayBodyResponse>('/api/v2/admin/images/clay-body', body),
};

export const importsApi = {
  list: (params?: { cursor?: string; pageSize?: number }) => get<ImportBatchDtoPagedResult>('/api/v2/admin/imports', { ...params }),
  getOne: (batchId: string) => get<ImportBatchDto>(`/api/v2/admin/imports/${batchId}`),
  create: (body: CreateImportBatchRequest) => post<ImportBatchDto>('/api/v2/admin/imports', body),
  records: (batchId: string, params?: ImportRecordListParams) =>
    get<PagedResult<ImportRecordDto>>(`/api/v2/admin/imports/${batchId}/records`, { ...params }),
  /** Registers files; each accepted one comes back with an upload link. */
  register: (batchId: string, records: ImportManifestRow[]) =>
    post<RegisterImportRecordsResponse>(`/api/v2/admin/imports/${batchId}/records`, { records }),
  /** Tells the server these files are in storage, so it can check and process them. */
  complete: (batchId: string, externalRecordIds: string[]) =>
    post<CompleteImportRecordsResponse>(`/api/v2/admin/imports/${batchId}/records/complete`, { externalRecordIds }),
  close: (batchId: string) => post<void>(`/api/v2/admin/imports/${batchId}/close`),
};

/** Whether every search filters strictly by firing (SearchSettingsDto). */
export const searchSettingsApi = {
  get: () => get<SearchSettingsDto>('/api/v2/admin/settings/search'),
  update: (body: { strictFiring: boolean }) => put<SearchSettingsDto>('/api/v2/admin/settings/search', body),
};

export const searchIndexApi = {
  status: () => get<IndexStatusDto>('/api/v2/admin/index/status'),
  rebuild: (body: RebuildIndexRequest) => post<EnqueuedResponse>('/api/v2/admin/index/rebuild', body),
  /** Paged: up to 500 a page. */
  jobs: (params?: JobListParams) => get<PagedResult<JobDto>>('/api/v2/admin/jobs', { ...params }),
  retryJob: (jobId: string) => post<void>(`/api/v2/admin/jobs/${jobId}/retry`),
};
