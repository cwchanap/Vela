<template>
  <q-page class="flex flex-center column">
    <!-- Setup Screen -->
    <listening-setup v-if="showSetup" :is-starting="isStarting" @start="handleStart" />

    <!-- Active Game -->
    <div
      v-else-if="listeningStore.gameActive || showAnswerFeedback"
      class="text-center q-pa-md listening-game-container"
    >
      <game-timer :on-timeout="handleTimeout" />
      <score-display :score="listeningStore.score" class="q-mb-md" />

      <!-- Answer Feedback Card -->
      <answer-feedback
        v-if="showAnswerFeedback && lastAnswerResult"
        :is-correct="lastAnswerResult.isCorrect"
        :japanese-text="lastAnswerResult.question.text"
        v-bind="
          lastAnswerResult.question.kind === 'vocabulary' && lastAnswerResult.question.reading
            ? { reading: lastAnswerResult.question.reading }
            : {}
        "
        :english-translation="lastAnswerResult.question.englishTranslation"
        :audio-url="currentAudioUrl"
        :user-input="lastAnswerResult.userInput"
        :show-user-input="currentConfig?.mode === 'dictation'"
        :is-last="listeningStore.currentIndex >= listeningStore.questions.length"
        @next="proceedToNextQuestion"
      />

      <!-- Active Question -->
      <template v-else-if="listeningStore.currentQuestion">
        <!-- Audio Player — auto-plays when URL is ready -->
        <audio-player
          :audio-url="currentAudioUrl"
          :is-loading="isLoadingAudio"
          class="q-mb-lg"
          @played="audioHasPlayed = true"
          @error="handleAudioPlaybackFailure"
        />

        <!-- Question UI — only revealed after first audio play -->
        <template v-if="audioHasPlayed">
          <multiple-choice-question
            v-if="currentConfig?.mode === 'multiple-choice'"
            :key="`${listeningStore.currentQuestion.id}-multiple-choice`"
            :correct-answer="listeningStore.currentQuestion.englishTranslation"
            :distractors="listeningStore.currentQuestion.distractors"
            @answer="handleAnswer"
          />
          <dictation-question
            v-else
            :key="`${listeningStore.currentQuestion.id}-dictation`"
            @answer="handleAnswer"
          />
        </template>

        <div v-else class="text-grey text-body2 q-mt-sm">
          <q-icon name="info" size="xs" class="q-mr-xs" />
          Listen to the audio, then answer the question
        </div>
      </template>
    </div>

    <!-- Game Over Screen -->
    <div v-else class="text-center q-pa-md">
      <div class="text-h4 q-mb-sm">Game Over!</div>
      <div class="text-h6 text-grey q-mb-lg">
        {{ correctAnswers }} / {{ attemptedQuestions }} correct
      </div>
      <q-btn
        label="Play Again"
        color="teal"
        class="q-mr-sm"
        unelevated
        rounded
        @click="playAgain"
      />
      <q-btn label="Change Settings" color="teal" outline rounded @click="showSetup = true" />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { useListeningGameStore } from 'src/stores/listeningGame';
import { useProgressStore } from 'src/stores/progress';
import { useAuthStore } from 'src/stores/auth';
import { listeningGameService } from 'src/services/listeningGameService';
import { generatePronunciation } from 'src/services/ttsService';
import { isDictationCorrect } from 'src/utils/listeningValidation';
import { Notify } from 'quasar';
import type { ListeningConfig, ListeningQuestion } from 'src/types/listening';
import ListeningSetup from 'src/components/games/listening/ListeningSetup.vue';
import AudioPlayer from 'src/components/games/listening/AudioPlayer.vue';
import MultipleChoiceQuestion from 'src/components/games/listening/MultipleChoiceQuestion.vue';
import DictationQuestion from 'src/components/games/listening/DictationQuestion.vue';
import AnswerFeedback from 'src/components/games/listening/AnswerFeedback.vue';
import GameTimer from 'src/components/games/GameTimer.vue';
import ScoreDisplay from 'src/components/games/ScoreDisplay.vue';

const listeningStore = useListeningGameStore();
const progressStore = useProgressStore();
const authStore = useAuthStore();

const showSetup = ref(true);
const isStarting = ref(false);
const currentConfig = ref<ListeningConfig | null>(null);
const gameStartTime = ref<Date | null>(null);
const correctAnswers = ref(0);
const attemptedQuestions = ref(0);
const showAnswerFeedback = ref(false);
const lastAnswerResult = ref<{
  isCorrect: boolean;
  question: ListeningQuestion;
  userInput: string;
} | null>(null);
const currentAudioUrl = ref<string | null>(null);
const isLoadingAudio = ref(false);
const audioHasPlayed = ref(false);
const shouldRecordSession = ref(false);
const activeAudioRequestId = ref(0);
const isUnmounted = ref(false);

function invalidateAudioRequest() {
  activeAudioRequestId.value += 1;
}

function beginAudioRequest() {
  const requestId = activeAudioRequestId.value + 1;
  activeAudioRequestId.value = requestId;
  return requestId;
}

function isCurrentAudioRequest(requestId: number, questionId: string) {
  return (
    !isUnmounted.value &&
    activeAudioRequestId.value === requestId &&
    listeningStore.gameActive &&
    listeningStore.currentQuestion?.id === questionId
  );
}

function getAuthenticatedUserId() {
  return authStore.user?.id ?? authStore.session?.user?.id ?? null;
}

function getRecordedGameType(config: ListeningConfig | null) {
  if (!config) {
    return null;
  }

  return config.source === 'vocabulary' ? 'vocabulary' : 'sentence';
}

async function handleStart(config: ListeningConfig) {
  isStarting.value = true;
  try {
    invalidateAudioRequest();
    const questions = await listeningGameService.getListeningQuestions(config, 10);
    if (questions.length === 0) {
      Notify.create({
        type: 'warning',
        message:
          config.jlptLevels.length > 0
            ? 'No questions found for the selected JLPT levels. Try different levels or "All Levels".'
            : 'No questions available. Please try again.',
        position: 'top',
        timeout: 5000,
      });
      return;
    }
    currentConfig.value = config;
    listeningStore.startGame(questions);
    gameStartTime.value = new Date();
    correctAnswers.value = 0;
    attemptedQuestions.value = 0;
    shouldRecordSession.value = false;
    showSetup.value = false;
  } catch (e) {
    console.error('Failed to start listening game:', e);
    Notify.create({
      type: 'negative',
      message: 'Failed to start game. Please try again.',
      position: 'top',
      timeout: 5000,
    });
    return;
  } finally {
    isStarting.value = false;
  }
  await loadAudioForCurrentQuestion();
}

async function skipCurrentQuestionAfterAudioFailure() {
  if (listeningStore.currentIndex + 1 >= listeningStore.questions.length) {
    shouldRecordSession.value = true;
  }

  currentAudioUrl.value = null;
  audioHasPlayed.value = false;
  listeningStore.submitAnswer(false);

  if (listeningStore.gameActive) {
    await loadAudioForCurrentQuestion();
  }
}

async function handleAudioFailure(message: string) {
  Notify.create({
    type: 'warning',
    message,
    position: 'top',
    timeout: 4000,
  });
  await skipCurrentQuestionAfterAudioFailure();
}

async function loadAudioForCurrentQuestion() {
  const question = listeningStore.currentQuestion;
  const userId = getAuthenticatedUserId();
  const requestId = question ? beginAudioRequest() : activeAudioRequestId.value;
  currentAudioUrl.value = null;
  if (!question || !userId) {
    if (!userId) {
      if (!question || !listeningStore.gameActive) {
        isLoadingAudio.value = false;
        audioHasPlayed.value = false;
        return;
      }
      console.warn(
        'loadAudioForCurrentQuestion: no authenticated user — skipping audio. Session may have expired.',
      );
      await handleAudioFailure('Audio is unavailable. Skipping this question.');
    }
    isLoadingAudio.value = false;
    audioHasPlayed.value = false;
    return;
  }

  isLoadingAudio.value = true;
  audioHasPlayed.value = false;

  try {
    const { audioUrl } = await generatePronunciation(question.id, question.text, userId);
    if (!isCurrentAudioRequest(requestId, question.id)) {
      return;
    }
    currentAudioUrl.value = audioUrl;
  } catch (e) {
    if (!isCurrentAudioRequest(requestId, question.id)) {
      return;
    }
    console.error('Failed to load audio:', e);
    await handleAudioFailure('Failed to load audio. Skipping this question.');
  } finally {
    if (activeAudioRequestId.value === requestId) {
      isLoadingAudio.value = false;
    }
  }
}

async function handleAudioPlaybackFailure(reason: 'autoplay-blocked' | 'playback-failed') {
  if (!listeningStore.gameActive || !listeningStore.currentQuestion) {
    return;
  }

  if (reason === 'autoplay-blocked') {
    return;
  }

  invalidateAudioRequest();
  isLoadingAudio.value = false;
  await handleAudioFailure('Audio playback failed. Skipping this question.');
}

function handleAnswer(input: string) {
  const question = listeningStore.currentQuestion;
  if (!question) return;

  const isCorrect =
    currentConfig.value?.mode === 'multiple-choice'
      ? input === question.englishTranslation
      : isDictationCorrect(input, question);

  attemptedQuestions.value++;
  if (isCorrect) correctAnswers.value++;

  // Update vocabulary mastery state for vocabulary-source games
  if (currentConfig.value?.source === 'vocabulary') {
    progressStore.updateProgress(question.id, isCorrect);
  }

  // Pre-load next question's audio while user reads feedback
  preloadNextAudio();

  if (listeningStore.currentIndex + 1 >= listeningStore.questions.length) {
    shouldRecordSession.value = true;
  }

  listeningStore.submitAnswer(isCorrect);
  showAnswerFeedback.value = true;
  lastAnswerResult.value = { isCorrect, question, userInput: input };
}

function preloadNextAudio() {
  const userId = getAuthenticatedUserId();
  if (!userId) return;
  // currentIndex still points to the current question (submitAnswer not called yet)
  const nextQuestion = listeningStore.questions[listeningStore.currentIndex + 1];
  if (nextQuestion) {
    generatePronunciation(nextQuestion.id, nextQuestion.text, userId).catch((error) => {
      console.error('Failed to preload next audio:', error);
    });
  }
}

async function proceedToNextQuestion() {
  showAnswerFeedback.value = false;
  lastAnswerResult.value = null;
  invalidateAudioRequest();
  currentAudioUrl.value = null;
  audioHasPlayed.value = false;

  if (listeningStore.gameActive) {
    await loadAudioForCurrentQuestion();
  }
}

function handleTimeout() {
  showAnswerFeedback.value = false;
  lastAnswerResult.value = null;
  invalidateAudioRequest();
  currentAudioUrl.value = null;
  isLoadingAudio.value = false;
  audioHasPlayed.value = false;
  shouldRecordSession.value = true;
  listeningStore.endGame();
}

function playAgain() {
  if (currentConfig.value) {
    void handleStart(currentConfig.value);
  } else {
    showSetup.value = true;
  }
}

// Record session when game ends (timer expiry or last question answered)
watch(
  () => listeningStore.gameActive,
  async (isActive, wasActive) => {
    if (wasActive && !isActive) {
      const startTime = gameStartTime.value;
      const shouldRecord = shouldRecordSession.value;
      const attemptedCount = attemptedQuestions.value;
      const correctCount = correctAnswers.value;
      const finalScore = listeningStore.score;
      gameStartTime.value = null;
      shouldRecordSession.value = false;

      if (!startTime || !shouldRecord || attemptedCount === 0) {
        return;
      }

      const durationSeconds = Math.round((Date.now() - startTime.getTime()) / 1000);
      const gameType = getRecordedGameType(currentConfig.value);
      if (!gameType) {
        return;
      }

      try {
        await progressStore.recordGameSession(
          gameType,
          finalScore,
          durationSeconds,
          attemptedCount,
          correctCount,
        );
      } catch (e) {
        console.error('Failed to record game session:', e);
        Notify.create({
          type: 'warning',
          message: 'Your game progress could not be saved. Please check your connection.',
          position: 'top',
          timeout: 5000,
        });
      }
    }
  },
);

// Clean up store if user navigates away mid-game
onBeforeUnmount(() => {
  isUnmounted.value = true;
  invalidateAudioRequest();
  currentAudioUrl.value = null;
  isLoadingAudio.value = false;
  audioHasPlayed.value = false;
  if (listeningStore.gameActive) {
    shouldRecordSession.value = false;
    listeningStore.endGame();
  }
});
</script>

<style scoped>
.listening-game-container {
  max-width: 500px;
  width: 100%;
}
</style>
