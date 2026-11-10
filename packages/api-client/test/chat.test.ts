// Chat runs on the API's conversation endpoints. The responses are tidied once in the client, and
// the whole flow is exercised against the fake backend (VITE_USE_MOCKS=true).
import { beforeAll, expect, it, vi } from 'vitest';

let main: typeof import('../src/main');
beforeAll(async () => {
  // The client keeps its session in browser storage; a stand-in is enough to load it here.
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  vi.stubEnv('VITE_USE_MOCKS', 'true');
  main = await import('../src/main');
});

it('copes with the API’s nullable and loosely typed chat fields', () => {
  const raw: any = {
    id: 'c1',
    title: null,
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T00:01:00Z',
    messages: [
      { id: 'm1', role: 'User', content: 'Why is it crazing?', createdAt: '2026-10-14T00:00:00Z', sources: null, toolCalls: null, confidence: null },
      { id: 'm2', role: 'ASSISTANT', content: null, createdAt: '2026-10-14T00:01:00Z', confidence: 'Low',
        sources: [{ id: null, kind: 'Knowledge', title: 'Crazing', snippet: null }],
        toolCalls: [{ name: 'search_recipe_images', summary: null, searchId: null }] },
    ],
  };
  const out = main.normaliseConversation(raw);
  const [user, answer] = out.messages;
  expect(out.title).toBe('New conversation');
  expect(user.role).toBe('user');
  expect(user.sources).toBeUndefined();
  expect(user.confidence).toBeUndefined();
  expect(answer.role).toBe('assistant');
  expect(answer.content).toBe('');
  expect(answer.confidence).toBe('low');
  expect(answer.sources).toEqual([{ id: 'm2-0', kind: 'knowledge', title: 'Crazing', snippet: '' }]);
  expect(answer.toolCalls).toEqual([{ name: 'search_recipe_images', summary: '', searchId: undefined }]);
  expect(main.normaliseConversation({ ...raw, messages: null }).messages).toEqual([]);
});

it('creates, sends, renames, lists and deletes against the fake backend', async () => {
  const { chatApi } = main;
  expect(main.usesSampleData('chat')).toBe(true);
  expect(main.SAMPLE_DATA.chat).toBe(false);

  const created = await chatApi.create();
  expect(created.messages).toEqual([]);

  const sent = await chatApi.send(created.id, { content: 'How do I stop crazing?' });
  expect(sent.userMessage.role).toBe('user');
  expect(sent.assistantMessage.role).toBe('assistant');
  expect(sent.assistantMessage.confidence).toBe('high');
  expect(sent.conversation.title).toBe('How do I stop crazing?');

  const opened = await chatApi.getOne(created.id);
  expect(opened.messages.map((m) => m.role)).toEqual(['user', 'assistant']);

  expect((await chatApi.rename(created.id, 'Crazing')).title).toBe('Crazing');
  const titled = await chatApi.create('Shino');
  expect(titled.title).toBe('Shino');

  const list = await chatApi.list();
  expect(list.items?.map((c) => c.title)).toEqual(expect.arrayContaining(['Crazing', 'Shino', 'Celadon crazing on porcelain']));
  expect(list.nextCursor).toBeNull();

  await chatApi.sendFeedback({ messageId: sent.assistantMessage.id, feedback: 'helpful' });
  await chatApi.remove(created.id);
  await expect(chatApi.getOne(created.id)).rejects.toMatchObject({ status: 404 });
}, 20_000);

it('pages the fake backend’s conversation list like the API', async () => {
  const { handleSampleRequest } = await import('../src/mock-main');
  const first: any = await handleSampleRequest('GET', '/api/v2/conversations', { pageSize: 1 }, undefined);
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).toBe('1');
  const second: any = await handleSampleRequest('GET', '/api/v2/conversations', { pageSize: 1, cursor: first.nextCursor }, undefined);
  expect(second.items[0].id).not.toBe(first.items[0].id);
});
