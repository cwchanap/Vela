export interface Env {
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  APP_NAME?: string;

  // DynamoDB (Local) configuration for chat history
  DDB_ENDPOINT?: string; // e.g. http://127.0.0.1:8000
  DDB_REGION?: string; // e.g. local
  DDB_TABLE?: string; // e.g. VelaChatMessages
}

import { handleLLMChat } from '../src/api/llm-chat';
import { handleChatHistory } from '../src/api/chat-history';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Only handle API routes here. Assets & SPA fallback are handled by the plugin via wrangler assets config.
    if (
      url.pathname === '/api/llm-chat' ||
      (url.pathname.startsWith('/api/llm-chat') && request.method === 'OPTIONS')
    ) {
      return handleLLMChat(request, env);
    }

    // Chat history routes (save/list/messages)
    if (
      url.pathname.startsWith('/api/chat-history') ||
      (url.pathname.startsWith('/api/chat-history') && request.method === 'OPTIONS')
    ) {
      return handleChatHistory(request, env as unknown as Record<string, unknown>);
    }

    return new Response(null, { status: 404 });
  },
};
