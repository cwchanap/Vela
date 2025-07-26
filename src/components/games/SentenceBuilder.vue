<template>
  <div v-if="gameStore.sentenceGameActive && currentQuestion">
    <div class="q-mb-md">
      <p class="text-h6">Unscramble the sentence:</p>
      <p class="text-body1">{{ currentQuestion.sentence.english_translation }}</p>
    </div>

    <div class="row q-gutter-md">
      <div class="col-12">
        <div class="text-subtitle1">Your Answer:</div>
        <draggable
          v-model="userAnswer"
          group="words"
          class="drop-zone q-pa-md row bg-grey-2"
          item-key="id"
        >
          <template #item="{ element, index }">
            <q-chip
              :key="index"
              removable
              @remove="removeWord(index)"
              color="primary"
              text-color="white"
            >
              {{ element }}
            </q-chip>
          </template>
        </draggable>
      </div>

      <div class="col-12">
        <div class="text-subtitle1">Available Words:</div>
        <draggable
          v-model="scrambledWords"
          group="words"
          class="word-bank q-pa-md row bg-grey-2"
          item-key="id"
        >
          <template #item="{ element, index }">
            <q-chip :key="index" color="secondary" text-color="white" class="cursor-pointer">
              {{ element }}
            </q-chip>
          </template>
        </draggable>
      </div>
    </div>

    <div class="q-mt-lg">
      <q-btn
        @click="checkAnswer"
        color="positive"
        label="Check Answer"
        :disabled="userAnswer.length === 0"
      />
    </div>
  </div>
  <div v-else>
    <q-spinner-dots color="primary" size="40px" />
    <p>Loading game...</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import draggable from 'vuedraggable';
import { useGameStore } from 'src/stores/games';
import { gameService } from '../../services/gameService';
import { useQuasar } from 'quasar';

const gameStore = useGameStore();
const $q = useQuasar();

const userAnswer = ref<string[]>([]);
const scrambledWords = ref<string[]>([]);

const currentQuestion = computed(() => {
  if (gameStore.sentenceGameActive) {
    return gameStore.sentenceQuestions[gameStore.currentSentenceQuestionIndex];
  }
  return null;
});

const initializeQuestion = () => {
  if (currentQuestion.value) {
    scrambledWords.value = [...currentQuestion.value.scrambled];
    userAnswer.value = [];
  }
};

onMounted(async () => {
  if (!gameStore.sentenceGameActive) {
    const questions = await gameService.getSentenceQuestions(5);
    if (questions.length > 0) {
      gameStore.startSentenceGame(questions);
      initializeQuestion();
    }
  }
});

const removeWord = (index: number) => {
  const word = userAnswer.value.splice(index, 1)[0];
  if (word) {
    scrambledWords.value.push(word);
  }
};

const checkAnswer = () => {
  if (!currentQuestion.value) return;

  const isCorrect = userAnswer.value.join(' ') === currentQuestion.value.correctAnswer;
  gameStore.answerSentenceQuestion(isCorrect);

  $q.notify({
    message: isCorrect
      ? 'Correct!'
      : `Incorrect. The correct answer is: ${currentQuestion.value.correctAnswer}`,
    color: isCorrect ? 'positive' : 'negative',
    position: 'top',
    timeout: 2000,
  });

  if (gameStore.sentenceGameActive) {
    initializeQuestion();
  } else {
    $q.dialog({
      title: 'Game Over',
      message: `You scored ${gameStore.score} out of ${gameStore.sentenceQuestions.length}!`,
    });
  }
};
</script>

<style scoped>
.drop-zone {
  border: 2px dashed #ccc;
  min-height: 60px;
  border-radius: 4px;
}

.word-bank {
  border: 2px solid #eee;
  min-height: 60px;
  border-radius: 4px;
}

.cursor-pointer {
  cursor: grab;
}
</style>
