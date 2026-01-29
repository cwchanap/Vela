<template>
  <div class="flashcard-rating">
    <div class="rating-label text-caption text-grey q-mb-sm">How well did you know this?</div>
    <div class="rating-buttons">
      <q-btn
        @click="$emit('rate', QUALITY_RATINGS.AGAIN)"
        label="Again"
        color="negative"
        outline
        class="rating-btn"
        data-testid="btn-again"
      >
        <q-tooltip>I forgot completely</q-tooltip>
      </q-btn>
      <q-btn
        @click="$emit('rate', QUALITY_RATINGS.HARD)"
        label="Hard"
        color="warning"
        outline
        class="rating-btn"
        data-testid="btn-hard"
      >
        <q-tooltip>Correct but difficult</q-tooltip>
      </q-btn>
      <q-btn
        @click="$emit('rate', QUALITY_RATINGS.GOOD)"
        label="Good"
        color="primary"
        outline
        class="rating-btn"
        data-testid="btn-good"
      >
        <q-tooltip>Correct with some hesitation</q-tooltip>
      </q-btn>
      <q-btn
        @click="$emit('rate', QUALITY_RATINGS.EASY)"
        label="Easy"
        color="positive"
        outline
        class="rating-btn"
        data-testid="btn-easy"
      >
        <q-tooltip>Perfect recall</q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { QUALITY_RATINGS, type QualityRating } from 'src/stores/flashcards';

defineEmits<{
  (_e: 'rate', _rating: QualityRating): void;
}>();
</script>

<style scoped>
.flashcard-rating {
  width: 100%;
  text-align: center;
}

.rating-label {
  font-size: 0.9rem;
}

.rating-buttons {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}

.rating-btn {
  min-width: 70px;
  font-weight: 600;
}

@media (max-width: 400px) {
  .rating-buttons {
    flex-direction: column;
    align-items: stretch;
  }

  .rating-btn {
    width: 100%;
  }
}
</style>
