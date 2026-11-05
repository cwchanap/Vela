import { describe, expect, test } from 'bun:test';
import { normalizeLlmRequest } from './normalize';

// Mirrors GREETING_MESSAGE in apps/vela/src/pages/chat/AIChatPage.vue — the
// decorative assistant turn the web chat prepends to every new thread. It is
// not real model output and must be stripped before providers see the history.
const GREETING_MESSAGE =
  'こんにちは！日本語学習をお手伝いします。What would you like to practice today?';

type NormalizeResult = ReturnType<typeof normalizeLlmRequest>;

function expectOk(result: NormalizeResult) {
  if (!result.ok) {
    throw new Error(`expected ok, got 400: ${result.error}`);
  }
  return result.value;
}

describe('normalizeLlmRequest — history mapping', () => {
  test('maps a normal user-assistant-user history through in order', () => {
    const value = expectOk(
      normalizeLlmRequest({
        provider: 'google',
        model: 'gemini-3.8-flash',
        messages: [
          { role: 'user', content: 'こんにちは' },
          { role: 'assistant', content: 'こんにちは！何をお手伝いしましょうか？' },
          { role: 'user', content: '「猫」を説明して' },
        ],
      }),
    );

    expect(value.messages).toEqual([
      { role: 'user', content: 'こんにちは' },
      { role: 'assistant', content: 'こんにちは！何をお手伝いしましょうか？' },
      { role: 'user', content: '「猫」を説明して' },
    ]);
    expect(value.system).toBeNull();
  });

  test('strips leading assistant turns including the fake greeting', () => {
    const value = expectOk(
      normalizeLlmRequest({
        provider: 'google',
        messages: [
          { role: 'assistant', content: GREETING_MESSAGE },
          { role: 'user', content: '元気ですか？' },
          { role: 'assistant', content: 'はい、元気です！' },
        ],
      }),
    );

    // Only the leading non-user turn is dropped; later assistant turns stay.
    expect(value.messages).toEqual([
      { role: 'user', content: '元気ですか？' },
      { role: 'assistant', content: 'はい、元気です！' },
    ]);
  });

  test('rejects a history that has no user turn after normalization', () => {
    const result = normalizeLlmRequest({
      provider: 'google',
      messages: [{ role: 'assistant', content: GREETING_MESSAGE }],
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'No user message found after normalization',
    });
  });

  test('prefers messages over prompt when both are provided', () => {
    const value = expectOk(
      normalizeLlmRequest({
        provider: 'openrouter',
        messages: [{ role: 'user', content: 'from messages' }],
        prompt: 'from prompt',
      }),
    );

    expect(value.messages).toEqual([{ role: 'user', content: 'from messages' }]);
  });
});

describe('normalizeLlmRequest — system instructions', () => {
  test('combines the system field and system-role messages into one instruction', () => {
    const value = expectOk(
      normalizeLlmRequest({
        provider: 'openai',
        model: 'gpt-5.6-luna',
        system: 'You are a Japanese tutor.',
        messages: [
          { role: 'system', content: 'Always answer in Japanese.' },
          { role: 'user', content: 'こんにちは' },
          { role: 'system', content: 'Keep answers short.' },
          { role: 'assistant', content: 'こんにちは！' },
          { role: 'user', content: 'ありがとう' },
        ],
      }),
    );

    // Deterministic order: request system field first, then history order,
    // joined once — and no system role survives inside the mapped history.
    expect(value.system).toBe(
      'You are a Japanese tutor.\n\nAlways answer in Japanese.\n\nKeep answers short.',
    );
    expect(value.messages).toEqual([
      { role: 'user', content: 'こんにちは' },
      { role: 'assistant', content: 'こんにちは！' },
      { role: 'user', content: 'ありがとう' },
    ]);
  });

  test('keeps system null when no system instruction is supplied', () => {
    const value = expectOk(
      normalizeLlmRequest({ provider: 'anthropic', model: 'claude-haiku-5-5', prompt: 'hi' }),
    );

    expect(value.system).toBeNull();
  });
});

describe('normalizeLlmRequest — prompt handling', () => {
  test('maps a bare prompt to a single user message', () => {
    const value = expectOk(
      normalizeLlmRequest({
        provider: 'google',
        system: '  Translate to English.  ',
        prompt: '猫が座っています',
      }),
    );

    expect(value.messages).toEqual([{ role: 'user', content: '猫が座っています' }]);
    expect(value.system).toBe('Translate to English.');
  });

  test('rejects a request with no prompt and no messages', () => {
    expect(normalizeLlmRequest({ provider: 'google' })).toEqual({
      ok: false,
      status: 400,
      error: 'Missing prompt or messages',
    });
  });

  test('rejects a request whose prompt is only whitespace', () => {
    expect(normalizeLlmRequest({ provider: 'google', prompt: '   ' })).toEqual({
      ok: false,
      status: 400,
      error: 'Missing prompt or messages',
    });
  });
});

describe('normalizeLlmRequest — model validation', () => {
  test('rejects a model from a different provider with the model ID in the error', () => {
    const result = normalizeLlmRequest({
      provider: 'google',
      model: 'gpt-5.6-sol',
      prompt: 'hi',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('gpt-5.6-sol');
      expect(result.error).toContain('gemini-3.8-flash');
    }
  });

  test('rejects a stale model ID with an actionable error', () => {
    const result = normalizeLlmRequest({
      provider: 'google',
      model: 'gemini-2.5-flash-lite',
      prompt: 'hi',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('gemini-2.5-flash-lite');
      expect(result.error).toContain('gemini-4-argon');
    }
  });

  test('uses the registry default model when model is absent', () => {
    const value = expectOk(normalizeLlmRequest({ provider: 'google', prompt: 'hi' }));
    expect(value.model).toBe('gemini-3.8-flash');

    const openai = expectOk(normalizeLlmRequest({ provider: 'openai', prompt: 'hi' }));
    expect(openai.model).toBe('gpt-6.1-sol');
  });

  test('accepts any free-form OpenRouter model ID', () => {
    const value = expectOk(
      normalizeLlmRequest({
        provider: 'openrouter',
        model: 'meta-llama/llama-4-maverick:free',
        prompt: 'hi',
      }),
    );
    expect(value.model).toBe('meta-llama/llama-4-maverick:free');

    const fallback = expectOk(normalizeLlmRequest({ provider: 'openrouter', prompt: 'hi' }));
    expect(fallback.model).toBe('openai/gpt-oss-20b:free');
  });
});

describe('normalizeLlmRequest — thinking/effort resolution', () => {
  test('applies the registry default when thinking is absent', () => {
    const google = expectOk(
      normalizeLlmRequest({ provider: 'google', model: 'gemini-4-argon', prompt: 'hi' }),
    );
    expect(google.effort).toBe('medium');

    const sonnet = expectOk(
      normalizeLlmRequest({ provider: 'anthropic', model: 'claude-sonnet-5-5', prompt: 'hi' }),
    );
    expect(sonnet.effort).toBe('high');

    const openai = expectOk(
      normalizeLlmRequest({ provider: 'openai', model: 'gpt-6.1-sol', prompt: 'hi' }),
    );
    expect(openai.effort).toBe('medium');
  });

  test('keeps an explicitly supported effort', () => {
    const value = expectOk(
      normalizeLlmRequest({
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        thinking: 'xhigh',
        prompt: 'hi',
      }),
    );
    expect(value.effort).toBe('xhigh');
  });

  test('rejects an unsupported effort with the model ID in the error', () => {
    const google = normalizeLlmRequest({
      provider: 'google',
      model: 'gemini-3.8-flash',
      thinking: 'max',
      prompt: 'hi',
    });
    expect(google.ok).toBe(false);
    if (!google.ok) {
      expect(google.status).toBe(400);
      expect(google.error).toContain('gemini-3.8-flash');
      expect(google.error).toContain('max');
    }

    const solWithoutNone = normalizeLlmRequest({
      provider: 'openai',
      model: 'gpt-6.1-sol',
      thinking: 'none',
      prompt: 'hi',
    });
    expect(solWithoutNone.ok).toBe(false);
    if (!solWithoutNone.ok) {
      expect(solWithoutNone.error).toContain('gpt-6.1-sol');
      expect(solWithoutNone.error).toContain('none');
    }

    const anthropicWithoutNone = normalizeLlmRequest({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      thinking: 'none',
      prompt: 'hi',
    });
    expect(anthropicWithoutNone.ok).toBe(false);
    if (!anthropicWithoutNone.ok) {
      expect(anthropicWithoutNone.error).toContain('claude-sonnet-5-5');
    }
  });

  test('OpenRouter has no native effort — thinking is ignored, not invented', () => {
    const value = expectOk(
      normalizeLlmRequest({ provider: 'openrouter', thinking: 'high', prompt: 'hi' }),
    );
    expect(value.effort).toBeNull();
  });
});

describe('normalizeLlmRequest — provider validation', () => {
  test('rejects an unsupported provider', () => {
    const result = normalizeLlmRequest({ provider: 'chutes', prompt: 'hi' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('chutes');
      expect(result.error).toContain('openrouter');
    }
  });
});
