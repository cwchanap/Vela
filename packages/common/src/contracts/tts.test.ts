import { describe, expect, it } from 'vitest';
import {
  parseGeneratePronunciationRequest,
  parseGeneratePronunciationResponse,
  parseTtsApiErrorResponse,
  parseTtsAudioUrlResponse,
  parseTtsSettings,
} from './tts';

const HTTPS_AUDIO = 'https://audio.example.test/mizu.mp3';

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
