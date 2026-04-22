import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('src/utils/httpClient', () => ({
  httpJsonAuth: vi.fn(),
}));

vi.mock('src/config', () => ({
  config: { api: { url: 'http://localhost:9005/api/' } },
}));

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: { idToken: { toString: () => 'mock-token' } },
  }),
}));

import { httpJsonAuth } from 'src/utils/httpClient';
import {
  lookupWord,
  addFlashcard,
  type JishoResult,
  type AddFlashcardPayload,
} from './vocabularyService';

describe('lookupWord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the dictionary API with the encoded word', async () => {
    const mockResult: JishoResult = {
      word: '猫',
      reading: 'ねこ',
      meanings: ['cat'],
      jlpt: 'jlpt-n5',
      common: true,
    };
    vi.mocked(httpJsonAuth).mockResolvedValue(mockResult);

    const result = await lookupWord('猫');

    expect(vi.mocked(httpJsonAuth)).toHaveBeenCalledWith(
      'http://localhost:9005/api/dictionary/lookup?word=%E7%8C%AB',
    );

    expect(result).toEqual(mockResult);
  });

  it('returns null on 404 responses', async () => {
    vi.mocked(httpJsonAuth).mockRejectedValue(
      Object.assign(new Error('Not Found'), { status: 404 }),
    );
    const result = await lookupWord('zzznotaword');
    expect(result).toBeNull();
  });

  it('rethrows non-404 errors so callers can handle retries', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('Gateway Timeout'), { status: 504 });
    vi.mocked(httpJsonAuth).mockRejectedValue(error);

    await expect(lookupWord('猫')).rejects.toBe(error);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[Vela] lookupWord failed for:', '猫', error);

    consoleErrorSpy.mockRestore();
  });

  it('does not add a bespoke cache on top of the shared query layer', async () => {
    vi.mocked(httpJsonAuth).mockResolvedValue({
      word: '猫',
      reading: 'ねこ',
      meanings: ['cat'],
      common: false,
    });

    await lookupWord('猫');
    await lookupWord('猫');

    expect(vi.mocked(httpJsonAuth)).toHaveBeenCalledTimes(2);
  });
});

describe('addFlashcard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the vocabulary API with the correct payload', async () => {
    vi.mocked(httpJsonAuth).mockResolvedValue({
      vocabulary_id: 'vocab-123',
      created: true,
      alreadyInSRS: false,
    });

    const payload: AddFlashcardPayload = {
      japanese_word: '猫',
      reading: 'ねこ',
      english_translation: 'cat',
      example_sentence_jp: '猫が好きです。',
    };

    const result = await addFlashcard(payload);

    expect(vi.mocked(httpJsonAuth)).toHaveBeenCalledWith(
      'http://localhost:9005/api/vocabulary/from-word',
      { method: 'POST', body: JSON.stringify(payload) },
    );
    expect(result).toEqual({ vocabulary_id: 'vocab-123', created: true, alreadyInSRS: false });
  });
});
