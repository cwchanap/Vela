import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('src/utils/httpClient', () => ({
  httpJson: vi.fn(),
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

import { httpJson, httpJsonAuth } from 'src/utils/httpClient';
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
    vi.mocked(httpJson).mockResolvedValue(mockResult);

    const result = await lookupWord('猫');

    expect(vi.mocked(httpJson)).toHaveBeenCalledWith(
      'http://localhost:9005/api/dictionary/lookup?word=%E7%8C%AB',
    );
    expect(result).toEqual(mockResult);
  });

  it('returns null on error (word not found)', async () => {
    vi.mocked(httpJson).mockRejectedValue(new Error('Not Found'));
    const result = await lookupWord('zzznotaword');
    expect(result).toBeNull();
  });

  it('does not add a bespoke cache on top of the shared query layer', async () => {
    vi.mocked(httpJson).mockResolvedValue({
      word: '猫',
      reading: 'ねこ',
      meanings: ['cat'],
      common: false,
    });

    await lookupWord('猫');
    await lookupWord('猫');

    expect(vi.mocked(httpJson)).toHaveBeenCalledTimes(2);
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
