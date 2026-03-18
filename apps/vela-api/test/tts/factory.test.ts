import { describe, test, expect } from 'bun:test';
import { createTTSProvider } from '../../src/tts/factory';
import { ElevenLabsProvider } from '../../src/tts/providers/elevenlabs';
import { OpenAIProvider } from '../../src/tts/providers/openai';
import { GeminiProvider } from '../../src/tts/providers/gemini';

describe('createTTSProvider', () => {
  test('creates ElevenLabsProvider for elevenlabs', () => {
    const provider = createTTSProvider('elevenlabs');
    expect(provider).toBeInstanceOf(ElevenLabsProvider);
    expect(provider.name).toBe('elevenlabs');
  });

  test('creates OpenAIProvider for openai', () => {
    const provider = createTTSProvider('openai');
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.name).toBe('openai');
  });

  test('creates GeminiProvider for gemini', () => {
    const provider = createTTSProvider('gemini');
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.name).toBe('gemini');
  });
});
