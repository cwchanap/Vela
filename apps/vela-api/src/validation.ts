import { z } from 'zod';
import { LLM_PROVIDERS } from '@vela/common/contracts/llm';

// Chat History Schemas
export const ChatThreadModelSchema = z.object({
  provider: z.enum(LLM_PROVIDERS),
  model: z.string().min(1, 'model is required'),
});

// model is consumed only for a user turn and lastLlmAt only for an assistant
// turn; the save route ignores the other pairing and messageItem never copies
// metadata fields into message rows.
export const ChatHistoryItemSchema = z.object({
  ThreadId: z.string().min(1, 'ThreadId is required'),
  Timestamp: z.number().int().positive('Timestamp must be a positive integer'),
  UserId: z.string().min(1, 'UserId is required'),
  message: z.string().min(1, 'Message is required'),
  is_user: z.boolean(),
  model: ChatThreadModelSchema.optional(),
  lastLlmAt: z.number().int().positive('lastLlmAt must be a positive integer').optional(),
  requestStartedAt: z
    .number()
    .int()
    .positive('requestStartedAt must be a positive integer')
    .optional(),
});

export const ChatThreadSummarySchema = z.object({
  ThreadId: z.string().min(1, 'ThreadId is required'),
  title: z.string().min(1, 'Title is required').max(60, 'Title must be 60 characters or fewer'),
  createdAt: z.number().int().positive('createdAt must be a positive integer'),
  updatedAt: z.number().int().positive('updatedAt must be a positive integer'),
  model: ChatThreadModelSchema.optional(),
  lastLlmAt: z.number().int().positive().optional(),
});

export const PatchChatThreadSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'title is required')
      .max(60, 'title must be 60 characters or fewer')
      .optional(),
    model: ChatThreadModelSchema.optional(),
  })
  .refine((data) => data.title !== undefined || data.model !== undefined, {
    message: 'At least one of title or model is required',
  });

// Chat Message Schema for LLM requests
export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1, 'Content is required'),
});

// LLM Bridge Request Schema
export const LLMBridgeRequestSchema = z
  .object({
    provider: z.enum(LLM_PROVIDERS),
    model: z.string().optional(),
    messages: z.array(ChatMessageSchema).optional(),
    prompt: z.string().optional(),
    system: z.string().optional(),
    /** Native effort/thinking level; validated against the model registry by the normalizer. */
    thinking: z.string().optional(),
    maxTokens: z.number().int().positive().optional(),
    appName: z.string().optional(),
    referer: z.string().optional(),
    apiKey: z.string().min(1).optional(),
  })
  .refine((data) => (data.messages?.length ?? 0) > 0 || (data.prompt?.length ?? 0) > 0, {
    message: 'Either a nonempty prompt or messages must be provided',
    path: ['messages'],
  });

// Dictionary Analyze Request Schema — field validation for the SSE route; the
// route still applies its own credential policy afterward. Enum/string error
// params preserve the exact messages the hand-rolled checks returned.
export const AnalyzeSentenceRequestSchema = z.object({
  sentence: z.string('Sentence is required').trim().min(1, 'Sentence is required'),
  provider: z.enum(LLM_PROVIDERS, {
    error: (issue) =>
      typeof issue.input === 'string'
        ? `Unsupported provider '${issue.input}'. Supported providers: ${LLM_PROVIDERS.join(', ')}.`
        : 'LLM provider is required',
  }),
  model: z.string('Invalid model').optional(),
  apiKey: z.string('Invalid API key').optional(),
  thinking: z.string('Invalid thinking').optional(),
});

// Shared JLPT field definition with validation
export const jlptField = z
  .string()
  .optional()
  .transform((val, ctx) => {
    if (!val) return undefined;
    const levels = val.split(',').map((level) => level.trim());
    const parsedLevels: number[] = [];
    const invalidLevels: string[] = [];
    for (const level of levels) {
      if (!level) continue;
      // Strict check: ensure level is a pure integer string before parsing
      if (!/^\d+$/.test(level)) {
        invalidLevels.push(level);
        continue;
      }
      const parsed = parseInt(level, 10);
      if (parsed < 1 || parsed > 5) {
        invalidLevels.push(level);
      } else {
        parsedLevels.push(parsed);
      }
    }
    if (invalidLevels.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: `Invalid JLPT level(s): ${invalidLevels.join(', ')}. Must be integers between 1 and 5.`,
      });
      return z.NEVER;
    }
    const uniqueLevels = [...new Set(parsedLevels)];
    return uniqueLevels.length > 0 ? uniqueLevels : undefined;
  });

// Query Parameter Schemas
export const UserIdQuerySchema = z.object({
  user_id: z.string().min(1, 'user_id is required'),
});

export const ThreadIdQuerySchema = z.object({
  thread_id: z.string().min(1, 'thread_id is required'),
});

// Type exports for use in handlers
export type ChatHistoryItem = z.infer<typeof ChatHistoryItemSchema>;
export type ChatThreadModel = z.infer<typeof ChatThreadModelSchema>;
export type ChatThreadSummary = z.infer<typeof ChatThreadSummarySchema>;
export type PatchChatThread = z.infer<typeof PatchChatThreadSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type LLMBridgeRequest = z.infer<typeof LLMBridgeRequestSchema>;
export type UserIdQuery = z.infer<typeof UserIdQuerySchema>;
export type ThreadIdQuery = z.infer<typeof ThreadIdQuerySchema>;
