import { describe, expect, it } from 'vitest';
import {
  LLM_PROVIDER_REGISTRY,
  LLM_PROVIDERS,
  type LlmEvent,
  type LlmMessage,
  type LlmProvider,
  type LlmResponse,
  type LlmUsage,
} from './llm';

describe('LLM_PROVIDERS', () => {
  it('is the closed provider tuple', () => {
    expect([...LLM_PROVIDERS]).toEqual(['google', 'openai', 'anthropic', 'openrouter']);
  });

  it('derives the LlmProvider type from the tuple', () => {
    const providers: readonly LlmProvider[] = LLM_PROVIDERS;
    expect(providers).toHaveLength(4);
  });
});

describe('LLM_PROVIDER_REGISTRY', () => {
  it('has exactly one entry per provider', () => {
    expect(Object.keys(LLM_PROVIDER_REGISTRY)).toEqual([...LLM_PROVIDERS]);
  });

  describe('google', () => {
    const google = LLM_PROVIDER_REGISTRY.google;

    it('supports exactly the two current Gemini models', () => {
      expect(google.models?.map((m) => m.id)).toEqual(['gemini-3.8-flash', 'gemini-4-argon']);
    });

    it('defaults to gemini-3.8-flash', () => {
      expect(google.defaultModel).toBe('gemini-3.8-flash');
    });

    it('has no server-side cache TTL', () => {
      expect(google.cacheTtlSeconds).toBeNull();
    });

    it('supports low/medium/high thinking with medium default on both models', () => {
      for (const model of google.models ?? []) {
        expect([...model.efforts]).toEqual(['low', 'medium', 'high']);
        expect(model.defaultEffort).toBe('medium');
      }
    });
  });

  describe('openai', () => {
    const openai = LLM_PROVIDER_REGISTRY.openai;

    it('supports exactly the seven current models', () => {
      expect(openai.models?.map((m) => m.id)).toEqual([
        'gpt-6.1-sol',
        'gpt-6.1-terra',
        'gpt-6-luna',
        'gpt-6-astra',
        'gpt-5.6-sol',
        'gpt-5.6-terra',
        'gpt-5.6-luna',
      ]);
    });

    it('defaults to gpt-6.1-sol with a 1800s cache TTL', () => {
      expect(openai.defaultModel).toBe('gpt-6.1-sol');
      expect(openai.cacheTtlSeconds).toBe(1800);
    });

    it.each([
      ['gpt-6.1-sol', ['low', 'medium', 'high', 'xhigh', 'max']],
      ['gpt-6.1-terra', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
      ['gpt-6-luna', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
      ['gpt-6-astra', ['low', 'medium', 'high', 'xhigh', 'max']],
      ['gpt-5.6-sol', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
      ['gpt-5.6-terra', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
      ['gpt-5.6-luna', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
    ] as const)(
      '%s supports the verified native effort list defaulting to medium',
      (id, efforts) => {
        const model = openai.models?.find((m) => m.id === id);
        expect(model && [...model.efforts]).toEqual([...efforts]);
        expect(model?.defaultEffort).toBe('medium');
      },
    );
  });

  describe('anthropic', () => {
    const anthropic = LLM_PROVIDER_REGISTRY.anthropic;

    it('supports exactly the three current Claude models', () => {
      expect(anthropic.models?.map((m) => m.id)).toEqual([
        'claude-opus-5-5',
        'claude-sonnet-5-5',
        'claude-haiku-5-5',
      ]);
    });

    it('defaults to claude-opus-5-5 with a 300s cache TTL', () => {
      expect(anthropic.defaultModel).toBe('claude-opus-5-5');
      expect(anthropic.cacheTtlSeconds).toBe(300);
    });

    it.each([
      ['claude-opus-5-5', 'medium'],
      ['claude-sonnet-5-5', 'high'],
      ['claude-haiku-5-5', 'medium'],
    ] as const)('%s supports all five effort levels with %s default', (id, defaultEffort) => {
      const model = anthropic.models?.find((m) => m.id === id);
      expect(model && [...model.efforts]).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
      expect(model?.defaultEffort).toBe(defaultEffort);
    });
  });

  describe('openrouter', () => {
    it('accepts free-form model IDs and keeps the existing initial default', () => {
      const openrouter = LLM_PROVIDER_REGISTRY.openrouter;
      expect(openrouter.models).toBeNull();
      expect(openrouter.defaultModel).toBe('openai/gpt-oss-20b:free');
      expect(openrouter.cacheTtlSeconds).toBeNull();
    });
  });
});

describe('shared LLM contract types', () => {
  it('shape messages, usage, events, and responses', () => {
    const message: LlmMessage = { role: 'system', content: 'Be helpful' };
    const usage: LlmUsage = {
      inputTokens: 12,
      outputTokens: 5,
      cachedInputTokens: 4,
      cacheWriteTokens: 3,
    };
    const events: LlmEvent[] = [
      { type: 'text', text: 'こんにちは' },
      { type: 'usage', usage },
      { type: 'error', message: 'upstream failed' },
    ];
    const response: LlmResponse = { text: 'こんにちは', usage };

    expect(message.role).toBe('system');
    expect(events.map((e) => e.type)).toEqual(['text', 'usage', 'error']);
    expect(response.usage.inputTokens).toBe(12);
  });
});
