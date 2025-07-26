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
import { computed } from 'vue';
import { useGameStore } from 'src/stores/games';
import { gameService } from '../../services/gameService';
import VocabularyCard from 'src/components/games/VocabularyCard.vue';
import ScoreDisplay from 'src/components/games/ScoreDisplay.vue';
import GameTimer from 'src/components/games/GameTimer.vue';

const gameStore = useGameStore();

const currentQuestion = computed(() => {
  return gameStore.questions[gameStore.currentQuestionIndex];
});

async function startGame() {
  const questions = await gameService.getVocabularyQuestions();
  gameStore.startGame(questions);
}

function handleAnswer(selectedAnswer: string) {
  if (!currentQuestion.value) return;

  const isCorrect = selectedAnswer === currentQuestion.value.correctAnswer;
  gameStore.answerQuestion(isCorrect);
}
</script>
