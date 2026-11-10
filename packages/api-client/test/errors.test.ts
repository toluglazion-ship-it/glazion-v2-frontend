// What people read when a request fails: the API's own words where it has them, plain ones where not.
// Requests go to a stubbed fetch, never to a real server.
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

let client: typeof import('../src/index');
beforeAll(async () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  client = await import('../src/index');
});
afterEach(() => vi.unstubAllGlobals());

function answer(status: number, body?: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body === undefined ? '' : JSON.stringify(body), { status })));
}

async function failure(status: number, body?: unknown): Promise<string> {
  answer(status, body);
  const err = await client.materialsApi.list().catch((e) => e);
  expect(err).toBeInstanceOf(client.ApiError);
  return client.errorMessage(err);
}

it('uses the API detail when there is one', async () => {
  expect(await failure(409, { title: 'Username taken', detail: 'That username is already taken.' })).toBe('That username is already taken.');
});

it('reads the first field error from a validation problem', async () => {
  expect(await failure(400, { title: 'One or more validation errors occurred.', errors: { Email: ['A valid email address is required.'] } })).toBe('A valid email address is required.');
});

it('keeps a title that says something, but not one that only names the status', async () => {
  expect(await failure(400, { title: 'Validation failed' })).toBe('Validation failed');
  expect(await failure(400, { title: 'Bad Request' })).toBe("Some of the details weren't accepted. Check them and try again.");
  expect(await failure(422, { title: 'Unprocessable Entity' })).toBe("Some of the details weren't accepted. Check them and try again.");
});

it('says something plain for a bare status', async () => {
  expect(await failure(409)).toBe('That clashes with something that already exists.');
  expect(await failure(413)).toBe("That's too large to send.");
  expect(await failure(429)).toBe('Too many tries in a row. Wait a moment and try again.');
  expect(await failure(503)).toBe('The server ran into a problem. Please try again shortly.');
  expect(await failure(418)).toBe('Something went wrong (error 418). Please try again.');
});
