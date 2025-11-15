import { Hono } from 'hono';
import type { Env } from '../types';

const llmChat = new Hono<{ Bindings: Env }>();

// Custom CORS handler with origin validation
llmChat.use('*', async (c, next) => {
  const origin = c.req.header('Origin');

  // Parse allowed origins from environment variable (comma-separated)
  const allowedOrigins = c.env.CORS_ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) || [];

  const isAllowedOrigin = origin && allowedOrigins.includes(origin);

  if (origin && !isAllowedOrigin) {
    // Origin not allowed - return 403 for non-OPTIONS requests
    if (c.req.method !== 'OPTIONS') {
      return c.json({ error: 'CORS policy violation: Origin not allowed' }, 403);
    }

    // For OPTIONS requests with invalid origin, don't set CORS headers
    await next();
    return;
  }

  if (isAllowedOrigin && origin) {
    // Set specific origin instead of wildcard
    c.header('Access-Control-Allow-Origin', origin);
  }

  // Set other CORS headers
  c.header('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  c.header('Access-Control-Allow-Methods', 'POST,OPTIONS');

  if (c.req.method === 'OPTIONS') {
    return c.text('', 200);
  }

  await next();
});

llmChat.post('/', async (c) => {
  let input;
  try {
    input = await c.req.json();
  } catch (e) {
    console.error('JSON parse error:', e);
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const provider = input.provider;
  if (!provider) {
    return c.json({ error: 'Missing provider' }, 400);
  }

  if (!input.messages && !input.prompt) {
    return c.json({ error: 'Missing prompt or messages' }, 400);
  }

  try {
    if (provider === 'google') {
      // Prefer user-provided API key, fall back to server-side key
      const apiKey: string | undefined = input.apiKey || c.env.GOOGLE_API_KEY;
      if (!apiKey) {
        return c.json(
          {
            error:
              'Missing API key for Google provider. Configure GOOGLE_API_KEY on server or provide your own API key.',
          },
          400,
        );
      }

      const model = input.model || 'gemini-2.5-flash-lite';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

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
        return c.json({ error: 'Missing prompt or messages' }, 400);
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
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      });

      const txt = await res.text();
      if (!res.ok) {
        return c.json({ error: `Google error ${res.status}: ${txt}` }, 500);
      }

      const data = JSON.parse(txt);
      const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return c.json({ text, raw: data });
    }

    if (provider === 'openrouter') {
      // Prefer user-provided API key, fall back to server-side key
      const apiKey: string | undefined = input.apiKey || c.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        return c.json(
          {
            error:
              'Missing API key for OpenRouter provider. Configure OPENROUTER_API_KEY on server or provide your own API key.',
          },
          400,
        );
      }

      const model = input.model || 'openai/gpt-oss-20b:free';
      const endpoint = 'https://openrouter.ai/api/v1/chat/completions';

      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
      const pushMsg = (m: { role: 'system' | 'user' | 'assistant'; content: string }) =>
        messages.push({ role: m.role, content: m.content });

      if (input.system) messages.push({ role: 'system', content: input.system });
      if (input.messages && input.messages.length > 0) {
        for (const m of input.messages) pushMsg(m);
      } else if (input.prompt) {
        messages.push({ role: 'user', content: input.prompt });
      } else {
        return c.json({ error: 'Missing prompt or messages' }, 400);
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
        'HTTP-Referer': input.referer || c.req.url,
        'X-Title': input.appName || c.env.APP_NAME || 'Vela Japanese Learning App',
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const txt = await res.text();
      if (!res.ok) {
        return c.json({ error: `OpenRouter error ${res.status}: ${txt}` }, 500);
      }

      const data = JSON.parse(txt);
      const text: string = data?.choices?.[0]?.message?.content ?? '';
      return c.json({ text, raw: data });
    }

    return c.json({ error: 'Unsupported provider' }, 400);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

export { llmChat };
