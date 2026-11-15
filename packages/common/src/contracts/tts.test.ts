import { describe, expect, it } from 'vitest';
import {
  parseGeneratePronunciationRequest,
  parseGeneratePronunciationResponse,
  parseTtsApiErrorResponse,
  parseTtsAudioUrlResponse,
  parseTtsSettings,
  resolveTtsSelection,
  TTS_PROVIDER_REGISTRY,
  TTS_PROVIDERS,
} from './tts';

const HTTPS_AUDIO = 'https://audio.example.test/mizu.mp3';

const ELEVENLABS_DEFAULT_VOICE = 'ErXwobaYiN019PkySvjV';

describe('TTS provider registry', () => {
  it('lists the supported providers', () => {
    expect(TTS_PROVIDERS).toEqual(['elevenlabs', 'openai', 'gemini']);
  });

  it('has a registry entry for every provider', () => {
    expect(Object.keys(TTS_PROVIDER_REGISTRY).sort()).toEqual([...TTS_PROVIDERS].sort());
  });

  it('publishes every default as a selectable model and voice', () => {
    for (const provider of TTS_PROVIDERS) {
      const info = TTS_PROVIDER_REGISTRY[provider];
      expect(info.models.map((model) => model.id)).toContain(info.defaultModel);
      if (info.voices) expect(info.voices).toContain(info.defaultVoice);
    }
  });

  it('keeps ElevenLabs on eleven_v4 with multilingual v2 selectable', () => {
    const info = TTS_PROVIDER_REGISTRY.elevenlabs;
    expect(info.defaultModel).toBe('eleven_v4');
    expect(info.models.map((model) => model.id)).toEqual(['eleven_v4', 'eleven_multilingual_v2']);
    expect(info.defaultVoice).toBe(ELEVENLABS_DEFAULT_VOICE);
    expect(info.voices).toBeNull();
  });

  it('lists the ten OpenAI Realtime voices and no Speech API models', () => {
    const info = TTS_PROVIDER_REGISTRY.openai;
    expect(info.defaultModel).toBe('gpt-realtime-2.1-mini');
    expect(info.models.map((model) => model.id)).toEqual(['gpt-realtime-2.1-mini']);
    expect(info.defaultVoice).toBe('alloy');
    expect(info.voices).toEqual([
      'alloy',
      'ash',
      'ballad',
      'coral',
      'echo',
      'sage',
      'shimmer',
      'verse',
      'marin',
      'cedar',
    ]);
  });

  it('copies the official 30 Gemini voices without Iocaste', () => {
    const info = TTS_PROVIDER_REGISTRY.gemini;
    expect(info.defaultModel).toBe('gemini-3.8-flash-tts');
    expect(info.models.map((model) => model.id)).toEqual([
      'gemini-3.8-flash-tts',
      'gemini-3.8-flash-lite-tts',
    ]);
    expect(info.defaultVoice).toBe('Kore');
    expect(info.voices).toHaveLength(30);
    expect(info.voices).toContain('Iapetus');
    expect(info.voices).not.toContain('Iocaste');
  });
});

describe('resolveTtsSelection', () => {
  it.each([
    ['elevenlabs', ELEVENLABS_DEFAULT_VOICE, 'eleven_v4'],
    ['openai', 'alloy', 'gpt-realtime-2.1-mini'],
    ['gemini', 'Kore', 'gemini-3.8-flash-tts'],
  ] as const)(
    'resolves null stored settings for %s to its defaults',
    (provider, voiceId, model) => {
      expect(resolveTtsSelection(provider, null, null)).toEqual({ provider, voiceId, model });
    },
  );

  it('keeps supported stored models and voices', () => {
    expect(resolveTtsSelection('gemini', 'gemini-3.8-flash-lite-tts', 'Puck')).toEqual({
      provider: 'gemini',
      voiceId: 'Puck',
      model: 'gemini-3.8-flash-lite-tts',
    });
    expect(resolveTtsSelection('elevenlabs', 'eleven_multilingual_v2', 'custom-voice')).toEqual({
      provider: 'elevenlabs',
      voiceId: 'custom-voice',
      model: 'eleven_multilingual_v2',
    });
  });

  it.each([
    ['elevenlabs', 'eleven_turbo_v2', ELEVENLABS_DEFAULT_VOICE, 'eleven_v4'],
    ['openai', 'tts-1', 'alloy', 'gpt-realtime-2.1-mini'],
    ['gemini', 'gemini-2.5-flash-preview-tts', 'Kore', 'gemini-3.8-flash-tts'],
  ] as const)(
    'resolves a legacy %s model and voice to current defaults',
    (provider, legacyModel, voiceId, model) => {
      expect(resolveTtsSelection(provider, legacyModel, voiceId)).toEqual({
        provider,
        voiceId,
        model,
      });
    },
  );

  it.each([
    ['openai', 'nova', 'alloy'],
    ['openai', 'fable', 'alloy'],
    ['gemini', 'Iocaste', 'Kore'],
  ] as const)(
    'replaces the retired %s voice %s with its default',
    (provider, voiceId, fallback) => {
      expect(
        resolveTtsSelection(provider, TTS_PROVIDER_REGISTRY[provider].defaultModel, voiceId),
      ).toMatchObject({ voiceId: fallback });
    },
  );

  it('keeps an optional custom ElevenLabs voice and trims stored values', () => {
    expect(resolveTtsSelection('elevenlabs', ' eleven_v4 ', ' 21m00Tcm4TlvDq8ikWAM ')).toEqual({
      provider: 'elevenlabs',
      voiceId: '21m00Tcm4TlvDq8ikWAM',
      model: 'eleven_v4',
    });
  });

  it('falls back for blank stored voice and model', () => {
    expect(resolveTtsSelection('gemini', '', '  ')).toEqual({
      provider: 'gemini',
      voiceId: 'Kore',
      model: 'gemini-3.8-flash-tts',
    });
  });
});

describe('TTS contracts', () => {
  it('parses valid settings and ignores unknown fields', () => {
    expect(
      parseTtsSettings({
        provider: 'openai',
        voiceId: 'alloy',
        model: 'tts-1',
        hasApiKey: true,
        ignored: 'value',
      }),
    ).toEqual({ provider: 'openai', voiceId: 'alloy', model: 'tts-1', hasApiKey: true });
  });

  it.each([
    [
      'unsupported provider',
      { provider: 'other', voiceId: null, model: null, hasApiKey: true },
      'provider',
    ],
    ['missing hasApiKey', { provider: 'openai', voiceId: null, model: null }, 'hasApiKey'],
    [
      'non-string voiceId',
      { provider: 'openai', voiceId: 1, model: null, hasApiKey: true },
      'voiceId',
    ],
    [
      'non-string model',
      { provider: 'openai', voiceId: null, model: false, hasApiKey: true },
      'model',
    ],
  ])('rejects settings with %s', (_caseName, value, field) => {
    expect(() => parseTtsSettings(value)).toThrow(`invalid_tts_settings:${field}`);
  });

  it('parses a valid generate response', () => {
    expect(parseGeneratePronunciationResponse({ audioUrl: HTTPS_AUDIO, cached: false })).toEqual({
      audioUrl: HTTPS_AUDIO,
      cached: false,
    });
  });

  it('parses effective settings when the backend includes them', () => {
    expect(
      parseGeneratePronunciationResponse({
        audioUrl: HTTPS_AUDIO,
        cached: false,
        effectiveSettings: { provider: 'openai', voiceId: 'alloy', model: 'tts-1' },
      }),
    ).toEqual({
      audioUrl: HTTPS_AUDIO,
      cached: false,
      effectiveSettings: { provider: 'openai', voiceId: 'alloy', model: 'tts-1' },
    });
  });

  it('parses effective settings with null voice/model', () => {
    expect(
      parseGeneratePronunciationResponse({
        audioUrl: HTTPS_AUDIO,
        cached: true,
        effectiveSettings: { provider: 'elevenlabs', voiceId: null, model: null },
      }),
    ).toEqual({
      audioUrl: HTTPS_AUDIO,
      cached: true,
      effectiveSettings: { provider: 'elevenlabs', voiceId: null, model: null },
    });
  });

  it.each([
    [
      'unsupported provider',
      { provider: 'other', voiceId: null, model: null },
      'effectiveSettings:provider',
    ],
    ['non-record effectiveSettings', 'openai', 'effectiveSettings'],
    [
      'non-string voiceId',
      { provider: 'openai', voiceId: 1, model: null },
      'effectiveSettings:voiceId',
    ],
  ])('rejects effective settings with %s', (_caseName, effectiveSettings, field) => {
    expect(() =>
      parseGeneratePronunciationResponse({
        audioUrl: HTTPS_AUDIO,
        cached: false,
        effectiveSettings,
      }),
    ).toThrow(`invalid_tts_generate_response:${field}`);
  });

  it('rejects non-HTTPS audio URLs', () => {
    expect(() =>
      parseGeneratePronunciationResponse({
        audioUrl: 'http://audio.example.test/mizu.mp3',
        cached: false,
      }),
    ).toThrow('invalid_tts_generate_response:audioUrl');
  });

  it('rejects an unparseable audio URL with the stable generate-response code', () => {
    expect(() =>
      parseGeneratePronunciationResponse({ audioUrl: 'not-a-url', cached: false }),
    ).toThrow('invalid_tts_generate_response:audioUrl');
  });

  it('parses a valid GET audio URL response', () => {
    expect(parseTtsAudioUrlResponse({ audioUrl: HTTPS_AUDIO })).toEqual({
      audioUrl: HTTPS_AUDIO,
    });
  });

  it('parses effective settings in a GET audio URL response', () => {
    expect(
      parseTtsAudioUrlResponse({
        audioUrl: HTTPS_AUDIO,
        effectiveSettings: { provider: 'openai', voiceId: 'alloy', model: 'tts-1' },
      }),
    ).toEqual({
      audioUrl: HTTPS_AUDIO,
      effectiveSettings: { provider: 'openai', voiceId: 'alloy', model: 'tts-1' },
    });
  });

  it('parses effective settings with null voice/model in a GET audio URL response', () => {
    expect(
      parseTtsAudioUrlResponse({
        audioUrl: HTTPS_AUDIO,
        effectiveSettings: { provider: 'elevenlabs', voiceId: null, model: null },
      }),
    ).toEqual({
      audioUrl: HTTPS_AUDIO,
      effectiveSettings: { provider: 'elevenlabs', voiceId: null, model: null },
    });
  });

  it.each([
    [
      'unsupported provider',
      { provider: 'other', voiceId: null, model: null },
      'effectiveSettings:provider',
    ],
    ['non-record effectiveSettings', 'openai', 'effectiveSettings'],
    [
      'non-string voiceId',
      { provider: 'openai', voiceId: 1, model: null },
      'effectiveSettings:voiceId',
    ],
  ])(
    'rejects a GET audio response effectiveSettings with %s',
    (_caseName, effectiveSettings, field) => {
      expect(() => parseTtsAudioUrlResponse({ audioUrl: HTTPS_AUDIO, effectiveSettings })).toThrow(
        `invalid_tts_audio_response:${field}`,
      );
    },
  );

  it.each([
    ['non-HTTPS audio URL', { audioUrl: 'http://audio.example.test/mizu.mp3' }],
    ['unparseable audio URL', { audioUrl: 'not-a-url' }],
    ['missing audio URL', {}],
    ['non-string audio URL', { audioUrl: 1 }],
  ])('rejects a GET audio response with %s', (_caseName, value) => {
    expect(() => parseTtsAudioUrlResponse(value)).toThrow('invalid_tts_audio_response:audioUrl');
  });

  it('trims generation input', () => {
    expect(parseGeneratePronunciationRequest({ vocabularyId: ' 水:ミズ ', text: ' 水 ' })).toEqual({
      vocabularyId: '水:ミズ',
      text: '水',
    });
  });

  it.each([
    ['blank vocabularyId', { vocabularyId: ' ', text: '水' }, 'vocabularyId'],
    ['blank text', { vocabularyId: '水:ミズ', text: '\t' }, 'text'],
  ])('rejects generation input with %s', (_caseName, value, field) => {
    expect(() => parseGeneratePronunciationRequest(value)).toThrow(
      `invalid_tts_generate_request:${field}`,
    );
  });

  it('accepts an uncoded legacy error body', () => {
    expect(parseTtsApiErrorResponse({ error: 'Failed to generate TTS audio' })).toEqual({
      error: 'Failed to generate TTS audio',
    });
  });

  it.each([
    'tts_not_configured',
    'tts_invalid_provider_configuration',
    'tts_audio_service_unavailable',
    'tts_generation_timeout',
    'tts_generation_failed',
    'tts_audio_storage_failed',
    'tts_audio_access_failed',
    'tts_audio_bucket_not_configured',
    'tts_unexpected_error',
  ])('parses the supported coded error %s', (code) => {
    expect(parseTtsApiErrorResponse({ error: 'TTS failed', code })).toEqual({
      error: 'TTS failed',
      code,
    });
  });

  it.each([
    ['missing error', {}],
    ['non-string error', { error: 1 }],
    ['non-string code', { error: 'TTS failed', code: 1 }],
    ['unknown code', { error: 'TTS failed', code: 'tts_unknown' }],
  ])('rejects malformed error bodies with %s', (_caseName, value) => {
    expect(() => parseTtsApiErrorResponse(value)).toThrow('invalid_tts_api_error');
  });
});
