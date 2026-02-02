import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useFlashcardStore, QUALITY_RATINGS } from './flashcards';
import type { Vocabulary } from 'src/types/database';

describe('flashcards store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mockVocabulary: Vocabulary[] = [
    {
      id: 'vocab-1',
      japanese_word: '猫',
      hiragana: 'ねこ',
      romaji: 'neko',
      english_translation: 'cat',
      created_at: '2024-01-01T00:00:00Z',
      jlpt_level: 5,
    },
    {
      id: 'vocab-2',
      japanese_word: '犬',
      hiragana: 'いぬ',
      romaji: 'inu',
      english_translation: 'dog',
      created_at: '2024-01-01T00:00:00Z',
      jlpt_level: 5,
    },
    {
      id: 'vocab-3',
      japanese_word: '鳥',
      hiragana: 'とり',
      romaji: 'tori',
      english_translation: 'bird',
      created_at: '2024-01-01T00:00:00Z',
      jlpt_level: 4,
    },
  ];

  describe('initial state', () => {
    it('should have correct default values', () => {
      const store = useFlashcardStore();

      expect(store.studyMode).toBe('srs');
      expect(store.cardDirection).toBe('jp-to-en');
      expect(store.jlptLevels).toEqual([]);
      expect(store.showFurigana).toBe(true);
      expect(store.cards).toEqual([]);
      expect(store.currentIndex).toBe(0);
      expect(store.sessionActive).toBe(false);
      expect(store.isLoading).toBe(false);
    });

    it('should have correct initial stats', () => {
      const store = useFlashcardStore();

      expect(store.stats.cardsReviewed).toBe(0);
      expect(store.stats.correctCount).toBe(0);
      expect(store.stats.incorrectCount).toBe(0);
      expect(store.stats.againCount).toBe(0);
      expect(store.stats.hardCount).toBe(0);
      expect(store.stats.goodCount).toBe(0);
      expect(store.stats.easyCount).toBe(0);
      expect(store.stats.startTime).toBeNull();
      expect(store.stats.endTime).toBeNull();
    });
  });

  describe('getters', () => {
    describe('currentCard', () => {
      it('should return null when no cards', () => {
        const store = useFlashcardStore();
        expect(store.currentCard).toBeNull();
      });

      it('should return current card when session active', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        expect(store.currentCard).not.toBeNull();
        expect(store.currentCard?.vocabulary.id).toBe('vocab-1');
      });

      it('should return correct card after moving to next', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);
        store.flipCard();
        store.rateCard(QUALITY_RATINGS.GOOD);

        expect(store.currentCard?.vocabulary.id).toBe('vocab-2');
      });
    });

    describe('hasMoreCards', () => {
      it('should return false when no cards', () => {
        const store = useFlashcardStore();
        expect(store.hasMoreCards).toBe(false);
      });

      it('should return true when more cards available', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        expect(store.hasMoreCards).toBe(true);
      });

      it('should return false on last card', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);
        store.currentIndex = 2; // Last card

        expect(store.hasMoreCards).toBe(false);
      });
    });

    describe('progressPercent', () => {
      it('should return 0 when no cards', () => {
        const store = useFlashcardStore();
        expect(store.progressPercent).toBe(0);
      });

      it('should return correct percentage', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        // First card: 1/3 = 33%
        expect(store.progressPercent).toBe(33);

        store.flipCard();
        store.rateCard(QUALITY_RATINGS.GOOD);

        // Second card: 2/3 = 67%
        expect(store.progressPercent).toBe(67);
      });
    });

    describe('accuracy', () => {
      it('should return 0 when no cards reviewed', () => {
        const store = useFlashcardStore();
        expect(store.accuracy).toBe(0);
      });

      it('should calculate correct accuracy', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        // Rate first card as correct (GOOD)
        store.flipCard();
        store.rateCard(QUALITY_RATINGS.GOOD);

        // Rate second card as incorrect (AGAIN)
        store.flipCard();
        store.rateCard(QUALITY_RATINGS.AGAIN);

        // 1 correct out of 2 = 50%
        expect(store.accuracy).toBe(50);
      });
    });

    describe('isReverseMode', () => {
      it('should return false for jp-to-en', () => {
        const store = useFlashcardStore();
        expect(store.isReverseMode).toBe(false);
      });

      it('should return true for en-to-jp', () => {
        const store = useFlashcardStore();
        store.setCardDirection('en-to-jp');
        expect(store.isReverseMode).toBe(true);
      });
    });
  });

  describe('actions', () => {
    describe('setStudyMode', () => {
      it('should update study mode', () => {
        const store = useFlashcardStore();
        store.setStudyMode('cram');
        expect(store.studyMode).toBe('cram');
      });
    });

    describe('setCardDirection', () => {
      it('should update card direction', () => {
        const store = useFlashcardStore();
        store.setCardDirection('en-to-jp');
        expect(store.cardDirection).toBe('en-to-jp');
      });
    });

    describe('setJlptLevels', () => {
      it('should update JLPT levels', () => {
        const store = useFlashcardStore();
        store.setJlptLevels([5, 4]);
        expect(store.jlptLevels).toEqual([5, 4]);
      });
    });

    describe('toggleFurigana', () => {
      it('should toggle furigana visibility', () => {
        const store = useFlashcardStore();
        expect(store.showFurigana).toBe(true);

        store.toggleFurigana();
        expect(store.showFurigana).toBe(false);

        store.toggleFurigana();
        expect(store.showFurigana).toBe(true);
      });
    });

    describe('setShowFurigana', () => {
      it('should set furigana visibility directly', () => {
        const store = useFlashcardStore();
        store.setShowFurigana(false);
        expect(store.showFurigana).toBe(false);
      });
    });

    describe('startSession', () => {
      it('should initialize session with vocabulary', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        expect(store.cards.length).toBe(3);
        expect(store.currentIndex).toBe(0);
        expect(store.sessionActive).toBe(true);
        expect(store.stats.startTime).not.toBeNull();
      });

      it('should create flashcard objects from vocabulary', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        expect(store.cards[0].vocabulary.id).toBe('vocab-1');
        expect(store.cards[0].isFlipped).toBe(false);
        expect(store.cards[0].rating).toBeNull();
        expect(store.cards[0].userAnswer).toBeNull();
        expect(store.cards[0].isCorrect).toBeNull();
      });

      it('should reset stats when starting new session', () => {
        const store = useFlashcardStore();

        // First session
        store.startSession(mockVocabulary);
        store.flipCard();
        store.rateCard(QUALITY_RATINGS.GOOD);

        // Second session
        store.startSession(mockVocabulary);

        expect(store.stats.cardsReviewed).toBe(0);
        expect(store.stats.correctCount).toBe(0);
      });
    });

    describe('flipCard', () => {
      it('should flip the current card', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        expect(store.cards[0].isFlipped).toBe(false);
        store.flipCard();
        expect(store.cards[0].isFlipped).toBe(true);
      });

      it('should do nothing when no cards', () => {
        const store = useFlashcardStore();
        store.flipCard(); // Should not throw
      });
    });

    describe('setUserAnswer', () => {
      it('should set user answer for current card', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        store.setUserAnswer('ねこ');
        expect(store.cards[0].userAnswer).toBe('ねこ');
      });
    });

    describe('validateAnswer', () => {
      it('should validate correct japanese_word answer', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        const isCorrect = store.validateAnswer('猫');
        expect(isCorrect).toBe(true);
        expect(store.cards[0].isCorrect).toBe(true);
      });

      it('should validate correct hiragana answer', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        const isCorrect = store.validateAnswer('ねこ');
        expect(isCorrect).toBe(true);
      });

      it('should validate correct romaji answer', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        const isCorrect = store.validateAnswer('neko');
        expect(isCorrect).toBe(true);
      });

      it('should be case insensitive', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        const isCorrect = store.validateAnswer('NEKO');
        expect(isCorrect).toBe(true);
      });

      it('should trim whitespace', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        const isCorrect = store.validateAnswer('  neko  ');
        expect(isCorrect).toBe(true);
      });

      it('should return false for incorrect answer', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        const isCorrect = store.validateAnswer('inu');
        expect(isCorrect).toBe(false);
        expect(store.cards[0].isCorrect).toBe(false);
      });

      it('should return false when no cards', () => {
        const store = useFlashcardStore();
        expect(store.validateAnswer('test')).toBe(false);
      });
    });

    describe('setCardCorrectness', () => {
      it('should set correctness for current card', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        store.setCardCorrectness(true);
        expect(store.cards[0].isCorrect).toBe(true);

        store.setCardCorrectness(false);
        expect(store.cards[0].isCorrect).toBe(false);
      });

      it('should do nothing when no cards', () => {
        const store = useFlashcardStore();
        store.setCardCorrectness(true); // Should not throw
      });
    });

    describe('rateCard', () => {
      it('should update card rating and move to next', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);
        store.flipCard();

        store.rateCard(QUALITY_RATINGS.GOOD);

        expect(store.cards[0].rating).toBe(QUALITY_RATINGS.GOOD);
        expect(store.currentIndex).toBe(1);
      });

      it('should track correct count for HARD or better ratings', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);
        store.flipCard();

        store.rateCard(QUALITY_RATINGS.HARD);

        expect(store.stats.correctCount).toBe(1);
        expect(store.stats.incorrectCount).toBe(0);
      });

      it('should track incorrect count for AGAIN rating', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);
        store.flipCard();

        store.rateCard(QUALITY_RATINGS.AGAIN);

        expect(store.stats.correctCount).toBe(0);
        expect(store.stats.incorrectCount).toBe(1);
      });

      it('should track individual rating counts', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        store.flipCard();
        store.rateCard(QUALITY_RATINGS.AGAIN);
        store.flipCard();
        store.rateCard(QUALITY_RATINGS.HARD);
        store.flipCard();
        store.rateCard(QUALITY_RATINGS.GOOD);

        expect(store.stats.againCount).toBe(1);
        expect(store.stats.hardCount).toBe(1);
        expect(store.stats.goodCount).toBe(1);
        expect(store.stats.easyCount).toBe(0);
      });

      it('should end session after last card', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        store.flipCard();
        store.rateCard(QUALITY_RATINGS.GOOD);
        store.flipCard();
        store.rateCard(QUALITY_RATINGS.GOOD);
        store.flipCard();
        store.rateCard(QUALITY_RATINGS.GOOD);

        expect(store.sessionActive).toBe(false);
        expect(store.stats.endTime).not.toBeNull();
      });

      it('should use isCorrect for reverse mode accuracy', () => {
        const store = useFlashcardStore();
        store.setCardDirection('en-to-jp');
        store.startSession(mockVocabulary);

        // Simulate correct answer in reverse mode
        store.cards[0].isCorrect = true;
        store.rateCard(QUALITY_RATINGS.GOOD);

        expect(store.stats.correctCount).toBe(1);

        // Simulate incorrect answer in reverse mode
        store.cards[1].isCorrect = false;
        store.rateCard(QUALITY_RATINGS.AGAIN);

        expect(store.stats.incorrectCount).toBe(1);
      });
    });

    describe('endSession', () => {
      it('should end session and set end time', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);

        store.endSession();

        expect(store.sessionActive).toBe(false);
        expect(store.stats.endTime).not.toBeNull();
      });
    });

    describe('reset', () => {
      it('should reset store to initial state', () => {
        const store = useFlashcardStore();
        store.startSession(mockVocabulary);
        store.flipCard();
        store.rateCard(QUALITY_RATINGS.GOOD);

        store.reset();

        expect(store.cards).toEqual([]);
        expect(store.currentIndex).toBe(0);
        expect(store.sessionActive).toBe(false);
        expect(store.stats.cardsReviewed).toBe(0);
        expect(store.isLoading).toBe(false);
      });
    });

    describe('setLoading', () => {
      it('should update loading state', () => {
        const store = useFlashcardStore();

        store.setLoading(true);
        expect(store.isLoading).toBe(true);

        store.setLoading(false);
        expect(store.isLoading).toBe(false);
      });
    });
  });

  describe('QUALITY_RATINGS', () => {
    it('should have correct Anki-style values', () => {
      expect(QUALITY_RATINGS.AGAIN).toBe(1);
      expect(QUALITY_RATINGS.HARD).toBe(3);
      expect(QUALITY_RATINGS.GOOD).toBe(4);
      expect(QUALITY_RATINGS.EASY).toBe(5);
    });
  });
});
