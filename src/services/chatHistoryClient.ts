export interface ChatHistoryItemDTO {
  chat_id: string;
  user_id: string;
  date: string; // ISO
  message: string;
  is_user: boolean;
}

export interface ChatThreadSummaryDTO {
  chat_id: string;
  lastDate: string; // ISO
  title: string;
  messageCount: number;
}

async function httpJson(input: RequestInfo, init?: RequestInit) {
  const res = await fetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error as string;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }
  return res.json();
}

export const chatHistoryClient = {
  async saveMessage(item: Omit<ChatHistoryItemDTO, 'date'> & { date?: string }): Promise<void> {
    const body: ChatHistoryItemDTO = {
      ...item,
      date: item.date || new Date().toISOString(),
    };
    await httpJson('/api/chat-history/save', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async listThreads(user_id: string): Promise<ChatThreadSummaryDTO[]> {
    const data = await httpJson(
      `/api/chat-history/threads?user_id=${encodeURIComponent(user_id)}`,
      {
        method: 'GET',
      },
    );
    return (data?.threads as ChatThreadSummaryDTO[]) || [];
  },

  async getMessages(chat_id: string): Promise<ChatHistoryItemDTO[]> {
    const data = await httpJson(
      `/api/chat-history/messages?chat_id=${encodeURIComponent(chat_id)}`,
      {
        method: 'GET',
      },
    );
    return (data?.items as ChatHistoryItemDTO[]) || [];
  },
};
