import { Hono } from 'hono';
import { myDictionaries } from '../dynamodb';
import type { Env } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { isAllowedOrigin } from '../middleware/cors';

const app = new Hono<{ Bindings: Env } & AuthContext>();

// Track whether CORS configuration warning has been logged (to log only once)
let corsConfigWarningLogged = false;

// Apply auth middleware to all routes in this router.
app.use('*', requireAuth);

// eslint-disable-next-line no-unused-vars
type TextExtractor = (jsonStr: string) => string | undefined;

function createSSEStream(
  upstreamBody: ReadableStream<Uint8Array> | null,
  extractText: TextExtractor,
  metadata: { provider: string; model: string; sentence: string },
  skipDoneMarker?: string,
): ReadableStream<string> {
  return new ReadableStream({
    async start(controller) {
      try {
        const reader = upstreamBody?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          controller.enqueue(
            `data: ${JSON.stringify({ type: 'error', error: 'No response body from upstream API' })}\n\n`,
          );
          controller.close();
          return;
        }

        // Send initial metadata
        controller.enqueue(`data: ${JSON.stringify({ type: 'metadata', ...metadata })}\n\n`);

        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6).trim();
              if (jsonStr === '' || (skipDoneMarker && jsonStr === skipDoneMarker)) continue;

              try {
                const text = extractText(jsonStr);
                if (text) {
                  controller.enqueue(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
                }
              } catch (e) {
                console.debug('Skipping invalid JSON chunk:', e);
              }
            }
          }
        }

        // Flush the TextDecoder and process any remaining buffered text
        const remaining = decoder.decode(); // Decode without {stream: true} to flush
        buffer += remaining;

        // Process any final lines from the buffer
        if (buffer.trim().length > 0) {
          const finalLines = buffer.split('\n');
          for (const line of finalLines) {
            const trimmedLine = line.trim();
            if (trimmedLine.length > 0 && trimmedLine.startsWith('data: ')) {
              const jsonStr = trimmedLine.slice(6).trim();
              if (jsonStr !== '' && !(skipDoneMarker && jsonStr === skipDoneMarker)) {
                try {
                  const text = extractText(jsonStr);
                  if (text) {
                    controller.enqueue(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
                  }
                } catch (e) {
                  console.debug('Skipping invalid JSON chunk in flush:', e);
                }
              }
            }
          }
        }

        controller.enqueue(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        controller.close();
      } catch (error) {
        controller.enqueue(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`);
        controller.close();
      }
    },
  });
}

// Save a sentence
app.post('/', async (c) => {
  try {
    const authenticatedUserId = c.get('userId');
    const authenticatedUserEmail = c.get('userEmail');

    // Keep backward compatibility for existing dictionary records keyed by email.
    const dictionaryUserId = authenticatedUserEmail || authenticatedUserId;

    if (!dictionaryUserId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { sentence, sourceUrl, context } = body;

    if (!sentence || typeof sentence !== 'string' || sentence.trim().length === 0) {
      return c.json({ error: 'Sentence is required' }, 400);
    }

    const result = await myDictionaries.create(
      dictionaryUserId,
      sentence.trim(),
      sourceUrl,
      context,
    );

    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Error saving sentence:', error);
    return c.json({ error: 'Failed to save sentence' }, 500);
  }
});

// Get user's saved sentences
app.get('/', async (c) => {
  try {
    const authenticatedUserId = c.get('userId');
    const authenticatedUserEmail = c.get('userEmail');

    // Keep backward compatibility for existing dictionary records keyed by email.
    const dictionaryUserId = authenticatedUserEmail || authenticatedUserId;

    if (!dictionaryUserId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Parse and validate limit with fallback to default (50) and max cap (100)
    const DEFAULT_LIMIT = 50;
    const MAX_LIMIT = 100;
    const parsedLimit = parseInt(c.req.query('limit') || String(DEFAULT_LIMIT), 10);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;

    const sentences = await myDictionaries.getByUser(dictionaryUserId, limit);

    return c.json({
      success: true,
      data: sentences,
    });
  } catch (error: any) {
    console.error('Error fetching saved sentences:', error);
    return c.json({ error: 'Failed to fetch saved sentences' }, 500);
  }
});

// Delete a saved sentence
app.delete('/:sentenceId', async (c) => {
  try {
    const authenticatedUserId = c.get('userId');
    const authenticatedUserEmail = c.get('userEmail');

    // Keep backward compatibility for existing dictionary records keyed by email.
    const dictionaryUserId = authenticatedUserEmail || authenticatedUserId;

    if (!dictionaryUserId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sentenceId = c.req.param('sentenceId');

    if (!sentenceId) {
      return c.json({ error: 'Sentence ID is required' }, 400);
    }

    await myDictionaries.delete(dictionaryUserId, sentenceId);

    return c.json({
      success: true,
      message: 'Sentence deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting sentence:', error);
    return c.json({ error: 'Failed to delete sentence' }, 500);
  }
});

// Ask AI about a sentence (streaming)
app.post('/analyze', async (c) => {
  try {
    const authenticatedUserId = c.get('userId');
    const authenticatedUserEmail = c.get('userEmail');

    // Keep backward compatibility for existing dictionary records keyed by email.
    const dictionaryUserId = authenticatedUserEmail || authenticatedUserId;

    if (!dictionaryUserId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { sentence, provider, model, apiKey } = body;
    const requestOrigin = c.req.header('Origin');
    const corsConfig = c.env?.CORS_ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS;
    const allowedOrigins = corsConfig?.split(',').map((o: string) => o.trim()) || [];

    // Use shared utility to check if origin is allowed (includes both web and extension origins)
    const originCheck = isAllowedOrigin(requestOrigin, c.env);

    // Warn if CORS_ALLOWED_ORIGINS is not configured or empty (disables SSE CORS)
    // Only log the warning once to avoid spamming logs on every request
    if (
      !corsConfigWarningLogged &&
      (!corsConfig || corsConfig.trim() === '' || allowedOrigins.length === 0)
    ) {
      console.warn(
        'Warning: CORS_ALLOWED_ORIGINS is not configured or is empty. SSE CORS validation is disabled. Please set CORS_ALLOWED_ORIGINS environment variable.',
      );
      corsConfigWarningLogged = true;
    }

    // Validate CORS origin: only reject when allowedOrigins is configured (non-empty)
    // and requestOrigin is present but not allowed
    if (allowedOrigins.length > 0 && requestOrigin && !originCheck.isAllowed) {
      console.warn(
        `CORS rejection: Origin '${requestOrigin}' is not in allowed origins. ` +
          `Allowed origins: [${allowedOrigins.join(',')}]. ` +
          `CORS config warning logged: ${corsConfigWarningLogged}.`,
      );
      return c.json({ error: 'Origin not allowed' }, 403);
    }

    // Set validated origin for CORS header (only set if origin is allowed)
    const validatedOrigin = originCheck.allowedOrigin;

    if (!sentence || typeof sentence !== 'string' || sentence.trim().length === 0) {
      return c.json({ error: 'Sentence is required' }, 400);
    }

    if (!provider) {
      return c.json({ error: 'LLM provider is required' }, 400);
    }

    const systemPrompt = `You are a Japanese language expert. Analyze the provided Japanese sentence and provide:
1. English translation
2. Grammar breakdown (key grammar points)
3. Vocabulary notes (important words with readings)
4. Usage context (when/how to use this sentence)

Keep it concise and educational.`;

    const userPrompt = `Analyze this Japanese sentence: "${sentence.trim()}"`;

    // Call the appropriate LLM provider with streaming support
    if (provider === 'google') {
      const key: string | undefined = apiKey;
      if (!key) {
        return c.json({ error: 'Missing API key for Google provider' }, 400);
      }

      const llmModel = model || 'gemini-2.5-flash-lite';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${llmModel}:streamGenerateContent?alt=sse`;

      const requestBody = {
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const txt = await res.text();
        return c.json({ error: `Google API error ${res.status}: ${txt}` }, 500);
      }

      const extractGoogleText: TextExtractor = (jsonStr) => {
        const data = JSON.parse(jsonStr);
        return data?.candidates?.[0]?.content?.parts?.[0]?.text;
      };

      const stream = createSSEStream(res.body, extractGoogleText, {
        provider,
        model: llmModel,
        sentence: sentence.trim(),
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          ...(validatedOrigin ? { 'Access-Control-Allow-Origin': validatedOrigin } : {}),
        },
      });
    }

    if (provider === 'openrouter') {
      const key: string | undefined = apiKey;
      if (!key) {
        return c.json({ error: 'Missing API key for OpenRouter provider' }, 400);
      }

      const llmModel = model || 'openai/gpt-oss-20b:free';
      const endpoint = 'https://openrouter.ai/api/v1/chat/completions';

      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      const requestBody = {
        model: llmModel,
        messages,
        temperature: 0.7,
        max_tokens: 1024,
        stream: true,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': c.req.url,
        'X-Title': c.env.APP_NAME || 'Vela Japanese Learning App',
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const txt = await res.text();
        return c.json({ error: `OpenRouter API error ${res.status}: ${txt}` }, 500);
      }

      const extractOpenRouterText: TextExtractor = (jsonStr) => {
        const data = JSON.parse(jsonStr);
        return data?.choices?.[0]?.delta?.content;
      };

      const stream = createSSEStream(
        res.body,
        extractOpenRouterText,
        { provider, model: llmModel, sentence: sentence.trim() },
        '[DONE]',
      );

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          ...(validatedOrigin ? { 'Access-Control-Allow-Origin': validatedOrigin } : {}),
        },
      });
    }

    return c.json({ error: 'Unsupported provider' }, 400);
  } catch (error: any) {
    console.error('Error analyzing sentence:', error);
    return c.json({ error: 'Failed to analyze sentence' }, 500);
  }
});

export default app;
