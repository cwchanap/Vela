<template>
  <q-page class="flex flex-center column q-pa-md">
    <!-- Setup Screen -->
    <flashcard-setup v-if="showSetup" ref="setupRef" @start="handleStart" />

    <!-- Active Session -->
    <template v-else-if="flashcardStore.sessionActive">
      <!-- Progress Bar -->
      <div class="progress-section q-mb-md">
        <div class="progress-text text-caption text-grey q-mb-xs">
          {{ flashcardStore.currentIndex + 1 }} / {{ flashcardStore.cards.length }}
        </div>
        <q-linear-progress
          :value="flashcardStore.progressPercent / 100"
          color="primary"
          class="progress-bar"
          rounded
        />
      </div>

      <!-- Furigana Toggle -->
      <div class="furigana-toggle q-mb-md">
        <q-toggle
          :model-value="flashcardStore.showFurigana"
          @update:model-value="flashcardStore.setShowFurigana"
          label="Furigana"
          color="primary"
          dense
        />
      </div>

      <!-- Flashcard -->
      <flashcard-card
        v-if="flashcardStore.currentCard"
        :vocabulary="flashcardStore.currentCard.vocabulary"
        :direction="flashcardStore.cardDirection"
        :show-furigana="flashcardStore.showFurigana"
        :is-flipped="flashcardStore.currentCard.isFlipped"
        @flip="handleFlip"
        @pronounce="handlePronounce"
      />

      <!-- Input for Reverse Mode (shown after flip) -->
      <div
        v-if="
          flashcardStore.isReverseMode && flashcardStore.currentCard?.isFlipped && !answerSubmitted
        "
        class="input-section q-mt-lg"
      >
        <flashcard-input
          ref="inputRef"
          :correct-answer="flashcardStore.currentCard.vocabulary.japanese_word"
          :alternate-answers="getAlternateAnswers()"
          @submit="handleAnswerSubmit"
        />
      </div>

      <!-- Rating Buttons (shown after flip for JP→EN, or after answer for EN→JP) -->
      <div v-if="showRatingButtons" class="rating-section q-mt-lg">
        <flashcard-rating @rate="handleRate" />
      </div>
    </template>

    <!-- Session Summary -->
    <flashcard-summary
      v-else-if="showSummary"
      :stats="flashcardStore.stats"
      :accuracy="flashcardStore.accuracy"
      :duration="flashcardStore.sessionDuration"
      @restart="handleRestart"
      @setup="handleBackToSetup"
    />

    <!-- Loading State -->
    <div v-if="isLoading" class="loading-overlay">
      <q-spinner-dots color="primary" size="50px" />
      <div class="text-grey q-mt-md">Loading vocabulary...</div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Notify } from 'quasar';
import { useFlashcardStore, type StudyMode, type CardDirection } from 'src/stores/flashcards';
import { useAuthStore } from 'src/stores/auth';
import { flashcardService } from 'src/services/flashcardService';
import { pronounceWord } from 'src/services/ttsService';
import FlashcardSetup from 'src/components/flashcards/FlashcardSetup.vue';
import FlashcardCard from 'src/components/flashcards/FlashcardCard.vue';
import FlashcardRating from 'src/components/flashcards/FlashcardRating.vue';
import FlashcardInput from 'src/components/flashcards/FlashcardInput.vue';
import FlashcardSummary from 'src/components/flashcards/FlashcardSummary.vue';
import type { Vocabulary, JLPTLevel } from 'src/types/database';
import type { QualityRating } from 'src/stores/flashcards';

const flashcardStore = useFlashcardStore();
const authStore = useAuthStore();

const setupRef = ref<InstanceType<typeof FlashcardSetup> | null>(null);
const inputRef = ref<InstanceType<typeof FlashcardInput> | null>(null);

const showSetup = ref(true);
const showSummary = ref(false);
const isLoading = ref(false);
const answerSubmitted = ref(false);

// Queue for SRS reviews to be submitted at end of session
const reviewQueue = ref<Array<{ vocabulary_id: string; quality: number }>>([]);

// Show rating buttons after card is flipped (JP→EN) or after answer is submitted (EN→JP)
const showRatingButtons = computed(() => {
  if (!flashcardStore.currentCard?.isFlipped) return false;

  if (flashcardStore.isReverseMode) {
    return answerSubmitted.value;
  }

  return true;
});

function getAlternateAnswers(): string[] {
  const vocab = flashcardStore.currentCard?.vocabulary;
  if (!vocab) return [];

  return [vocab.hiragana, vocab.katakana, vocab.romaji].filter(Boolean) as string[];
}

async function handleStart(config: {
  studyMode: StudyMode;
  cardDirection: CardDirection;
  jlptLevels: JLPTLevel[];
  showFurigana: boolean;
}) {
  isLoading.value = true;
  setupRef.value?.setLoading(true);

  try {
    // Apply settings to store
    flashcardStore.setStudyMode(config.studyMode);
    flashcardStore.setCardDirection(config.cardDirection);
    flashcardStore.setJlptLevels(config.jlptLevels);
    flashcardStore.setShowFurigana(config.showFurigana);

    const jlptFilter = config.jlptLevels.length > 0 ? config.jlptLevels : undefined;
    let vocabulary: Vocabulary[] = [];

    if (config.studyMode === 'srs') {
      // Fetch due items from SRS
      const result = await flashcardService.getVocabularyForSRS(20, jlptFilter);
      vocabulary = result.vocabulary;

      if (vocabulary.length === 0) {
        Notify.create({
          type: 'info',
          message: 'No vocabulary due for review. Try cram mode instead!',
          position: 'top',
        });
        return;
      }
    } else {
      // Fetch random vocabulary for cram mode
      vocabulary = await flashcardService.getVocabularyForCram(20, jlptFilter);

      if (vocabulary.length === 0) {
        Notify.create({
          type: 'warning',
          message: jlptFilter
            ? 'No vocabulary found for selected JLPT levels.'
            : 'No vocabulary available.',
          position: 'top',
        });
        return;
      }
    }

    // Start session
    flashcardStore.startSession(vocabulary);
    reviewQueue.value = [];
    showSetup.value = false;
    showSummary.value = false;
  } catch (error) {
    console.error('Failed to start session:', error);
    Notify.create({
      type: 'negative',
      message: 'Failed to load vocabulary. Please try again.',
      position: 'top',
    });
  } finally {
    isLoading.value = false;
    setupRef.value?.setLoading(false);
  }
}

function handleFlip() {
  flashcardStore.flipCard();
}

function handleAnswerSubmit(_answer: string, isCorrect: boolean) {
  answerSubmitted.value = true;

  // Store correctness in the card
  const card = flashcardStore.cards[flashcardStore.currentIndex];
  if (card) {
    card.isCorrect = isCorrect;
  }
}

async function handleRate(rating: QualityRating) {
  if (!flashcardStore.currentCard) return;

  const vocabularyId = flashcardStore.currentCard.vocabulary.id;

  // Queue the review for batch submission
  if (authStore.isAuthenticated) {
    reviewQueue.value.push({
      vocabulary_id: vocabularyId,
      quality: rating,
    });
  }

  // Rate card and move to next
  flashcardStore.rateCard(rating);

  // Reset answer state for next card
  answerSubmitted.value = false;
  inputRef.value?.reset();

  // Check if session ended
  if (!flashcardStore.sessionActive) {
    await submitReviews();
    showSummary.value = true;
  }
}

async function handlePronounce(vocabulary: Vocabulary) {
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
    await pronounceWord(vocabulary, user.id);
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

async function submitReviews() {
  if (reviewQueue.value.length === 0) return;

  try {
    await flashcardService.recordBatchReview(reviewQueue.value);
    console.log(`Successfully recorded ${reviewQueue.value.length} reviews`);
  } catch (error) {
    console.error('Failed to record reviews:', error);
    // Don't show error to user - reviews are best-effort
  }

  reviewQueue.value = [];
}

async function handleRestart() {
  // Save settings before reset
  const savedStudyMode = flashcardStore.studyMode;
  const savedJlptLevels = [...flashcardStore.jlptLevels];
  const savedCardDirection = flashcardStore.cardDirection;
  const savedShowFurigana = flashcardStore.showFurigana;

  // Reset and restore settings
  flashcardStore.reset();
  flashcardStore.setStudyMode(savedStudyMode);
  flashcardStore.setJlptLevels(savedJlptLevels);
  flashcardStore.setCardDirection(savedCardDirection);
  flashcardStore.setShowFurigana(savedShowFurigana);

  const jlptFilter = savedJlptLevels.length > 0 ? savedJlptLevels : undefined;
  let vocabulary: Vocabulary[] = [];

  isLoading.value = true;

  try {
    if (savedStudyMode === 'srs') {
      const result = await flashcardService.getVocabularyForSRS(20, jlptFilter);
      vocabulary = result.vocabulary;
    } else {
      vocabulary = await flashcardService.getVocabularyForCram(20, jlptFilter);
    }

    if (vocabulary.length === 0) {
      Notify.create({
        type: 'info',
        message: 'No more vocabulary available. Try different settings.',
        position: 'top',
      });
      handleBackToSetup();
      return;
    }

    flashcardStore.startSession(vocabulary);
    showSummary.value = false;
    answerSubmitted.value = false;
  } catch (error) {
    console.error('Failed to restart session:', error);
    Notify.create({
      type: 'negative',
      message: 'Failed to load vocabulary. Please try again.',
      position: 'top',
    });
  } finally {
    isLoading.value = false;
  }
}

function handleBackToSetup() {
  flashcardStore.reset();
  showSetup.value = true;
  showSummary.value = false;
  answerSubmitted.value = false;
}

// Watch for session ending (in case it ends from store action)
watch(
  () => flashcardStore.sessionActive,
  async (isActive, wasActive) => {
    if (wasActive && !isActive && !showSummary.value) {
      await submitReviews();
      showSummary.value = true;
    }
  },
);
</script>

<style scoped>
.progress-section {
  width: 100%;
  max-width: 400px;
}

.progress-text {
  text-align: center;
}

.progress-bar {
  height: 8px;
}

.furigana-toggle {
  display: flex;
  justify-content: center;
}

.input-section {
  width: 100%;
  max-width: 400px;
  display: flex;
  justify-content: center;
}

.rating-section {
  width: 100%;
  max-width: 400px;
}

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.9);
  z-index: 1000;
}

body.body--dark .loading-overlay {
  background: rgba(0, 0, 0, 0.9);
}
</style>
