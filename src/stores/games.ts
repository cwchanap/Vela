import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface GameSession {
  id: string;
  game_type: 'vocabulary' | 'sentence';
  score: number;
  duration_seconds: number;
  questions_answered: number;
  correct_answers: number;
  experience_gained: number;
  completed_at: Date;
}

export interface GameState {
  currentScore: number;
  questionsAnswered: number;
  correctAnswers: number;
  startTime: Date | null;
  isActive: boolean;
}

export const useGamesStore = defineStore('games', () => {
  // State
  const currentGame = ref<GameState>({
    currentScore: 0,
    questionsAnswered: 0,
    correctAnswers: 0,
    startTime: null,
    isActive: false,
  });

  const gameHistory = ref<GameSession[]>([]);
  const isLoading = ref(false);

  // Getters
  const accuracy = computed(() => {
    if (currentGame.value.questionsAnswered === 0) return 0;
    return (currentGame.value.correctAnswers / currentGame.value.questionsAnswered) * 100;
  });

  const gameDuration = computed(() => {
    if (!currentGame.value.startTime) return 0;
    return Math.floor((Date.now() - currentGame.value.startTime.getTime()) / 1000);
  });

  // Actions
  const startGame = () => {
    currentGame.value = {
      currentScore: 0,
      questionsAnswered: 0,
      correctAnswers: 0,
      startTime: new Date(),
      isActive: true,
    };
  };

  const endGame = () => {
    currentGame.value.isActive = false;
  };

  const recordAnswer = (isCorrect: boolean, points: number = 0) => {
    currentGame.value.questionsAnswered++;
    if (isCorrect) {
      currentGame.value.correctAnswers++;
      currentGame.value.currentScore += points;
    }
  };

  const addGameSession = (session: GameSession) => {
    gameHistory.value.unshift(session);
  };

  const setLoading = (loading: boolean) => {
    isLoading.value = loading;
  };

  return {
    // State
    currentGame,
    gameHistory,
    isLoading,
    // Getters
    accuracy,
    gameDuration,
    // Actions
    startGame,
    endGame,
    recordAnswer,
    addGameSession,
    setLoading,
  };
});
