<template>
  <q-page class="flex flex-center column">
    <!-- Game Setup Screen - check this first so it shows when "Change Settings" is clicked -->
    <div v-if="showSetup" class="game-setup q-pa-md">
      <q-card class="q-pa-md" style="max-width: 450px">
        <q-card-section>
          <div class="text-h5 q-mb-md">Vocabulary Quiz</div>

          <!-- JLPT Level Selection -->
          <jlpt-level-selector v-model="selectedJlptLevels" class="q-mb-lg" />

          <!-- SRS Mode Toggle -->
          <div class="q-mb-lg">
            <q-toggle v-model="srsMode" label="Review Due Words First" color="primary" />
            <div class="text-caption text-grey q-mt-xs">
              Prioritize words that are due for review based on spaced repetition
            </div>
          </div>

          <!-- Due Items Count -->
          <div v-if="dueCount !== null && dueCount > 0" class="text-body2 q-mb-md">
            <q-icon name="schedule" color="primary" class="q-mr-xs" />
            <span class="text-primary text-weight-medium">{{ dueCount }} words</span> due for review
          </div>
          <div v-else-if="dueCount === null && srsMode" class="text-body2 text-negative q-mb-md">
            <q-icon name="warning" color="negative" class="q-mr-xs" />
            Could not load review count
          </div>
        </q-card-section>

        <q-card-actions align="center">
          <q-btn
            @click="startGame"
            :label="
              srsMode && dueCount !== null && dueCount > 0
                ? `Review ${Math.min(dueCount, 10)} Words`
                : 'Start Quiz'
            "
            color="primary"
            size="lg"
            :loading="isLoading"
          />
        </q-card-actions>
      </q-card>
    </div>

    <!-- Active Game -->
    <div v-else-if="gameStore.gameActive && currentQuestion">
      <game-timer />
      <div v-if="!showAnswerFeedback || !lastAnswerResult">
        <vocabulary-card
          :question="currentQuestion"
          :show-pronunciation="false"
          @answer="handleAnswer"
          @pronounce="handlePronounce"
        />
        <score-display :score="gameStore.score" />
      </div>
      <div v-else class="text-center">
        <q-card class="q-pa-lg" style="max-width: 420px">
          <q-card-section>
            <div class="text-h3 q-mb-md">
              {{ lastAnswerResult.isCorrect ? '✓' : '✗' }}
            </div>
            <div
              class="text-h5 q-mb-sm"
              :class="lastAnswerResult.isCorrect ? 'text-positive' : 'text-negative'"
            >
              {{ lastAnswerResult.isCorrect ? 'Correct!' : 'Incorrect' }}
            </div>
            <div class="text-body1 q-mb-md">
              {{ currentQuestion.word.english_translation }} =
              {{ currentQuestion.word.japanese_word }}
            </div>
            <q-btn
              flat
              round
              dense
              icon="volume_up"
              color="primary"
              size="lg"
              :aria-label="`Play pronunciation for ${currentQuestion.word.japanese_word}`"
              @click="handlePronounce(currentQuestion.word)"
              class="q-mb-md"
            >
              <q-tooltip>Listen to pronunciation</q-tooltip>
            </q-btn>
          </q-card-section>
          <q-card-actions align="center">
            <q-btn
              @click="proceedToNextQuestion"
              :label="
                gameStore.currentQuestionIndex + 1 >= gameStore.questions.length
                  ? 'Finish'
                  : 'Next Question'
              "
              color="primary"
              size="lg"
            />
          </q-card-actions>
        </q-card>
        <score-display :score="gameStore.score" class="q-mt-md" />
      </div>
    </div>

    <!-- Game Over Screen - only show when game is inactive and not showing setup -->
    <div v-else-if="!gameStore.gameActive" class="text-center">
      <h2>Game Over!</h2>
      <p>Your score: {{ gameStore.score }}</p>
      <q-btn @click="startGame" label="Play Again" color="primary" class="q-mr-sm" />
      <q-btn @click="showSetup = true" label="Change Settings" color="secondary" outline />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useGameStore } from 'src/stores/games';
import { useProgressStore } from 'src/stores/progress';
import { useAuthStore } from 'src/stores/auth';
import { gameService, InsufficientVocabularyError } from '../../services/gameService';
import { srsService } from '../../services/srsService';
import { pronounceWord } from '../../services/ttsService';
import { buildDistractors, normalizeVocabulary, toVocabularyOption } from 'src/utils/vocabulary';
import VocabularyCard from 'src/components/games/VocabularyCard.vue';
import ScoreDisplay from 'src/components/games/ScoreDisplay.vue';
import GameTimer from 'src/components/games/GameTimer.vue';
import JlptLevelSelector from 'src/components/games/JlptLevelSelector.vue';
import { Notify } from 'quasar';
import type { Vocabulary, JLPTLevel } from 'src/types/database';
import { shuffleArray } from 'src/utils/array';
import type { ReviewInput } from 'src/services/srsService';

const gameStore = useGameStore();
const progressStore = useProgressStore();
const authStore = useAuthStore();
const route = useRoute();

const gameStartTime = ref<Date | null>(null);
const correctAnswers = ref(0);
const totalQuestions = ref(0);
const showSetup = ref(true);
const isLoading = ref(false);
const showAnswerFeedback = ref(false);
const lastAnswerResult = ref<{ selectedId: string; isCorrect: boolean } | null>(null);

// JLPT and SRS settings
const selectedJlptLevels = ref<JLPTLevel[]>([]);
const srsMode = ref(false);
const dueCount = ref<number | null>(null);

// Queue SRS reviews to ensure they're recorded even if user navigates away
const srsReviewQueue = ref<Array<{ vocabularyId: string; quality: ReviewInput['quality'] }>>([]);

const currentQuestion = computed(() => {
  return gameStore.questions[gameStore.currentQuestionIndex];
});

// Fetch due count when auth or JLPT levels change
onMounted(async () => {
  const srsModeQuery = route.query.srsMode;
  if (srsModeQuery === 'true' || srsModeQuery === '1') {
    srsMode.value = true;
  }

  await fetchDueCount(selectedJlptLevels.value);
});

watch([() => authStore.isAuthenticated, selectedJlptLevels], async () => {
  await fetchDueCount(selectedJlptLevels.value);
});

async function fetchDueCount(jlptLevels?: JLPTLevel[]) {
  if (!authStore.isAuthenticated) {
    dueCount.value = 0;
    return;
  }

  try {
    const stats = await srsService.getStats(jlptLevels);
    dueCount.value = stats.due_today;
  } catch (error) {
    console.error('Failed to fetch SRS stats:', error);
    dueCount.value = null;
  }
}

async function startGame() {
  isLoading.value = true;

  try {
    const jlptFilter = selectedJlptLevels.value.length > 0 ? selectedJlptLevels.value : undefined;

    // If SRS mode is enabled and user is authenticated, try to get due items first
    if (
      srsMode.value &&
      authStore.isAuthenticated &&
      dueCount.value !== null &&
      dueCount.value > 0
    ) {
      try {
        const dueResponse = await srsService.getDueItems(10, jlptFilter);
        if (dueResponse.items.length > 0) {
          // Convert due items to questions format, filtering out null vocabulary
          // Normalize: API may return `japanese` instead of `japanese_word` for legacy records
          const vocabulary = dueResponse.items
            .map((item) => item.vocabulary)
            .filter((vocab) => vocab !== null)
            .map(normalizeVocabulary)
            .filter((vocab): vocab is Vocabulary => vocab !== null);

          if (vocabulary.length > 0) {
            // Fetch additional random vocabulary to ensure we have enough distractors
            const additionalWords = await gameService.getVocabularyPool(10, jlptFilter);

            const questions = vocabulary.map((word) => {
              const uniqueDistractors = buildDistractors(word, vocabulary, additionalWords);

              // If still not enough, throw so we fall back to random
              if (uniqueDistractors.length < 3) {
                throw new InsufficientVocabularyError();
              }

              const options = [...uniqueDistractors, toVocabularyOption(word)];

              return {
                word,
                options: shuffleArray(options),
                correctAnswer: word.id,
              };
            });

            gameStore.startGame(questions);
            gameStartTime.value = new Date();
            correctAnswers.value = 0;
            totalQuestions.value = questions.length;
            showSetup.value = false;
            return;
          }
        }
      } catch (error) {
        if (error instanceof InsufficientVocabularyError) {
          Notify.create({
            type: 'warning',
            message:
              'Not enough unique distractors in your review pool. Starting a random quiz instead.',
            position: 'top',
            timeout: 5000,
          });
        } else {
          console.error('Failed to fetch due items, falling back to random:', error);
          Notify.create({
            type: 'warning',
            message: 'Could not load your review words. Starting a random quiz instead.',
            position: 'top',
            timeout: 5000,
          });
        }
      }
    }

    // Fall back to regular random questions
    const questions = await gameService.getVocabularyQuestions(10, jlptFilter);

    if (questions.length === 0) {
      Notify.create({
        type: 'warning',
        message: jlptFilter
          ? 'No vocabulary found for selected JLPT levels. Try selecting different levels or "All Levels".'
          : 'No vocabulary available. Please add some vocabulary first.',
        position: 'top',
        timeout: 5000,
      });
      return;
    }

    gameStore.startGame(questions);
    gameStartTime.value = new Date();
    correctAnswers.value = 0;
    totalQuestions.value = questions.length;
    showSetup.value = false;
  } catch (error) {
    console.error('Failed to start game:', error);
    Notify.create({
      type: 'negative',
      message: 'Failed to start game. Please try again.',
      position: 'top',
      timeout: 5000,
    });
  } finally {
    isLoading.value = false;
  }
}

async function handleAnswer(selectedVocabularyId: string) {
  if (!currentQuestion.value) return;

  const isCorrect = selectedVocabularyId === currentQuestion.value.correctAnswer;

  // Commit the answer immediately so progress is recorded even if the user
  // navigates away before pressing Next/Finish on the feedback screen.
  if (isCorrect) {
    correctAnswers.value++;
  }

  progressStore.updateProgress(currentQuestion.value.word.id, isCorrect);

  if (authStore.isAuthenticated) {
    const quality = srsService.qualityFromCorrectness(isCorrect);
    srsReviewQueue.value.push({
      vocabularyId: currentQuestion.value.word.id,
      quality,
    });
  }

  // Store the result and show feedback
  lastAnswerResult.value = { selectedId: selectedVocabularyId, isCorrect };
  showAnswerFeedback.value = true;
}

async function proceedToNextQuestion() {
  if (!lastAnswerResult.value) {
    console.warn('[proceedToNextQuestion] Called with null lastAnswerResult');
    showAnswerFeedback.value = false;
    lastAnswerResult.value = null;
    return;
  }

  const { isCorrect } = lastAnswerResult.value;

  // Hide feedback and advance game state
  showAnswerFeedback.value = false;
  lastAnswerResult.value = null;
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

      // Record SRS reviews in batch
      if (srsReviewQueue.value.length > 0) {
        try {
          await srsService.recordBatchReview(
            srsReviewQueue.value.map((r) => ({
              vocabulary_id: r.vocabularyId,
              quality: r.quality,
            })),
          );
          console.log(`Successfully recorded ${srsReviewQueue.value.length} SRS reviews`);
        } catch (error) {
          console.error('Failed to record SRS batch reviews:', error);
          Notify.create({
            type: 'warning',
            message:
              'Your review progress could not be saved. Your spaced repetition schedule may not update correctly.',
            position: 'top',
            timeout: 6000,
          });
        }
      }

      try {
        await progressStore.recordGameSession(
          'vocabulary',
          gameStore.score,
          durationSeconds,
          totalQuestions.value,
          correctAnswers.value,
        );
      } catch (error) {
        console.error('Failed to record game session:', error);
        Notify.create({
          type: 'warning',
          message: 'Your game progress could not be saved. Please check your connection.',
          position: 'top',
          timeout: 5000,
        });
      }

      // Refresh due count after game
      await fetchDueCount(selectedJlptLevels.value);

      // Reset tracking variables
      gameStartTime.value = null;
      correctAnswers.value = 0;
      totalQuestions.value = 0;
      srsReviewQueue.value = [];
    }
  },
);
</script>

<style scoped>
.game-setup {
  width: 100%;
  max-width: 500px;
}
</style>
