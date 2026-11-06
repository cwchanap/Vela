import { Hono } from 'hono';
import { LLM_PROVIDER_REGISTRY, type LlmEvent, type LlmProvider } from '@vela/common/contracts/llm';
import { myDictionaries } from '../dynamodb';
import type { Env } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { isAllowedOrigin } from '../middleware/cors';
import { createLlmProvider } from '../llm/factory';
import { normalizeLlmRequest } from '../llm/normalize';
import { DICTIONARY_MAX_TOKENS } from '../llm/types';
import { AnalyzeSentenceRequestSchema } from '../validation';

const app = new Hono<{ Bindings: Env } & AuthContext>();

// Track whether CORS configuration warning has been logged (to log only once)
let corsConfigWarningLogged = false;

// Apply auth middleware to all routes in this router.
app.use('*', requireAuth);

// Japanese sentence analysis prompt — unchanged from the previous route.
const ANALYSIS_SYSTEM_PROMPT = `You are a Japanese language expert. Analyze the provided Japanese sentence and provide:
1. English translation
2. Grammar breakdown (key grammar points)
3. Vocabulary notes (important words with readings)
4. Usage context (when/how to use this sentence)

Keep it concise and educational.`;

/** Outgoing SSE frames; this is the existing browser dictionary contract. */
type AnalysisSseFrame =
  | { type: 'metadata'; provider: LlmProvider; model: string; sentence: string }
  | { type: 'chunk'; text: string }
  | { type: 'error'; error: string }
  | { type: 'done' };

function analysisFrame(frame: AnalysisSseFrame): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`);
}

/** SSE response headers with the already-validated CORS origin attached. */
function analysisSseHeaders(
  originCheck: ReturnType<typeof isAllowedOrigin>,
): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...(originCheck.allowedOrigin
      ? { 'Access-Control-Allow-Origin': originCheck.allowedOrigin }
      : {}),
    ...(originCheck.allowedOrigin && originCheck.isWebOrigin
      ? { 'Access-Control-Allow-Credentials': 'true' }
      : {}),
  };
}

/**
 * Serialize the shared adapter stream into the existing dictionary SSE
 * contract: text → chunk, error → error frame then stop, `done` only when the
 * provider stream finishes cleanly. Adapters convert refusal, SAFETY/
 * MAX_TOKENS, malformed upstream data and missing-terminal failures into
 * error events, so clean exhaustion is exactly a successful terminal.
 *
 * Deployed buffering: API Gateway and CloudFront buffer this response (the
 * current stack has no response streaming), so browsers receive all frames at
 * once in production; only local Bun delivers them progressively. Do not
 * claim browser progress until response streaming is delivered separately.
 *
 * Exported for the real-Node Lambda adapter regression test; the deployed
 * Node 20 runtime requires byte chunks here (string chunks throw
 * "Received non-Uint8Array chunk" inside the adapter's `res.text()`).
 */
export function createAnalysisSseStream(
  upstream: AsyncIterable<LlmEvent>,
  metadata: { provider: LlmProvider; model: string; sentence: string },
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(analysisFrame({ type: 'metadata', ...metadata }));
      try {
        for await (const event of upstream) {
          if (event.type === 'text') {
            controller.enqueue(analysisFrame({ type: 'chunk', text: event.text }));
          } else if (event.type === 'error') {
            // Adapter messages are sanitized to provider + status/code only.
            controller.enqueue(analysisFrame({ type: 'error', error: event.message }));
            controller.close();
            return;
          }
          // usage events carry no frame in the existing browser contract
        }
        controller.enqueue(analysisFrame({ type: 'done' }));
        controller.close();
      } catch {
        controller.enqueue(analysisFrame({ type: 'error', error: 'Analysis failed' }));
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
    const { sentence, sourceUrl, context, idempotencyKey, timestamp: clientTimestamp } = body;

    if (!sentence || typeof sentence !== 'string' || sentence.trim().length === 0) {
      return c.json({ error: 'Sentence is required' }, 400);
    }

    const result = await myDictionaries.create(
      dictionaryUserId,
      sentence.trim(),
      sourceUrl,
      context,
      typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
      typeof clientTimestamp === 'number' ? clientTimestamp : undefined,
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

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }
    // JSON can parse to non-objects (null, numbers, strings); destructuring
    // those used to throw a 500. Malformed shapes are local validation 4xx.
    if (typeof body !== 'object' || body === null) {
      return c.json({ error: 'Invalid request body' }, 400);
    }
    const requestOrigin = c.req.header('Origin');

    // Use shared utility to check if origin is allowed (includes both web and extension origins)
    const originCheck = isAllowedOrigin(requestOrigin, c.env);

    // Warn if no CORS configuration is present (neither web origins nor extension IDs)
    // Only log the warning once to avoid spamming logs on every request
    if (!corsConfigWarningLogged && !originCheck.hasConfiguredOrigins) {
      console.warn(
        'Warning: No CORS configuration found (CORS_ALLOWED_ORIGINS and CORS_ALLOWED_EXTENSION_IDS are both empty). ' +
          'SSE CORS validation is disabled. Please set at least one of these environment variables.',
      );
      corsConfigWarningLogged = true;
    }

    // Validate CORS origin: only reject when CORS is configured and origin is not allowed
    if (originCheck.hasConfiguredOrigins && requestOrigin && !originCheck.isAllowed) {
      console.warn(
        `CORS rejection: Origin '${requestOrigin}' is not allowed. ` +
          `originCheck.isAllowed: ${originCheck.isAllowed}.`,
      );
      return c.json({ error: 'Origin not allowed' }, 403);
    }

    const parsed = AnalyzeSentenceRequestSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return c.json({ error: issue?.message ?? 'Invalid request' }, 400);
    }
    const { sentence, provider, model, apiKey } = parsed.data;

    // Same shared normalizer as chat: registry provider/model validation and a
    // single system + user turn. The analysis prompt itself is unchanged.
    const normalized = normalizeLlmRequest({
      provider,
      model,
      system: ANALYSIS_SYSTEM_PROMPT,
      prompt: `Analyze this Japanese sentence: "${sentence}"`,
    });
    if (!normalized.ok) {
      return c.json({ error: normalized.error }, 400);
    }
    const {
      provider: llmProvider,
      model: llmModel,
      modelInfo,
      effort: defaultEffort,
      system,
      messages,
    } = normalized.value;

    // Dictionary analysis keeps its stricter credential policy: a user key is
    // required on every provider; there is no server-key fallback (unlike chat).
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      return c.json(
        { error: `Missing API key for ${LLM_PROVIDER_REGISTRY[llmProvider].label} provider` },
        400,
      );
    }

    // Analysis deliberately runs at low native effort where the model supports
    // it; the browser never sends `thinking` for dictionary analysis.
    const effort = modelInfo?.efforts.includes('low') ? ('low' as const) : defaultEffort;

    // Shared adapter stream, lazy: the first read performs the upstream call,
    // so initial provider 401/429/5xx failures surface inside the SSE body as
    // error frames rather than a pre-stream JSON status.
    const upstream = createLlmProvider(llmProvider).stream({
      model: llmModel,
      effort,
      system,
      messages,
      apiKey,
      // Fixed dictionary budget; callers cannot raise it.
      maxTokens: DICTIONARY_MAX_TOKENS,
      signal: c.req.raw.signal,
      referer: c.req.url,
      appName: c.env.APP_NAME,
    });

    return new Response(
      createAnalysisSseStream(upstream, {
        provider: llmProvider,
        model: llmModel,
        sentence,
      }),
      { headers: analysisSseHeaders(originCheck) },
    );
  } catch (error: any) {
    console.error('Error analyzing sentence:', error);
    return c.json({ error: 'Failed to analyze sentence' }, 500);
  }
});

export default app;
