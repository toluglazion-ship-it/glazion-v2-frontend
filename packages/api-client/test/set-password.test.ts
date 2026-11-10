// Admin "Set password": the length rule matches the API, the ended-session count is read whatever
// the API calls it, and the fake backend behaves like the real one. Never run against live.
import { beforeAll, expect, it } from 'vitest';

let client: typeof import('../src/index');
let mock: typeof import('../src/mock');
beforeAll(async () => {
  // The client keeps its session in browser storage; a stand-in is enough to load it here.
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  client = await import('../src/index');
  mock = await import('../src/mock');
});

it('accepts 8 to 256 characters', () => {
  expect(client.passwordProblem('1234567')).toMatch(/at least 8/);
  expect(client.passwordProblem('12345678')).toBeNull();
  expect(client.passwordProblem('x'.repeat(256))).toBeNull();
  expect(client.passwordProblem('x'.repeat(257))).toMatch(/no more than 256/);
});

it('reads the ended-session count however it comes back', () => {
  expect(client.normaliseSetPassword(3)).toEqual({ sessionsEnded: 3 });
  expect(client.normaliseSetPassword({ sessionsEnded: 2 })).toEqual({ sessionsEnded: 2 });
  expect(client.normaliseSetPassword({ revokedSessions: 0 })).toEqual({ sessionsEnded: 0 });
  expect(client.normaliseSetPassword({ ok: true })).toEqual({ sessionsEnded: null });
  expect(client.normaliseSetPassword(undefined)).toEqual({ sessionsEnded: null });
});

it('fake backend sets the password, refuses bad ones and unknown users', async () => {
  const list: any = await mock.handleMockRequest('GET', '/api/v2/admin/users', { search: 'tunde' }, undefined);
  const id = list.items[0].id;
  const path = `/api/v2/admin/users/${id}/password`;

  const result: any = await mock.handleMockRequest('POST', path, {}, { password: 'new-pass-123' });
  expect(client.normaliseSetPassword(result).sessionsEnded).toBe(2);
  expect(JSON.stringify(result)).not.toContain('new-pass-123');

  await expect(mock.handleMockRequest('POST', path, {}, { password: 'short' })).rejects.toMatchObject({ status: 400 });
  await expect(mock.handleMockRequest('POST', path, {}, {})).rejects.toMatchObject({ status: 400 });
  await expect(
    mock.handleMockRequest('POST', '/api/v2/admin/users/00000000-0000-4000-8000-000000000000/password', {}, { password: 'long-enough' }),
  ).rejects.toMatchObject({ status: 404 });
});
