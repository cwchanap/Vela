import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { ListeningQuestion } from '../types/listening';

export const useListeningGameStore = defineStore('listeningGame', () => {
  const questions = ref<ListeningQuestion[]>([]);
  const currentIndex = ref(0);
  const score = ref(0);
  const gameActive = ref(false);

  const currentQuestion = computed<ListeningQuestion | null>(
    () => questions.value[currentIndex.value] ?? null,
  );

  function startGame(qs: ListeningQuestion[]) {
    questions.value = qs;
    currentIndex.value = 0;
    score.value = 0;
    gameActive.value = true;
  }

  function submitAnswer(isCorrect: boolean) {
    if (isCorrect) score.value++;
    currentIndex.value++;
    if (currentIndex.value >= questions.value.length) {
      endGame();
    }
  }

  function endGame() {
    gameActive.value = false;
  }

  function reset() {
    questions.value = [];
    currentIndex.value = 0;
    score.value = 0;
    gameActive.value = false;
  }

  return {
    questions,
    currentIndex,
    score,
    gameActive,
    currentQuestion,
    startGame,
    submitAnswer,
    endGame,
    reset,
  };
});
