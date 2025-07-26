import { defineStore } from 'pinia';
import type { Vocabulary, Sentence } from 'src/types/database';

export interface SentenceQuestion {
  sentence: Sentence;
  scrambled: string[];
  correctAnswer: string;
}

export interface Question {
  word: Vocabulary;
  options: string[];
  correctAnswer: string;
}

export interface GameState {
  score: number;
  questions: Question[];
  currentQuestionIndex: number;
  gameActive: boolean;
  sentenceQuestions: SentenceQuestion[];
  currentSentenceQuestionIndex: number;
  sentenceGameActive: boolean;
}

export const useGameStore = defineStore('game', {
  state: (): GameState => ({
    score: 0,
    questions: [],
    currentQuestionIndex: 0,
    gameActive: false,
    sentenceQuestions: [],
    currentSentenceQuestionIndex: 0,
    sentenceGameActive: false,
  }),
  actions: {
    startSentenceGame(questions: SentenceQuestion[]) {
      this.score = 0;
      this.sentenceQuestions = questions;
      this.currentSentenceQuestionIndex = 0;
      this.sentenceGameActive = true;
    },
    answerSentenceQuestion(isCorrect: boolean) {
      if (isCorrect) {
        this.score++;
      }
      this.currentSentenceQuestionIndex++;
      if (this.currentSentenceQuestionIndex >= this.sentenceQuestions.length) {
        this.endSentenceGame();
      }
    },
    endSentenceGame() {
      this.sentenceGameActive = false;
    },
    startGame(questions: Question[]) {
      this.score = 0;
      this.questions = questions;
      this.currentQuestionIndex = 0;
      this.gameActive = true;
    },
    answerQuestion(isCorrect: boolean) {
      if (isCorrect) {
        this.score++;
      }
      this.currentQuestionIndex++;
      if (this.currentQuestionIndex >= this.questions.length) {
        this.endGame();
      }
    },
    endGame() {
      this.gameActive = false;
    },
  },
});
