import type { TTSProvider, TTSProviderName } from './types';
import { ElevenLabsProvider } from './providers/elevenlabs';
import { OpenAIProvider } from './providers/openai';
import { GeminiProvider } from './providers/gemini';

export function createTTSProvider(name: TTSProviderName): TTSProvider {
  switch (name) {
    case 'elevenlabs':
      return new ElevenLabsProvider();
    case 'openai':
      return new OpenAIProvider();
    case 'gemini':
      return new GeminiProvider();
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown TTS provider: ${_exhaustive}`);
    }
  }
}
