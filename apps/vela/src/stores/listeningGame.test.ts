import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useListeningGameStore } from './listeningGame';
import type { ListeningQuestion } from '../types/listening';

const makeVocabQuestion = (id: string, english: string): ListeningQuestion => ({
  kind: 'vocabulary',
  id,
  text: `漢字${id}`,
  reading: `よみ${id}`,
  romaji: `romaji${id}`,
  englishTranslation: english,
  distractors: ['wrong1', 'wrong2', 'wrong3'],
  raw: {
    id,
    japanese_word: `漢字${id}`,
    hiragana: `よみ${id}`,
    romaji: `romaji${id}`,
    english_translation: english,
    difficulty_level: 1,
    category: 'test',
    created_at: '2024-01-01T00:00:00Z',
  },
});

const twoQuestions = [makeVocabQuestion('q1', 'one'), makeVocabQuestion('q2', 'two')];

describe('useListeningGameStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('initial state', () => {
    it('starts with empty questions, index 0, score 0, gameActive false', () => {
      const store = useListeningGameStore();
      expect(store.questions).toHaveLength(0);
      expect(store.currentIndex).toBe(0);
      expect(store.score).toBe(0);
      expect(store.gameActive).toBe(false);
    });

    it('currentQuestion is null when no questions', () => {
      const store = useListeningGameStore();
      expect(store.currentQuestion).toBeNull();
    });
  });

  describe('startGame', () => {
    it('sets questions, resets index/score, activates game', () => {
      const store = useListeningGameStore();
      store.startGame(twoQuestions);

      expect(store.questions).toHaveLength(2);
      expect(store.currentIndex).toBe(0);
      expect(store.score).toBe(0);
      expect(store.gameActive).toBe(true);
    });

    it('currentQuestion returns first question after start', () => {
      const store = useListeningGameStore();
      store.startGame(twoQuestions);
      expect(store.currentQuestion?.id).toBe('q1');
    });

    it('resets score from a previous game', () => {
      const store = useListeningGameStore();
      store.startGame(twoQuestions);
      store.submitAnswer(true);
      store.startGame(twoQuestions);
      expect(store.score).toBe(0);
    });
  });

  describe('submitAnswer', () => {
    it('increments score on correct answer', () => {
      const store = useListeningGameStore();
      store.startGame(twoQuestions);
      store.submitAnswer(true);
      expect(store.score).toBe(1);
    });

    it('does not increment score on wrong answer', () => {
      const store = useListeningGameStore();
      store.startGame(twoQuestions);
      store.submitAnswer(false);
      expect(store.score).toBe(0);
    });

    it('advances currentIndex', () => {
      const store = useListeningGameStore();
      store.startGame(twoQuestions);
      store.submitAnswer(true);
      expect(store.currentIndex).toBe(1);
      expect(store.currentQuestion?.id).toBe('q2');
    });

    it('ends game after last question answered', () => {
      const store = useListeningGameStore();
      store.startGame(twoQuestions);
      store.submitAnswer(true);
      store.submitAnswer(false);
      expect(store.gameActive).toBe(false);
    });

    it('currentQuestion is null after all questions answered', () => {
      const store = useListeningGameStore();
      store.startGame(twoQuestions);
      store.submitAnswer(false);
      store.submitAnswer(false);
      expect(store.currentQuestion).toBeNull();
    });
  });

  describe('endGame', () => {
    it('sets gameActive to false', () => {
      const store = useListeningGameStore();
      store.startGame(twoQuestions);
      store.endGame();
      expect(store.gameActive).toBe(false);
    });

    it('preserves score and questions after endGame', () => {
      const store = useListeningGameStore();
      store.startGame(twoQuestions);
      store.submitAnswer(true);
      store.endGame();
      expect(store.score).toBe(1);
      expect(store.questions).toHaveLength(2);
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      const store = useListeningGameStore();
      store.startGame(twoQuestions);
      store.submitAnswer(true);
      store.reset();

      expect(store.questions).toHaveLength(0);
      expect(store.currentIndex).toBe(0);
      expect(store.score).toBe(0);
      expect(store.gameActive).toBe(false);
      expect(store.currentQuestion).toBeNull();
    });
  });
});
