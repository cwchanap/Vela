export interface Env {
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  APP_NAME?: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMBridgeRequest {
  provider: 'google' | 'openrouter';
  model?: string;
  messages?: ChatMessage[];
  prompt?: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  appName?: string; // optional for OpenRouter X-Title
  referer?: string; // optional for OpenRouter HTTP-Referer
}

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

export async function handleLLMChat(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: { ...corsHeaders } });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  let input: LLMBridgeRequest;
  try {
    input = (await request.json()) as LLMBridgeRequest;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: `Invalid JSON: ${msg}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const provider = input.provider;
  if (!provider) {
    return new Response(JSON.stringify({ error: 'Missing provider' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    if (provider === 'google') {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Missing GEMINI_API_KEY server secret' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const model = input.model || 'gemini-2.5-flash-lite';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      type Part = { text: string };
      type Content = { role?: 'user' | 'model'; parts: Part[] };
      const contents: Content[] = [];
      let systemInstruction: { role?: 'system'; parts: Part[] } | undefined;

      if (input.messages && input.messages.length > 0) {
        for (const m of input.messages) {
          if (m.role === 'system') {
            systemInstruction = { role: 'system', parts: [{ text: m.content }] };
          } else {
            contents.push({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            });
          }
        }
      } else if (input.prompt) {
        contents.push({ role: 'user', parts: [{ text: input.prompt }] });
      } else {
        return new Response(JSON.stringify({ error: 'Missing prompt or messages' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const body: {
        contents: Content[];
        generationConfig: { temperature: number; maxOutputTokens: number };
        systemInstruction?: { role?: 'system'; parts: Part[] };
      } = {
        contents,
        generationConfig: {
          temperature: input.temperature ?? 0.7,
          maxOutputTokens: input.maxTokens ?? 1024,
        },
      };

      if (input.system) {
        body.systemInstruction = { role: 'system', parts: [{ text: input.system }] };
      } else if (systemInstruction) {
        body.systemInstruction = systemInstruction;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const txt = await res.text();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: `Google error ${res.status}: ${txt}` }), {
          status: res.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const data = JSON.parse(txt);
      const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return new Response(JSON.stringify({ text, raw: data }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (provider === 'openrouter') {
      const apiKey = env.OPENROUTER_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Missing OPENROUTER_API_KEY server secret' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const model = input.model || 'openai/gpt-oss-20b:free';
      const endpoint = 'https://openrouter.ai/api/v1/chat/completions';

      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
      const pushMsg = (m: ChatMessage) => messages.push({ role: m.role, content: m.content });

      if (input.system) messages.push({ role: 'system', content: input.system });
      if (input.messages && input.messages.length > 0) {
        for (const m of input.messages) pushMsg(m);
      } else if (input.prompt) {
        messages.push({ role: 'user', content: input.prompt });
      } else {
        return new Response(JSON.stringify({ error: 'Missing prompt or messages' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const body = {
        model,
        messages,
        temperature: input.temperature ?? 0.7,
        max_tokens: input.maxTokens ?? 1024,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': input.referer || new URL(request.url).origin,
        'X-Title': input.appName || env.APP_NAME || 'Vela Japanese Learning App',
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const txt = await res.text();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: `OpenRouter error ${res.status}: ${txt}` }), {
          status: res.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const data = JSON.parse(txt);
      const text: string = data?.choices?.[0]?.message?.content ?? '';
      return new Response(JSON.stringify({ text, raw: data }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({ error: 'Unsupported provider' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
