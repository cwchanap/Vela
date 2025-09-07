import { z } from 'zod';

// Chat History Schemas
export const ChatHistoryItemSchema = z.object({
  ThreadId: z.string().min(1, 'ThreadId is required'),
  Timestamp: z.number().int().positive('Timestamp must be a positive integer'),
  UserId: z.string().min(1, 'UserId is required'),
  message: z.string().min(1, 'Message is required'),
  is_user: z.boolean(),
});

export const ChatThreadSummarySchema = z.object({
  ThreadId: z.string().min(1, 'ThreadId is required'),
  lastTimestamp: z.number().int().positive('lastTimestamp must be a positive integer'),
  title: z.string().min(1, 'Title is required'),
  messageCount: z.number().int().min(0, 'messageCount must be non-negative'),
});

// Chat Message Schema for LLM requests
export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1, 'Content is required'),
});

// LLM Bridge Request Schema
export const LLMBridgeRequestSchema = z
  .object({
    provider: z.enum(['google', 'openrouter']),
    model: z.string().optional(),
    messages: z.array(ChatMessageSchema).optional(),
    prompt: z.string().optional(),
    system: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    appName: z.string().optional(),
    referer: z.string().optional(),
  })
  .refine((data) => data.messages || data.prompt, {
    message: 'Either messages or prompt must be provided',
    path: ['messages'],
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
export type ChatThreadSummary = z.infer<typeof ChatThreadSummarySchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type LLMBridgeRequest = z.infer<typeof LLMBridgeRequestSchema>;
