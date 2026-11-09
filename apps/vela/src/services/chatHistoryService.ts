import { getApiUrl } from 'src/utils/api';
import { httpJsonAuth } from 'src/utils/httpClient';
import type { LlmProvider } from '@vela/common';

export interface ChatThreadModelDTO {
  provider: LlmProvider;
  model: string;
}

export interface ChatThreadSummaryDTO {
  ThreadId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model?: ChatThreadModelDTO;
}

export interface ChatHistoryItemDTO {
  ThreadId: string;
  Timestamp: number;
  UserId: string;
  message: string;
  is_user: boolean;
}

export interface PatchChatThreadDTO {
  title?: string;
  model?: ChatThreadModelDTO;
}

export async function listChatThreads(): Promise<ChatThreadSummaryDTO[]> {
  const data = await httpJsonAuth<{ threads?: ChatThreadSummaryDTO[] }>(
    getApiUrl('chat-history/threads'),
  );
  return data.threads || [];
}

export async function getChatMessages(threadId: string): Promise<ChatHistoryItemDTO[]> {
  const data = await httpJsonAuth<{ items?: ChatHistoryItemDTO[] }>(
    getApiUrl(`chat-history/messages?thread_id=${encodeURIComponent(threadId)}`),
  );
  return data.items || [];
}

export async function saveChatMessage(
  threadId: string,
  userId: string,
  message: string,
  isUser: boolean,
): Promise<void> {
  const item: ChatHistoryItemDTO = {
    ThreadId: threadId,
    Timestamp: Date.now(),
    UserId: userId,
    message,
    is_user: isUser,
  };
  await httpJsonAuth<{ ok: boolean }>(getApiUrl('chat-history/save'), {
    method: 'POST',
    body: JSON.stringify(item),
  });
}

export async function updateChatThread(
  threadId: string,
  patch: PatchChatThreadDTO,
): Promise<ChatThreadSummaryDTO> {
  const data = await httpJsonAuth<{ thread: ChatThreadSummaryDTO }>(
    getApiUrl(`chat-history/thread/${encodeURIComponent(threadId)}`),
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  );
  return data.thread;
}

export async function deleteChatThread(threadId: string): Promise<void> {
  await httpJsonAuth<{ ok: boolean }>(
    getApiUrl(`chat-history/thread/${encodeURIComponent(threadId)}`),
    {
      method: 'DELETE',
    },
  );
}
