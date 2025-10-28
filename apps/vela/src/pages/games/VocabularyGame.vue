<template>
  <q-page class="flex flex-center column">
    <div v-if="!gameStore.gameActive && gameStore.score > 0">
      <h2>Game Over!</h2>
      <p>Your score: {{ gameStore.score }}</p>
      <q-btn @click="startGame" label="Play Again" color="primary" />
    </div>
    <div v-else-if="gameStore.gameActive && currentQuestion">
      <game-timer />
      <vocabulary-card
        :question="currentQuestion"
        @answer="handleAnswer"
        @pronounce="handlePronounce"
      />
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
import { useAuthStore } from 'src/stores/auth';
import { gameService } from '../../services/gameService';
import { pronounceWord } from '../../services/ttsService';
import VocabularyCard from 'src/components/games/VocabularyCard.vue';
import ScoreDisplay from 'src/components/games/ScoreDisplay.vue';
import GameTimer from 'src/components/games/GameTimer.vue';
import { Notify } from 'quasar';
import type { Vocabulary } from 'src/types/database';

const gameStore = useGameStore();
const progressStore = useProgressStore();
const authStore = useAuthStore();

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

async function handlePronounce(word: Vocabulary) {
  const user = authStore.user;
  if (!user?.id) {
    Notify.create({
      type: 'warning',
      message: 'Please sign in to use pronunciation features',
      position: 'top',
    });
    return;
  }

  try {
    await pronounceWord(word, user.id);
  } catch (error) {
    console.error('Pronunciation error:', error);
    Notify.create({
      type: 'negative',
      message:
        error instanceof Error
          ? error.message
          : 'Failed to play pronunciation. Please check your TTS settings.',
      position: 'top',
    });
  }
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
