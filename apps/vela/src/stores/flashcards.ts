import { defineStore } from 'pinia';
import type { Vocabulary, JLPTLevel } from 'src/types/database';

/**
 * Quality ratings for SRS (Anki-style mapping)
 */
export const QUALITY_RATINGS = {
  AGAIN: 1, // Forgot completely
  HARD: 3, // Correct but with difficulty
  GOOD: 4, // Correct with some hesitation
  EASY: 5, // Perfect recall
} as const;

export type QualityRating = (typeof QUALITY_RATINGS)[keyof typeof QUALITY_RATINGS];

/**
 * Card direction for study
 */
export type CardDirection = 'jp-to-en' | 'en-to-jp';

/**
 * Study mode
 */
export type StudyMode = 'srs' | 'cram';

/**
 * A flashcard with its vocabulary data and study state
 */
export interface Flashcard {
  vocabulary: Vocabulary;
  /** Whether the card has been flipped to reveal the answer */
  isFlipped: boolean;
  /** User's rating for this card (null if not yet rated) */
  rating: QualityRating | null;
  /** For reverse mode: user's typed answer */
  userAnswer: string | null;
  /** For reverse mode: whether the answer was correct */
  isCorrect: boolean | null;
}

/**
 * Session statistics
 */
export interface SessionStats {
  cardsReviewed: number;
  correctCount: number;
  incorrectCount: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
  startTime: Date | null;
  endTime: Date | null;
}

/**
 * Flashcard session state
 */
export interface FlashcardState {
  /** Current study mode */
  studyMode: StudyMode;
  /** Card direction */
  cardDirection: CardDirection;
  /** Selected JLPT levels for filtering */
  jlptLevels: JLPTLevel[];
  /** Whether to show furigana */
  showFurigana: boolean;
  /** All cards in the current session */
  cards: Flashcard[];
  /** Current card index */
  currentIndex: number;
  /** Whether a session is active */
  sessionActive: boolean;
  /** Session statistics */
  stats: SessionStats;
  /** Loading state */
  isLoading: boolean;
}

const initialStats = (): SessionStats => ({
  cardsReviewed: 0,
  correctCount: 0,
  incorrectCount: 0,
  againCount: 0,
  hardCount: 0,
  goodCount: 0,
  easyCount: 0,
  startTime: null,
  endTime: null,
});

export const useFlashcardStore = defineStore('flashcards', {
  state: (): FlashcardState => ({
    studyMode: 'srs',
    cardDirection: 'jp-to-en',
    jlptLevels: [],
    showFurigana: true,
    cards: [],
    currentIndex: 0,
    sessionActive: false,
    stats: initialStats(),
    isLoading: false,
  }),

  getters: {
    /** Get the current card */
    currentCard: (state): Flashcard | null => {
      if (state.currentIndex >= 0 && state.currentIndex < state.cards.length) {
        return state.cards[state.currentIndex] ?? null;
      }
      return null;
    },

    /** Check if there are more cards */
    hasMoreCards: (state): boolean => {
      return state.currentIndex < state.cards.length - 1;
    },

    /** Get progress as percentage */
    progressPercent: (state): number => {
      if (state.cards.length === 0) return 0;
      return Math.round(((state.currentIndex + 1) / state.cards.length) * 100);
    },

    /** Get session duration in seconds */
    sessionDuration: (state): number => {
      if (!state.stats.startTime) return 0;
      const endTime = state.stats.endTime || new Date();
      return Math.round((endTime.getTime() - state.stats.startTime.getTime()) / 1000);
    },

    /** Get accuracy percentage */
    accuracy: (state): number => {
      if (state.stats.cardsReviewed === 0) return 0;
      return Math.round((state.stats.correctCount / state.stats.cardsReviewed) * 100);
    },

    /** Check if in reverse mode (English to Japanese) */
    isReverseMode: (state): boolean => {
      return state.cardDirection === 'en-to-jp';
    },
  },

  actions: {
    /** Set study mode */
    setStudyMode(mode: StudyMode) {
      this.studyMode = mode;
    },

    /** Set card direction */
    setCardDirection(direction: CardDirection) {
      this.cardDirection = direction;
    },

    /** Set JLPT levels filter */
    setJlptLevels(levels: JLPTLevel[]) {
      this.jlptLevels = levels;
    },

    /** Toggle furigana visibility */
    toggleFurigana() {
      this.showFurigana = !this.showFurigana;
    },

    /** Set furigana visibility */
    setShowFurigana(show: boolean) {
      this.showFurigana = show;
    },

    /** Start a new session with vocabulary */
    startSession(vocabulary: Vocabulary[]) {
      this.cards = vocabulary.map((v) => ({
        vocabulary: v,
        isFlipped: false,
        rating: null,
        userAnswer: null,
        isCorrect: null,
      }));
      this.currentIndex = 0;
      this.sessionActive = true;
      this.stats = initialStats();
      this.stats.startTime = new Date();
    },

    /** Flip the current card */
    flipCard() {
      const card = this.cards[this.currentIndex];
      if (card) {
        card.isFlipped = true;
      }
    },

    /** Set user's typed answer for reverse mode */
    setUserAnswer(answer: string) {
      const card = this.cards[this.currentIndex];
      if (card) {
        card.userAnswer = answer;
      }
    },

    /** Validate answer for reverse mode */
    validateAnswer(userAnswer: string): boolean {
      const card = this.cards[this.currentIndex];
      if (!card) return false;

      const vocab = card.vocabulary;
      const normalizedAnswer = userAnswer.trim().toLowerCase();

      // Check against japanese_word, hiragana, katakana, and romaji
      const validAnswers = [vocab.japanese_word, vocab.hiragana, vocab.katakana, vocab.romaji]
        .filter(Boolean)
        .map((a) => a!.toLowerCase().trim());

      const isCorrect = validAnswers.includes(normalizedAnswer);
      card.isCorrect = isCorrect;
      card.userAnswer = userAnswer;

      return isCorrect;
    },

    /** Rate the current card and move to next */
    rateCard(rating: QualityRating) {
      const card = this.cards[this.currentIndex];
      if (!card) return;

      // Update card rating
      card.rating = rating;

      // Update stats
      this.stats.cardsReviewed++;

      // For JP to EN mode, rating determines correctness
      // For EN to JP mode, correctness was already determined by validateAnswer
      if (this.cardDirection === 'jp-to-en') {
        if (rating >= QUALITY_RATINGS.HARD) {
          this.stats.correctCount++;
        } else {
          this.stats.incorrectCount++;
        }
      } else {
        // Reverse mode - use the isCorrect from validation
        if (card.isCorrect === null) {
          // Skip correctness counts if answer was not validated
        } else if (card.isCorrect) {
          this.stats.correctCount++;
        } else {
          this.stats.incorrectCount++;
        }
      }

      // Track individual rating counts
      switch (rating) {
        case QUALITY_RATINGS.AGAIN:
          this.stats.againCount++;
          break;
        case QUALITY_RATINGS.HARD:
          this.stats.hardCount++;
          break;
        case QUALITY_RATINGS.GOOD:
          this.stats.goodCount++;
          break;
        case QUALITY_RATINGS.EASY:
          this.stats.easyCount++;
          break;
      }

      // Move to next card or end session
      if (this.hasMoreCards) {
        this.currentIndex++;
      } else {
        this.endSession();
      }
    },

    /** End the current session */
    endSession() {
      this.sessionActive = false;
      this.stats.endTime = new Date();
    },

    /** Reset the store to initial state */
    reset() {
      this.cards = [];
      this.currentIndex = 0;
      this.sessionActive = false;
      this.stats = initialStats();
      this.isLoading = false;
    },

    /** Set loading state */
    setLoading(loading: boolean) {
      this.isLoading = loading;
    },
  },
});
