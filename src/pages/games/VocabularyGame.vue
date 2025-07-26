<template>
  <q-page class="flex flex-center column">
    <div v-if="!gameStore.gameActive && gameStore.score > 0">
      <h2>Game Over!</h2>
      <p>Your score: {{ gameStore.score }}</p>
      <q-btn @click="startGame" label="Play Again" color="primary" />
    </div>
    <div v-else-if="gameStore.gameActive">
      <game-timer />
      <vocabulary-card
        :question="gameStore.questions[gameStore.currentQuestionIndex]"
        @answer="handleAnswer"
      />
      <score-display :score="gameStore.score" />
    </div>
    <div v-else>
      <q-btn @click="startGame" label="Start Game" color="primary" />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useGameStore } from 'src/stores/games.ts';
import { gameService } from 'src/services/gameService.ts';
import VocabularyCard from 'src/components/games/VocabularyCard.vue';
import ScoreDisplay from 'src/components/games/ScoreDisplay.vue';
import GameTimer from 'src/components/games/GameTimer.vue';

const gameStore = useGameStore();

async function startGame() {
  const questions = await gameService.getVocabularyQuestions();
  gameStore.startGame(questions);
}

function handleAnswer(selectedAnswer: string) {
  const currentQuestion = gameStore.questions[gameStore.currentQuestionIndex];
  if (!currentQuestion) return;

  const isCorrect = selectedAnswer === currentQuestion.correctAnswer;
  gameStore.answerQuestion(isCorrect);
}
</script>
