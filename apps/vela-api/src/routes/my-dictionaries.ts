import { Hono } from 'hono';
import {
  GetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { myDictionaries } from '../dynamodb';
import type { Env } from '../types';
import type { ChatMessage } from '../validation';

const app = new Hono<{ Bindings: Env }>();

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// CORS middleware
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (c.req.method === 'OPTIONS') {
    return c.text('', 200);
  }
  await next();
});

// Helper to validate token and extract user ID from Cognito
async function getUserIdFromToken(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  try {
    const accessToken = authHeader.substring(7);

    // IMPORTANT: Validate token with Cognito to verify signature and prevent forgery
    const getUserCommand = new GetUserCommand({
      AccessToken: accessToken,
    });

    const userResponse = await cognitoClient.send(getUserCommand);

    // IMPORTANT: Return email to match existing saved_sentences table data
    // The saved_sentences table was created with email as the user_id partition key
    // (unlike chat_history which uses Cognito sub)
    const email = userResponse.UserAttributes?.find((attr) => attr.Name === 'email')?.Value;

    return email || null;
  } catch (error) {
    console.error('Token validation error:', error);
    return null;
  }
}

// Save a sentence
app.post('/', async (c) => {
  try {
    const userId = await getUserIdFromToken(c.req.header('Authorization'));

    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { sentence, sourceUrl, context } = body;

    if (!sentence || typeof sentence !== 'string' || sentence.trim().length === 0) {
      return c.json({ error: 'Sentence is required' }, 400);
    }

    const result = await myDictionaries.create(userId, sentence.trim(), sourceUrl, context);

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
    const userId = await getUserIdFromToken(c.req.header('Authorization'));

    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const limit = parseInt(c.req.query('limit') || '50', 10);

    const sentences = await myDictionaries.getByUser(userId, limit);

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
    const userId = await getUserIdFromToken(c.req.header('Authorization'));

    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sentenceId = c.req.param('sentenceId');

    if (!sentenceId) {
      return c.json({ error: 'Sentence ID is required' }, 400);
    }

    await myDictionaries.delete(userId, sentenceId);

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
    const userId = await getUserIdFromToken(c.req.header('Authorization'));

    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { sentence, provider, model, apiKey } = body;

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
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${llmModel}:streamGenerateContent?alt=sse&key=${key}`;

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const txt = await res.text();
        return c.json({ error: `Google API error ${res.status}: ${txt}` }, 500);
      }

      // Set up SSE streaming
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');

      const stream = new ReadableStream({
        async start(controller) {
          try {
            const reader = res.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) {
              controller.close();
              return;
            }

            // Send initial metadata
            const metadata = JSON.stringify({
              type: 'metadata',
              provider,
              model: llmModel,
              sentence: sentence.trim(),
            });
            controller.enqueue(`data: ${metadata}\n\n`);

            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const jsonStr = line.slice(6);
                  if (jsonStr.trim() === '') continue;

                  try {
                    const data = JSON.parse(jsonStr);
                    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                      const payload = JSON.stringify({ type: 'chunk', text });
                      controller.enqueue(`data: ${payload}\n\n`);
                    }
                  } catch (e) {
                    // Skip invalid JSON
                  }
                }
              }
            }

            // Send completion signal
            controller.enqueue(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            controller.close();
          } catch (error) {
            const errorPayload = JSON.stringify({
              type: 'error',
              error: String(error),
            });
            controller.enqueue(`data: ${errorPayload}\n\n`);
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
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

      // Set up SSE streaming
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');

      const stream = new ReadableStream({
        async start(controller) {
          try {
            const reader = res.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) {
              controller.close();
              return;
            }

            // Send initial metadata
            const metadata = JSON.stringify({
              type: 'metadata',
              provider,
              model: llmModel,
              sentence: sentence.trim(),
            });
            controller.enqueue(`data: ${metadata}\n\n`);

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
                  if (jsonStr === '' || jsonStr === '[DONE]') continue;

                  try {
                    const data = JSON.parse(jsonStr);
                    const text = data?.choices?.[0]?.delta?.content;
                    if (text) {
                      const payload = JSON.stringify({ type: 'chunk', text });
                      controller.enqueue(`data: ${payload}\n\n`);
                    }
                  } catch (e) {
                    // Skip invalid JSON
                  }
                }
              }
            }

            // Send completion signal
            controller.enqueue(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            controller.close();
          } catch (error) {
            const errorPayload = JSON.stringify({
              type: 'error',
              error: String(error),
            });
            controller.enqueue(`data: ${errorPayload}\n\n`);
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
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
