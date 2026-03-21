import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listeningGameService } from './listeningGameService';
import type { ListeningConfig } from 'src/types/listening';
import type { LegacyVocabularyPayload } from 'src/utils/vocabulary';
import type { Sentence } from 'src/types/database';

vi.mock('src/utils/api', () => ({
  getApiUrl: vi.fn((endpoint: string) => `/api/${endpoint}`),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockResponse = (body: unknown, ok = true) =>
  Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);

const makeVocabPayload = (id: string, word: string, english: string): LegacyVocabularyPayload => ({
  id,
  japanese_word: word,
  hiragana: `${word}よみ`,
  romaji: `${word}romaji`,
  english_translation: english,
  jlpt_level: 5,
  created_at: '2024-01-01T00:00:00Z',
});

const makeSentence = (id: string, japanese: string, english: string): Sentence => ({
  id,
  japanese_sentence: japanese,
  english_translation: english,
  created_at: '2024-01-01T00:00:00Z',
});

const vocabConfig: ListeningConfig = {
  mode: 'multiple-choice',
  source: 'vocabulary',
  jlptLevels: [],
};

const sentenceConfig: ListeningConfig = {
  mode: 'multiple-choice',
  source: 'sentences',
  jlptLevels: [],
};

describe('listeningGameService.getListeningQuestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('vocabulary source', () => {
    it('returns ListeningQuestions with kind=vocabulary', async () => {
      const pool = [
        makeVocabPayload('v1', '猫', 'cat'),
        makeVocabPayload('v2', '犬', 'dog'),
        makeVocabPayload('v3', '鳥', 'bird'),
        makeVocabPayload('v4', '魚', 'fish'),
        makeVocabPayload('v5', '馬', 'horse'),
      ];
      mockFetch.mockReturnValue(mockResponse({ vocabulary: pool }));

      const questions = await listeningGameService.getListeningQuestions(vocabConfig, 3);

      expect(questions).toHaveLength(3);
      expect(questions[0]!.kind).toBe('vocabulary');
      expect(questions[0]!.id).toBe('v1');
      expect(questions[0]!.englishTranslation).toBe('cat');
    });

    it('maps hiragana to reading field', async () => {
      const pool = [
        makeVocabPayload('v1', '猫', 'cat'),
        makeVocabPayload('v2', '犬', 'dog'),
        makeVocabPayload('v3', '鳥', 'bird'),
        makeVocabPayload('v4', '魚', 'fish'),
      ];
      mockFetch.mockReturnValue(mockResponse({ vocabulary: pool }));

      const questions = await listeningGameService.getListeningQuestions(vocabConfig, 1);
      const q = questions[0]!;

      if (q.kind !== 'vocabulary') throw new Error('expected vocabulary kind');
      expect(q.reading).toBe('猫よみ');
    });

    it('builds 3 distractors from pool', async () => {
      const pool = [
        makeVocabPayload('v1', '猫', 'cat'),
        makeVocabPayload('v2', '犬', 'dog'),
        makeVocabPayload('v3', '鳥', 'bird'),
        makeVocabPayload('v4', '魚', 'fish'),
      ];
      mockFetch.mockReturnValue(mockResponse({ vocabulary: pool }));

      const questions = await listeningGameService.getListeningQuestions(vocabConfig, 1);
      expect(questions[0]!.distractors).toHaveLength(3);
      expect(questions[0]!.distractors).not.toContain('cat');
    });

    it('does not include correct answer in distractors', async () => {
      const pool = Array.from({ length: 10 }, (_, i) =>
        makeVocabPayload(`v${i}`, `word${i}`, `meaning${i}`),
      );
      mockFetch.mockReturnValue(mockResponse({ vocabulary: pool }));

      const questions = await listeningGameService.getListeningQuestions(vocabConfig, 5);
      for (const q of questions) {
        expect(q.distractors).not.toContain(q.englishTranslation);
      }
    });

    it('returns empty array when vocabulary is missing from response', async () => {
      mockFetch.mockReturnValue(mockResponse({}));

      const questions = await listeningGameService.getListeningQuestions(vocabConfig, 5);
      expect(questions).toHaveLength(0);
    });

    it('includes JLPT filter in URL when levels provided', async () => {
      mockFetch.mockReturnValue(mockResponse({ vocabulary: [] }));
      const config: ListeningConfig = { ...vocabConfig, jlptLevels: [4, 5] };

      await listeningGameService.getListeningQuestions(config, 5);

      const calledUrl: string = mockFetch.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('jlpt=4,5');
    });

    it('does not include JLPT param when levels is empty', async () => {
      mockFetch.mockReturnValue(mockResponse({ vocabulary: [] }));

      await listeningGameService.getListeningQuestions(vocabConfig, 5);

      const calledUrl: string = mockFetch.mock.calls[0]![0] as string;
      expect(calledUrl).not.toContain('jlpt=');
    });

    it('over-fetches to build distractor pool (limit = count * 2)', async () => {
      mockFetch.mockReturnValue(mockResponse({ vocabulary: [] }));

      await listeningGameService.getListeningQuestions(vocabConfig, 5);

      const calledUrl: string = mockFetch.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('limit=10');
    });

    it('drops vocabulary questions that cannot produce 3 distractors', async () => {
      // Only 2 items in pool — the first question can only get 1 distractor, not 3
      const pool = [makeVocabPayload('v1', '猫', 'cat'), makeVocabPayload('v2', '犬', 'dog')];
      mockFetch.mockReturnValue(mockResponse({ vocabulary: pool }));

      const questions = await listeningGameService.getListeningQuestions(vocabConfig, 2);
      expect(questions).toHaveLength(0);
    });
  });

  describe('sentence source', () => {
    it('returns ListeningQuestions with kind=sentence', async () => {
      const pool = [
        makeSentence('s1', '猫がいる', 'There is a cat'),
        makeSentence('s2', '犬がいる', 'There is a dog'),
        makeSentence('s3', '鳥がいる', 'There is a bird'),
        makeSentence('s4', '魚がいる', 'There is a fish'),
      ];
      mockFetch.mockReturnValue(mockResponse({ sentences: pool }));

      const questions = await listeningGameService.getListeningQuestions(sentenceConfig, 2);

      expect(questions).toHaveLength(2);
      expect(questions[0]!.kind).toBe('sentence');
      expect(questions[0]!.text).toBe('猫がいる');
      expect(questions[0]!.englishTranslation).toBe('There is a cat');
    });

    it('builds 3 distractors for sentences', async () => {
      const pool = [
        makeSentence('s1', '猫がいる', 'There is a cat'),
        makeSentence('s2', '犬がいる', 'There is a dog'),
        makeSentence('s3', '鳥がいる', 'There is a bird'),
        makeSentence('s4', '魚がいる', 'There is a fish'),
      ];
      mockFetch.mockReturnValue(mockResponse({ sentences: pool }));

      const questions = await listeningGameService.getListeningQuestions(sentenceConfig, 1);
      expect(questions[0]!.distractors).toHaveLength(3);
      expect(questions[0]!.distractors).not.toContain('There is a cat');
    });

    it('returns empty array when sentences is missing from response', async () => {
      mockFetch.mockReturnValue(mockResponse({}));

      const questions = await listeningGameService.getListeningQuestions(sentenceConfig, 5);
      expect(questions).toHaveLength(0);
    });

    it('includes JLPT filter for sentences when levels provided', async () => {
      mockFetch.mockReturnValue(mockResponse({ sentences: [] }));
      const config: ListeningConfig = { ...sentenceConfig, jlptLevels: [3] };

      await listeningGameService.getListeningQuestions(config, 5);

      const calledUrl: string = mockFetch.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('jlpt=3');
    });

    it('over-fetches sentences to build distractor pool (limit = count * 2)', async () => {
      mockFetch.mockReturnValue(mockResponse({ sentences: [] }));

      await listeningGameService.getListeningQuestions(sentenceConfig, 5);

      const calledUrl: string = mockFetch.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('limit=10');
    });

    it('drops sentence questions that cannot produce 3 distractors', async () => {
      // Only 2 sentences — cannot build 3 distractors for any question
      const pool = [
        makeSentence('s1', '猫がいる', 'There is a cat'),
        makeSentence('s2', '犬がいる', 'There is a dog'),
      ];
      mockFetch.mockReturnValue(mockResponse({ sentences: pool }));

      const questions = await listeningGameService.getListeningQuestions(sentenceConfig, 2);
      expect(questions).toHaveLength(0);
    });
  });
});
