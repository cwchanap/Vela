<template>
  <q-page class="flex flex-center column">
    <div v-if="!gameStore.gameActive && gameStore.score > 0">
      <h2>Game Over!</h2>
      <p>Your score: {{ gameStore.score }}</p>
      <q-btn @click="startGame" label="Play Again" color="primary" />
    </div>
    <div v-else-if="gameStore.gameActive && currentQuestion">
      <game-timer />
      <vocabulary-card :question="currentQuestion" @answer="handleAnswer" />
      <score-display :score="gameStore.score" />
    </div>
    <div v-else>
      <q-btn @click="startGame" label="Start Game" color="primary" />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameStore } from 'src/stores/games';
import { useProgressStore } from 'src/stores/progress';
import { gameService } from '../../services/gameService';
import VocabularyCard from 'src/components/games/VocabularyCard.vue';
import ScoreDisplay from 'src/components/games/ScoreDisplay.vue';
import GameTimer from 'src/components/games/GameTimer.vue';

const gameStore = useGameStore();
const progressStore = useProgressStore();

const gameStartTime = ref<Date | null>(null);
const correctAnswers = ref(0);
const totalQuestions = ref(0);

const currentQuestion = computed(() => {
  return gameStore.questions[gameStore.currentQuestionIndex];
});

async function startGame() {
  const questions = await gameService.getVocabularyQuestions();
  gameStore.startGame(questions);
  gameStartTime.value = new Date();
  correctAnswers.value = 0;
  totalQuestions.value = questions.length;
}

function handleAnswer(selectedAnswer: string) {
  if (!currentQuestion.value) return;

  const isCorrect = selectedAnswer === currentQuestion.value.correctAnswer;

  if (isCorrect) {
    correctAnswers.value++;
  }

  // Update individual word progress
  progressStore.updateProgress(currentQuestion.value.word.id, isCorrect);

  gameStore.answerQuestion(isCorrect);
}

// Watch for game end to record session
watch(
  () => gameStore.gameActive,
  async (isActive, wasActive) => {
    if (wasActive && !isActive && gameStartTime.value) {
      // Game just ended
      const durationSeconds = Math.round((Date.now() - gameStartTime.value.getTime()) / 1000);

      await progressStore.recordGameSession(
        'vocabulary',
        gameStore.score,
        durationSeconds,
        totalQuestions.value,
        correctAnswers.value,
      );

      // Reset tracking variables
      gameStartTime.value = null;
      correctAnswers.value = 0;
      totalQuestions.value = 0;
    }
  },
);
</script>
