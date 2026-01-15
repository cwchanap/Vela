<template>
  <q-page class="flex flex-center column">
    <!-- Game Over Screen -->
    <div v-if="!gameStore.gameActive" class="text-center">
      <h2>Game Over!</h2>
      <p>Your score: {{ gameStore.score }}</p>
      <q-btn @click="startGame" label="Play Again" color="primary" class="q-mr-sm" />
      <q-btn @click="showSetup = true" label="Change Settings" color="secondary" outline />
    </div>

    <!-- Active Game -->
    <div v-else-if="gameStore.gameActive && currentQuestion">
      <game-timer />
      <vocabulary-card
        :question="currentQuestion"
        @answer="handleAnswer"
        @pronounce="handlePronounce"
      />
      <score-display :score="gameStore.score" />
    </div>

    <!-- Game Setup Screen -->
    <div v-else-if="showSetup" class="game-setup q-pa-md">
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
          <div v-if="dueCount > 0" class="text-body2 q-mb-md">
            <q-icon name="schedule" color="primary" class="q-mr-xs" />
            <span class="text-primary text-weight-medium">{{ dueCount }} words</span> due for review
          </div>
        </q-card-section>

        <q-card-actions align="center">
          <q-btn
            @click="startGame"
            :label="
              srsMode && dueCount > 0 ? `Review ${Math.min(dueCount, 10)} Words` : 'Start Quiz'
            "
            color="primary"
            size="lg"
            :loading="isLoading"
          />
        </q-card-actions>
      </q-card>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import { fetchAuthSession } from 'aws-amplify/auth';
import { useRoute } from 'vue-router';
import { useGameStore } from 'src/stores/games';
import { useProgressStore } from 'src/stores/progress';
import { useAuthStore } from 'src/stores/auth';
import { gameService } from '../../services/gameService';
import { srsService } from '../../services/srsService';
import { pronounceWord } from '../../services/ttsService';
import VocabularyCard from 'src/components/games/VocabularyCard.vue';
import ScoreDisplay from 'src/components/games/ScoreDisplay.vue';
import GameTimer from 'src/components/games/GameTimer.vue';
import JlptLevelSelector from 'src/components/games/JlptLevelSelector.vue';
import { Notify } from 'quasar';
import type { Vocabulary, JLPTLevel } from 'src/types/database';

const gameStore = useGameStore();
const progressStore = useProgressStore();
const authStore = useAuthStore();
const route = useRoute();

const gameStartTime = ref<Date | null>(null);
const correctAnswers = ref(0);
const totalQuestions = ref(0);
const showSetup = ref(true);
const isLoading = ref(false);

// JLPT and SRS settings
const selectedJlptLevels = ref<JLPTLevel[]>([]);
const srsMode = ref(false);
const dueCount = ref(0);

// Queue SRS reviews to ensure they're recorded even if user navigates away
const srsReviewQueue = ref<Array<{ vocabularyId: string; quality: number }>>([]);

const currentQuestion = computed(() => {
  return gameStore.questions[gameStore.currentQuestionIndex];
});

// Helper to get access token
async function getAccessToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.accessToken?.toString() ?? null;
  } catch {
    return null;
  }
}

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
  const token = await getAccessToken();
  if (!token) {
    dueCount.value = 0;
    return;
  }

  try {
    const stats = await srsService.getStats(token, jlptLevels);
    dueCount.value = stats.due_today;
  } catch (error) {
    console.error('Failed to fetch SRS stats:', error);
    dueCount.value = 0;
  }
}

async function startGame() {
  isLoading.value = true;

  try {
    const token = await getAccessToken();
    const jlptFilter = selectedJlptLevels.value.length > 0 ? selectedJlptLevels.value : undefined;

    // If SRS mode is enabled and user is authenticated, try to get due items first
    if (srsMode.value && token && dueCount.value > 0) {
      try {
        const dueResponse = await srsService.getDueItems(token, 10, jlptFilter);
        if (dueResponse.items.length > 0) {
          // Convert due items to questions format, filtering out null vocabulary
          const vocabulary = dueResponse.items
            .map((item) => item.vocabulary)
            .filter((vocab) => vocab !== null) as Vocabulary[];

          // Validate minimum vocabulary count
          if (vocabulary.length < 4) {
            Notify.create({
              type: 'warning',
              message: `You need at least 4 vocabulary words to play. Currently have ${vocabulary.length} due words. Falling back to random vocabulary.`,
              position: 'top',
              timeout: 5000,
            });
            // Fall through to random questions below
          } else {
            // Fetch additional random vocabulary to ensure we have enough distractors
            const additionalVocab = await gameService.getVocabularyQuestions(10, jlptFilter);

            const questions = vocabulary.map((word) => {
              const otherWords = vocabulary.filter((v) => v.id !== word.id);
              let distractors = otherWords
                .sort(() => 0.5 - Math.random())
                .slice(0, 3)
                .map((v) => v.english_translation);

              // If we don't have enough distractors, fetch from additional vocabulary
              if (distractors.length < 3) {
                const needed = 3 - distractors.length;
                const availableDistractors = additionalVocab
                  .filter((q) => q.word.id !== word.id)
                  .map((q) => q.word.english_translation)
                  .filter((trans) => !distractors.includes(trans));

                distractors = [
                  ...distractors,
                  ...availableDistractors.sort(() => 0.5 - Math.random()).slice(0, needed),
                ];
              }

              // Ensure we have exactly 3 unique distractors
              const uniqueDistractors = [...new Set(distractors)].slice(0, 3);

              // If still not enough, show error and fall back
              if (uniqueDistractors.length < 3) {
                throw new Error('Insufficient vocabulary for generating questions');
              }

              const options = [...uniqueDistractors, word.english_translation];

              return {
                word,
                options: options.sort(() => 0.5 - Math.random()),
                correctAnswer: word.english_translation,
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
        console.error('Failed to fetch due items, falling back to random:', error);
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

async function handleAnswer(selectedAnswer: string) {
  if (!currentQuestion.value) return;

  const isCorrect = selectedAnswer === currentQuestion.value.correctAnswer;

  if (isCorrect) {
    correctAnswers.value++;
  }

  // Update individual word progress
  progressStore.updateProgress(currentQuestion.value.word.id, isCorrect);

  // Queue SRS review if user is authenticated
  const token = await getAccessToken();
  if (token) {
    const quality = srsService.qualityFromCorrectness(isCorrect);
    srsReviewQueue.value.push({
      vocabularyId: currentQuestion.value.word.id,
      quality,
    });
  }

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
        const token = await getAccessToken();
        if (token) {
          try {
            await srsService.recordBatchReview(
              token,
              srsReviewQueue.value.map((r) => ({
                vocabulary_id: r.vocabularyId,
                quality: r.quality,
              })),
            );
            console.log(`Successfully recorded ${srsReviewQueue.value.length} SRS reviews`);
          } catch (error) {
            console.error('Failed to record SRS batch reviews:', error);
            // Don't block session recording if SRS fails
          }
        }
      }

      await progressStore.recordGameSession(
        'vocabulary',
        gameStore.score,
        durationSeconds,
        totalQuestions.value,
        correctAnswers.value,
      );

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
