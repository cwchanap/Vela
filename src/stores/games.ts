import { defineStore } from 'pinia';
import type { Vocabulary } from 'src/types/database';

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
}

export const useGameStore = defineStore('game', {
  state: (): GameState => ({
    score: 0,
    questions: [],
    currentQuestionIndex: 0,
    gameActive: false,
  }),
  actions: {
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
