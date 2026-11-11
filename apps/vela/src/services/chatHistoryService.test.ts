import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
}));

import { fetchAuthSession } from 'aws-amplify/auth';
import {
  deleteChatThread,
  getChatMessages,
  listChatThreads,
  saveChatMessage,
  updateChatThread,
} from './chatHistoryService';

const mockFetchAuthSession = vi.mocked(fetchAuthSession);

const sessionFor = (sub: string) =>
  ({
    tokens: {
      idToken: {
        toString: () => `id-token-${sub}`,
        payload: { sub },
      },
    },
  }) as Awaited<ReturnType<typeof fetchAuthSession>>;

const okJson = (body: unknown) => ({ ok: true, json: async () => body });

describe('chatHistoryService', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    mockFetchAuthSession.mockResolvedValue(sessionFor('user-a'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists threads without a user_id parameter', async () => {
    const threads = [{ ThreadId: 't-1', title: 'One', createdAt: 1, updatedAt: 2 }];
    fetchMock.mockResolvedValue(okJson({ threads }));

    const result = await listChatThreads('user-a');

    expect(result).toEqual(threads);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat-history/threads',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer id-token-user-a' }),
      }),
    );
  });

  it('returns an empty list when the threads payload is absent', async () => {
    fetchMock.mockResolvedValue(okJson({}));
    expect(await listChatThreads('user-a')).toEqual([]);
  });

  it('fetches messages for a thread', async () => {
    const items = [
      { ThreadId: 't-1', Timestamp: 10, UserId: 'user-a', message: 'hi', is_user: true },
    ];
    fetchMock.mockResolvedValue(okJson({ items }));

    const result = await getChatMessages('t-1', 'user-a');

    expect(result).toEqual(items);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat-history/messages?thread_id=t-1',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer id-token-user-a' }),
      }),
    );
  });

  it('saves a message with the supplied identity in the payload', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));

    await saveChatMessage('t-1', 'user-a', 'hello', true);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat-history/save',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"ThreadId":"t-1"'),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({
      ThreadId: 't-1',
      UserId: 'user-a',
      message: 'hello',
      is_user: true,
    });
    expect(typeof body.Timestamp).toBe('number');
    expect(body).not.toHaveProperty('model');
    expect(body).not.toHaveProperty('lastLlmAt');
  });

  it('forwards optional model metadata on a user save', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));

    await saveChatMessage('t-1', 'user-a', 'hello', true, {
      model: { provider: 'anthropic', model: 'claude-opus-4' },
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.model).toEqual({ provider: 'anthropic', model: 'claude-opus-4' });
    expect(body).not.toHaveProperty('lastLlmAt');
  });

  it('forwards optional lastLlmAt on an assistant save', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));

    await saveChatMessage('t-1', 'user-a', 'こんにちは', false, { lastLlmAt: 1700000000000 });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.is_user).toBe(false);
    expect(body.lastLlmAt).toBe(1700000000000);
    expect(body).not.toHaveProperty('model');
  });

  it('patches a thread via the path-parameter endpoint', async () => {
    const thread = { ThreadId: 't-1', title: 'Renamed', createdAt: 1, updatedAt: 3 };
    fetchMock.mockResolvedValue(okJson({ thread }));

    const result = await updateChatThread('t-1', { title: 'Renamed' }, 'user-a');

    expect(result).toEqual(thread);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat-history/thread/t-1',
      expect.objectContaining({ method: 'PATCH', body: '{"title":"Renamed"}' }),
    );
  });

  it('deletes a thread via the path-parameter endpoint', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));

    await deleteChatThread('t-1', 'user-a');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat-history/thread/t-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it.each([
    ['listChatThreads', () => listChatThreads('user-a')],
    ['getChatMessages', () => getChatMessages('t-1', 'user-a')],
    ['saveChatMessage', () => saveChatMessage('t-1', 'user-a', 'hello', true)],
    ['updateChatThread', () => updateChatThread('t-1', { title: 'x' }, 'user-a')],
    ['deleteChatThread', () => deleteChatThread('t-1', 'user-a')],
  ])('rejects %s without fetching when the session switched accounts', async (_name, invoke) => {
    mockFetchAuthSession.mockResolvedValue(sessionFor('user-b'));

    await expect(invoke()).rejects.toThrow(/account changed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
