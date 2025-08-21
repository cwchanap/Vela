export interface Env {
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  APP_NAME?: string;
}

import { handleLLMChat } from '../src/api/llm-chat';

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

    return new Response(null, { status: 404 });
  },
};
