import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useGameStore } from './games';

const mockVocab = {
  id: 'v1',
  japanese_word: '猫',
  hiragana: 'ねこ',
  romaji: 'neko',
  english_translation: 'cat',
  jlpt_level: 5,
  created_at: '2024-01-01T00:00:00Z',
};

const makeQuestion = (answer = 'cat') => ({
  word: mockVocab,
  options: ['cat', 'dog', 'bird', 'fish'],
  correctAnswer: answer,
});

const mockSentence = {
  id: 's1',
  japanese: '猫がいる',
  english: 'There is a cat',
  words: ['猫', 'が', 'いる'],
  created_at: '2024-01-01T00:00:00Z',
};

const makeSentenceQuestion = () => ({
  sentence: mockSentence,
  scrambled: ['が', 'いる', '猫'],
  correctAnswer: '猫がいる',
});

describe('useGameStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('initial state', () => {
    it('has correct defaults', () => {
      const store = useGameStore();
      expect(store.score).toBe(0);
      expect(store.questions).toEqual([]);
      expect(store.currentQuestionIndex).toBe(0);
      expect(store.gameActive).toBe(false);
      expect(store.sentenceQuestions).toEqual([]);
      expect(store.currentSentenceQuestionIndex).toBe(0);
      expect(store.sentenceGameActive).toBe(false);
      expect(store.jlptLevels).toBeNull();
      expect(store.srsMode).toBe(false);
    });
  });

  describe('setJlptLevels', () => {
    it('sets JLPT levels array', () => {
      const store = useGameStore();
      store.setJlptLevels([4, 5]);
      expect(store.jlptLevels).toEqual([4, 5]);
    });

    it('sets null for empty array', () => {
      const store = useGameStore();
      store.setJlptLevels([]);
      expect(store.jlptLevels).toBeNull();
    });

    it('sets null when null passed', () => {
      const store = useGameStore();
      store.setJlptLevels([5]);
      store.setJlptLevels(null);
      expect(store.jlptLevels).toBeNull();
    });
  });

  describe('selectedJlptLevels getter', () => {
    it('returns empty array when jlptLevels is null', () => {
      const store = useGameStore();
      expect(store.selectedJlptLevels).toEqual([]);
    });

    it('returns the set levels', () => {
      const store = useGameStore();
      store.setJlptLevels([3, 4]);
      expect(store.selectedJlptLevels).toEqual([3, 4]);
    });
  });

  describe('setSrsMode', () => {
    it('enables SRS mode', () => {
      const store = useGameStore();
      store.setSrsMode(true);
      expect(store.srsMode).toBe(true);
    });

    it('disables SRS mode', () => {
      const store = useGameStore();
      store.setSrsMode(true);
      store.setSrsMode(false);
      expect(store.srsMode).toBe(false);
    });
  });

  describe('vocabulary game', () => {
    it('startGame initializes game state', () => {
      const store = useGameStore();
      const questions = [makeQuestion(), makeQuestion('dog')];
      store.startGame(questions);
      expect(store.gameActive).toBe(true);
      expect(store.score).toBe(0);
      expect(store.questions).toHaveLength(2);
      expect(store.currentQuestionIndex).toBe(0);
    });

    it('startGame resets previous score', () => {
      const store = useGameStore();
      store.startGame([makeQuestion()]);
      store.answerQuestion(true);
      store.startGame([makeQuestion(), makeQuestion()]);
      expect(store.score).toBe(0);
    });

    it('answerQuestion increments score on correct answer', () => {
      const store = useGameStore();
      store.startGame([makeQuestion(), makeQuestion()]);
      store.answerQuestion(true);
      expect(store.score).toBe(1);
      expect(store.currentQuestionIndex).toBe(1);
    });

    it('answerQuestion does not increment score on wrong answer', () => {
      const store = useGameStore();
      store.startGame([makeQuestion(), makeQuestion()]);
      store.answerQuestion(false);
      expect(store.score).toBe(0);
      expect(store.currentQuestionIndex).toBe(1);
    });

    it('answerQuestion ends game when all questions answered', () => {
      const store = useGameStore();
      store.startGame([makeQuestion()]);
      store.answerQuestion(true);
      expect(store.gameActive).toBe(false);
    });

    it('answerQuestion does not end game until all questions answered', () => {
      const store = useGameStore();
      store.startGame([makeQuestion(), makeQuestion()]);
      store.answerQuestion(true);
      expect(store.gameActive).toBe(true);
      store.answerQuestion(false);
      expect(store.gameActive).toBe(false);
    });

    it('endGame sets gameActive to false', () => {
      const store = useGameStore();
      store.startGame([makeQuestion()]);
      store.endGame();
      expect(store.gameActive).toBe(false);
    });

    it('tracks final score correctly across multiple answers', () => {
      const store = useGameStore();
      store.startGame([makeQuestion(), makeQuestion(), makeQuestion()]);
      store.answerQuestion(true);
      store.answerQuestion(false);
      store.answerQuestion(true);
      expect(store.score).toBe(2);
    });
  });

  describe('sentence game', () => {
    it('startSentenceGame initializes sentence game state', () => {
      const store = useGameStore();
      const questions = [makeSentenceQuestion(), makeSentenceQuestion()];
      store.startSentenceGame(questions);
      expect(store.sentenceGameActive).toBe(true);
      expect(store.score).toBe(0);
      expect(store.sentenceQuestions).toHaveLength(2);
      expect(store.currentSentenceQuestionIndex).toBe(0);
    });

    it('answerSentenceQuestion increments score on correct answer', () => {
      const store = useGameStore();
      store.startSentenceGame([makeSentenceQuestion(), makeSentenceQuestion()]);
      store.answerSentenceQuestion(true);
      expect(store.score).toBe(1);
      expect(store.currentSentenceQuestionIndex).toBe(1);
    });

    it('startSentenceGame resets previous score', () => {
      const store = useGameStore();
      store.startSentenceGame([makeSentenceQuestion()]);
      store.answerSentenceQuestion(true);
      store.startSentenceGame([makeSentenceQuestion(), makeSentenceQuestion()]);
      expect(store.score).toBe(0);
    });

    it('answerSentenceQuestion does not increment score on wrong answer', () => {
      const store = useGameStore();
      store.startSentenceGame([makeSentenceQuestion(), makeSentenceQuestion()]);
      store.answerSentenceQuestion(false);
      expect(store.score).toBe(0);
      expect(store.currentSentenceQuestionIndex).toBe(1);
    });

    it('answerSentenceQuestion ends game when all questions answered', () => {
      const store = useGameStore();
      store.startSentenceGame([makeSentenceQuestion()]);
      store.answerSentenceQuestion(true);
      expect(store.sentenceGameActive).toBe(false);
    });

    it('endSentenceGame sets sentenceGameActive to false', () => {
      const store = useGameStore();
      store.startSentenceGame([makeSentenceQuestion()]);
      store.endSentenceGame();
      expect(store.sentenceGameActive).toBe(false);
    });
  });
});
