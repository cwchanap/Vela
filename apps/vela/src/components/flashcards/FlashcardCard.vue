<template>
  <div class="flashcard-container">
    <!-- Card wrapper for flip animation -->
    <div class="flashcard-wrapper" :class="{ 'is-flipped': isFlipped }" @click="handleCardClick">
      <!-- Front of card -->
      <div class="flashcard-face flashcard-front">
        <q-card class="flashcard">
          <q-card-section class="card-content">
            <!-- Japanese to English: Show Japanese on front -->
            <template v-if="direction === 'jp-to-en'">
              <div class="japanese-text">
                <ruby v-if="showFurigana && vocabulary.hiragana">
                  {{ vocabulary.japanese_word }}
                  <rt>{{ vocabulary.hiragana }}</rt>
                </ruby>
                <span v-else>{{ vocabulary.japanese_word }}</span>
              </div>
              <div v-if="vocabulary.romaji && !showFurigana" class="romaji-text text-grey">
                {{ vocabulary.romaji }}
              </div>
            </template>

            <!-- English to Japanese: Show English on front -->
            <template v-else>
              <div class="english-text">
                {{ vocabulary.english_translation }}
              </div>
            </template>

            <!-- Pronunciation button -->
            <q-btn
              flat
              round
              color="primary"
              icon="volume_up"
              class="pronounce-btn"
              @click.stop="handlePronounce"
              data-testid="btn-pronounce"
            >
              <q-tooltip>Listen to pronunciation</q-tooltip>
            </q-btn>

            <!-- Tap to flip hint -->
            <div class="flip-hint text-caption text-grey">
              <q-icon name="touch_app" size="16px" class="q-mr-xs" />
              Tap to reveal answer
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Back of card -->
      <div class="flashcard-face flashcard-back">
        <q-card class="flashcard">
          <q-card-section class="card-content">
            <!-- Japanese to English: Show English on back -->
            <template v-if="direction === 'jp-to-en'">
              <div class="answer-label text-caption text-grey q-mb-sm">Answer</div>
              <div class="english-text">
                {{ vocabulary.english_translation }}
              </div>

              <!-- Also show Japanese for reference -->
              <div class="reference-section q-mt-lg">
                <div class="japanese-text-small">
                  <ruby v-if="showFurigana && vocabulary.hiragana">
                    {{ vocabulary.japanese_word }}
                    <rt>{{ vocabulary.hiragana }}</rt>
                  </ruby>
                  <span v-else>{{ vocabulary.japanese_word }}</span>
                </div>
              </div>
            </template>

            <!-- English to Japanese: Show Japanese on back -->
            <template v-else>
              <div class="answer-label text-caption text-grey q-mb-sm">Answer</div>
              <div class="japanese-text">
                <ruby v-if="showFurigana && vocabulary.hiragana">
                  {{ vocabulary.japanese_word }}
                  <rt>{{ vocabulary.hiragana }}</rt>
                </ruby>
                <span v-else>{{ vocabulary.japanese_word }}</span>
              </div>
              <div v-if="vocabulary.romaji" class="romaji-text text-grey q-mt-sm">
                {{ vocabulary.romaji }}
              </div>

              <!-- Show English for reference -->
              <div class="reference-section q-mt-lg">
                <div class="english-text-small text-grey">
                  {{ vocabulary.english_translation }}
                </div>
              </div>
            </template>

            <!-- Example sentence if available -->
            <div v-if="vocabulary.example_sentence_jp" class="example-section q-mt-lg">
              <div class="text-caption text-grey q-mb-xs">Example</div>
              <div class="example-jp">{{ vocabulary.example_sentence_jp }}</div>
              <div v-if="vocabulary.example_sentence_en" class="example-en text-grey">
                {{ vocabulary.example_sentence_en }}
              </div>
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Vocabulary } from 'src/types/database';
import type { CardDirection } from 'src/stores/flashcards';

const props = defineProps<{
  vocabulary: Vocabulary;
  direction: CardDirection;
  showFurigana: boolean;
  isFlipped: boolean;
}>();

const emit = defineEmits<{
  (_e: 'flip'): void;
  (_e: 'pronounce', _vocabulary: Vocabulary): void;
}>();

function handleCardClick() {
  if (!props.isFlipped) {
    emit('flip');
  }
}

function handlePronounce() {
  emit('pronounce', props.vocabulary);
}
</script>

<style scoped>
.flashcard-container {
  perspective: 1000px;
  width: 100%;
  max-width: 400px;
  margin: 0 auto;
}

.flashcard-wrapper {
  position: relative;
  width: 100%;
  min-height: 300px;
  transform-style: preserve-3d;
  transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
}

.flashcard-wrapper.is-flipped {
  transform: rotateY(180deg);
}

.flashcard-face {
  position: absolute;
  width: 100%;
  height: 100%;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

.flashcard-back {
  transform: rotateY(180deg);
}

.flashcard {
  width: 100%;
  min-height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-card);
}

.card-content {
  width: 100%;
  text-align: center;
  padding: 32px 24px;
  position: relative;
}

.japanese-text {
  font-size: 3rem;
  font-weight: 500;
  line-height: 1.4;
  margin-bottom: 8px;
}

.japanese-text ruby {
  ruby-position: over;
}

.japanese-text rt {
  font-size: 0.4em;
  color: var(--text-secondary);
}

.japanese-text-small {
  font-size: 1.5rem;
  color: var(--text-secondary);
}

.romaji-text {
  font-size: 1.1rem;
  font-style: italic;
}

.english-text {
  font-size: 1.8rem;
  font-weight: 500;
  line-height: 1.4;
}

.english-text-small {
  font-size: 1.1rem;
}

.answer-label {
  text-transform: uppercase;
  letter-spacing: 1px;
}

.reference-section {
  padding-top: 16px;
  border-top: 1px solid var(--glass-border);
}

.example-section {
  text-align: left;
  padding: 12px;
  background: var(--bg-page);
  border-radius: var(--border-radius-sm);
}

.example-jp {
  font-size: 1rem;
  margin-bottom: 4px;
}

.example-en {
  font-size: 0.9rem;
}

.pronounce-btn {
  position: absolute;
  top: 12px;
  right: 12px;
}

.flip-hint {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  opacity: 0.7;
}

.flashcard-wrapper.is-flipped .flip-hint {
  display: none;
}

/* Dark mode adjustments - using :deep() to pierce scoped styles */
:deep(body.body--dark) .flashcard,
:global(body.body--dark) .flashcard {
  background: var(--bg-card);
}

:deep(body.body--dark) .example-section,
:global(body.body--dark) .example-section {
  background: rgba(255, 255, 255, 0.05);
}
</style>
