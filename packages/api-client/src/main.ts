// API for the main app: the UMF calculator, recipe-to-image search, chat and registration.
// Import from '@glazion/api-client/main' so Admin and Capture don't carry it.
import type {
  ChatFeedbackRequest,
  ChatMessage,
  ChatSource,
  ChatToolCall,
  ConfidenceBand,
  Conversation,
  ConversationSummary,
  CreateConversationRequest,
  GlazeLimit,
  MaterialResolution,
  PagedResult,
  RecipeImageSearchRequest,
  RecipeImageSearchResponse,
  SearchResultItem,
  RegisterRequest,
  RegisterResult,
  SearchFeedbackRequest,
  SearchSettingsDto,
  SendMessageRequest,
  SendMessageResponse,
  UmfCalculateRequest,
  UmfCalculateResponse,
} from '@glazion/types';
import { ApiError, USE_MOCKS, apiRequest, type ApiRequestOptions } from './index';
import { uid } from './uid';

/**
 * Features whose endpoints the backend hasn't shipped yet. While a flag is true the calls are
 * answered with sample data and the UI says so. Set it to false when the real endpoints go live.
 * Search, its feedback and sign-up are in the API as of 5 Oct 2026, chat as of 14 Oct 2026;
 * password reset isn't.
 */
export const SAMPLE_DATA = {
  search: false,
  chat: false,
  signUp: false,
  passwordReset: true,
};

type Feature = keyof typeof SAMPLE_DATA;

export function usesSampleData(feature: Feature): boolean {
  return USE_MOCKS || SAMPLE_DATA[feature];
}

async function call<T>(feature: Feature, method: string, path: string, options: ApiRequestOptions = {}): Promise<T> {
  if (usesSampleData(feature)) {
    const { handleSampleRequest } = await import('./mock-main');
    return handleSampleRequest(method, path, options.query, options.body) as Promise<T>;
  }
  return apiRequest<T>(method, path, options);
}

const BANDS: ConfidenceBand[] = ['high', 'medium', 'low'];

/** Scores are fractions; one sent as a percentage (73 rather than 0.73) is brought back to 0..1. */
const fraction = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? (value > 1.0001 ? value / 100 : value) : null;

function normaliseItem(item: SearchResultItem): SearchResultItem {
  const band = String(item.confidenceBand ?? '').toLowerCase() as ConfidenceBand;
  const breakdown = item.scoreBreakdown ?? ({} as SearchResultItem['scoreBreakdown']);
  return {
    ...item,
    resultType: /synthetic/i.test(String(item.resultType ?? '')) ? 'synthetic_preview' : 'real_tile',
    confidenceBand: BANDS.includes(band) ? band : 'low',
    score: fraction(item.score) ?? 0,
    displayUrl: item.displayUrl ?? item.thumbnailUrl ?? null,
    thumbnailUrl: item.thumbnailUrl ?? item.displayUrl ?? null,
    scoreBreakdown: {
      ...breakdown,
      chemistrySimilarity: fraction(breakdown.chemistrySimilarity),
      firingCompatibility: fraction(breakdown.firingCompatibility),
      labelOrTextSimilarity: fraction(breakdown.labelOrTextSimilarity),
      imageSimilarity: fraction(breakdown.imageSimilarity),
      colourantSimilarity: fraction(breakdown.colourantSimilarity),
    },
    matchedFields: item.matchedFields ?? [],
    tile: {
      variant: item.tile?.variant ?? null,
      surface: item.tile?.surface ?? null,
      opacity: item.tile?.opacity ?? null,
      colourFamily: item.tile?.colourFamily ?? null,
      clayBody: item.tile?.clayBody ?? null,
    },
    firing: {
      coneMin: item.firing?.coneMin ?? null,
      coneMax: item.firing?.coneMax ?? null,
      atmosphere: (item.firing?.atmosphere?.toLowerCase() as SearchResultItem['firing']['atmosphere']) ?? null,
    },
    source: {
      recordType: item.source?.recordType ?? '',
      recipeId: item.source?.recipeId ?? null,
      recipeCode: item.source?.recipeCode ?? null,
      // Sent by the API since 21 Oct 2026; older saved searches and older APIs leave it out.
      recipeName: item.source?.recipeName?.trim() || null,
      metadataVisibility: item.source?.metadataVisibility ?? '',
    },
    limitations: item.limitations ?? [],
  };
}

/**
 * The API marks most fields nullable and spells some values its own way, so results are tidied
 * once here and the screens can rely on the shapes in @glazion/types.
 */
export function normaliseSearch(res: RecipeImageSearchResponse): RecipeImageSearchResponse {
  const items = (res.items ?? []).map(normaliseItem);
  return {
    ...res,
    query: {
      type: res.query?.type ?? 'umf',
      inputHash: res.query?.inputHash ?? '',
      calculationProfile: res.query?.calculationProfile ?? null,
      recipeCode: res.query?.recipeCode ?? null,
      umf: res.query?.umf ?? null,
      colourants: res.query?.colourants ?? null,
      colorantMaterials: res.query?.colorantMaterials ?? null,
    },
    items,
    // An older response has no closestMatch; the best item is the same thing.
    closestMatch: res.closestMatch ? normaliseItem(res.closestMatch) : res.closestMatch === null ? null : (items[0] ?? null),
    similar: (res.similar ?? []).map(normaliseItem),
    warnings: res.warnings ?? [],
    ranker: {
      version: res.ranker?.version ?? '',
      candidateCount: res.ranker?.candidateCount ?? 0,
      returnedCount: res.ranker?.returnedCount ?? 0,
      minimumConfidence: res.ranker?.minimumConfidence ?? 0,
    },
  };
}

/**
 * The backend's UMF calculator. It is the only place the apps get UMF numbers from: they send the
 * recipe as typed and show what comes back. Live in the API as of 14 Oct 2026, so no sample flag.
 */
export const umfApi = {
  /** Stateless and cheap; call it on each edit (debounced), and keep only the latest answer. */
  calculate: (body: UmfCalculateRequest, signal?: AbortSignal) =>
    apiRequest<UmfCalculateResponse>('POST', '/api/v2/umf/calculate', { body, signal }),
  /** Target ranges for one cone, for before there's a recipe. The calculate response carries them too. */
  limits: (cone: string) => apiRequest<GlazeLimit[]>('GET', '/api/v2/glaze-limits', { query: { cone } }),
};

/** Why the search turned a recipe down (a 422), in a form the form can act on. */
export type SearchProblem =
  | { code: 'materials_unresolved'; resolutions: MaterialResolution[] }
  | { code: 'zero_flux' };

function suggestionsOf(value: unknown): MaterialResolution['suggestions'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((s: any) => {
    if (typeof s === 'string') return [{ materialId: null, name: s }];
    const name = s?.name ?? s?.rawName ?? s?.materialName ?? null;
    return name ? [{ materialId: s?.materialId ?? s?.id ?? null, name: String(name) }] : [];
  });
}

/**
 * Reads a 422 from POST /recipe-image/search. The API puts code and resolutions at the top of the
 * problem details (17 Oct 2026); "extensions" is still read in case that ever changes.
 */
export function searchProblem(err: unknown): SearchProblem | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null;
  const body: any = err.body ?? {};
  const where = [body, body.extensions ?? {}, body.error ?? {}];
  const code = String(where.map((b) => b.code ?? b.error ?? b.type ?? '').find((c) => /materials_unresolved|zero_flux/.test(String(c))) ?? '');
  const text = code || JSON.stringify(body);
  if (text.includes('zero_flux')) return { code: 'zero_flux' };
  if (!text.includes('materials_unresolved')) return null;
  const list = where.map((b) => b.resolutions).find(Array.isArray) ?? [];
  return {
    code: 'materials_unresolved',
    resolutions: list.map((r: any) => ({
      position: Number(r?.position ?? r?.index ?? -1),
      rawName: r?.rawName ?? null,
      status: r?.status ?? null,
      suggestions: suggestionsOf(r?.suggestions),
    })),
  };
}

/** A result can be in items, in similar or in both, so screens look it up in both. */
export function findResult(search: RecipeImageSearchResponse | undefined, imageId: string): SearchResultItem | undefined {
  return search?.items.find((item) => item.imageId === imageId) ?? search?.similar.find((item) => item.imageId === imageId);
}

/** The search is gone or isn't this user's (404 search_not_found), so it can come off their history. */
export function isSearchGone(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** A new key per search, reused when the same search is retried, so a retry can't run it twice. */
export const newSearchKey = uid;

export const searchApi = {
  run: (body: RecipeImageSearchRequest, idempotencyKey?: string) =>
    call<RecipeImageSearchResponse>('search', 'POST', '/api/v2/recipe-image/search', {
      body,
      // Checked, because a mutation library may pass its own second argument.
      headers: typeof idempotencyKey === 'string' ? { 'Idempotency-Key': idempotencyKey } : undefined,
    }).then(normaliseSearch),
  getOne: (searchId: string) =>
    call<RecipeImageSearchResponse>('search', 'GET', `/api/v2/recipe-image/search/${searchId}`).then(normaliseSearch),
  sendFeedback: (body: SearchFeedbackRequest) => call<void>('search', 'POST', '/api/v2/recipe-image/feedback', { body }),
  /** Whether search is strict about firing, so the form can say so rather than offer the choice. */
  settings: () => call<SearchSettingsDto>('search', 'GET', '/api/v2/recipe-image/settings'),
};

const lower = (value: unknown) => String(value ?? '').toLowerCase();

function normaliseSummary<T extends ConversationSummary>(c: T): T {
  return { ...c, title: c.title?.trim() || 'New conversation' };
}

function normaliseMessage(m: ChatMessage): ChatMessage {
  const band = lower(m.confidence) as ConfidenceBand;
  const sources = (m.sources ?? []).map(
    (s, i): ChatSource => ({ ...s, id: s.id ?? `${m.id}-${i}`, kind: lower(s.kind) as ChatSource['kind'], title: s.title ?? '', snippet: s.snippet ?? '' }),
  );
  const toolCalls = (m.toolCalls ?? []).map(
    (t): ChatToolCall => ({ name: lower(t.name) as ChatToolCall['name'], summary: t.summary ?? '', searchId: t.searchId ?? undefined }),
  );
  return {
    ...m,
    role: lower(m.role) === 'user' ? 'user' : 'assistant',
    content: m.content ?? '',
    sources: sources.length > 0 ? sources : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    confidence: BANDS.includes(band) ? band : undefined,
  };
}

/** Chat responses mark every field nullable and type role and confidence as plain strings. */
export function normaliseConversation(c: Conversation): Conversation {
  return { ...normaliseSummary(c), messages: (c.messages ?? []).map(normaliseMessage) };
}

export function normaliseSendResponse(res: SendMessageResponse): SendMessageResponse {
  return {
    userMessage: normaliseMessage(res.userMessage),
    assistantMessage: normaliseMessage(res.assistantMessage),
    conversation: normaliseSummary(res.conversation),
  };
}

/** The sidebar shows every conversation, so the list follows nextCursor up to this many pages. */
const MAX_CONVERSATION_PAGES = 10;

async function listConversations(): Promise<PagedResult<ConversationSummary>> {
  const items: ConversationSummary[] = [];
  let cursor: string | undefined;
  let page: PagedResult<ConversationSummary> | undefined;
  for (let i = 0; i < MAX_CONVERSATION_PAGES; i++) {
    page = await call<PagedResult<ConversationSummary>>('chat', 'GET', '/api/v2/conversations', { query: { cursor, pageSize: 50 } });
    items.push(...(page.items ?? []).map(normaliseSummary));
    cursor = page.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return { items, totalCount: page?.totalCount ?? items.length, nextCursor: cursor ?? null };
}

export const chatApi = {
  list: listConversations,
  create: (title?: string) =>
    call<Conversation>('chat', 'POST', '/api/v2/conversations', { body: (title ? { title } : {}) satisfies CreateConversationRequest }).then(
      normaliseConversation,
    ),
  getOne: (conversationId: string) => call<Conversation>('chat', 'GET', `/api/v2/conversations/${conversationId}`).then(normaliseConversation),
  send: (conversationId: string, body: SendMessageRequest) =>
    call<SendMessageResponse>('chat', 'POST', `/api/v2/conversations/${conversationId}/messages`, { body }).then(normaliseSendResponse),
  rename: (conversationId: string, title: string) =>
    call<ConversationSummary>('chat', 'PATCH', `/api/v2/conversations/${conversationId}`, { body: { title } }).then(normaliseSummary),
  remove: (conversationId: string) => call<void>('chat', 'DELETE', `/api/v2/conversations/${conversationId}`),
  sendFeedback: (body: ChatFeedbackRequest) => call<void>('chat', 'POST', '/api/v2/chat/feedback', { body }),
};

export const accountApi = {
  register: (body: RegisterRequest) => call<RegisterResult>('signUp', 'POST', '/api/v2/auth/register', { body, auth: false }),
  requestPasswordReset: (usernameOrEmail: string) =>
    call<void>('passwordReset', 'POST', '/api/v2/auth/forgot-password', { body: { usernameOrEmail }, auth: false }),
};
