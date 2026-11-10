// The sign-in screen says when a session ran out by itself, and only then. Stubbed fetch, never live.
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

let client: typeof import('../src/index');
beforeAll(async () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  client = await import('../src/index');
});
afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const login = { tokens: { accessToken: 'a1', refreshToken: 'r1', expiresInSeconds: 3600 }, userId: 'u1', username: 'ada', displayName: 'Ada', role: 1, accountStatus: 1 };

it('is set when a session can no longer be refreshed, and cleared by signing in again', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/auth/login') ? json(200, login) : json(401, { title: 'Unauthorized' }))));
  await client.signIn('ada', 'pw');
  expect(client.sessionHasEnded()).toBe(false);

  // The access token is refused and so is the refresh: the session is over.
  await expect(client.meApi.get()).rejects.toBeInstanceOf(client.ApiError);
  expect(client.tokenStore.access).toBeNull();
  expect(client.sessionHasEnded()).toBe(true);

  await client.signIn('ada', 'pw');
  expect(client.sessionHasEnded()).toBe(false);
});

it('is not set by signing out', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/auth/login') ? json(200, login) : new Response('', { status: 204 }))));
  await client.signIn('ada', 'pw');
  await client.signOut();
  expect(client.tokenStore.access).toBeNull();
  expect(client.sessionHasEnded()).toBe(false);
});
