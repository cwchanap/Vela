export interface Env {
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  APP_NAME?: string;

  // AWS DynamoDB configuration for chat history
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  DDB_ENDPOINT?: string; // e.g. https://dynamodb.us-east-1.amazonaws.com
  DDB_REGION?: string; // e.g. us-east-1
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
