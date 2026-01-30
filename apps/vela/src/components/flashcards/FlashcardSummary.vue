<template>
  <q-card class="summary-card">
    <q-card-section class="text-center">
      <div class="summary-icon q-mb-md">
        <q-icon
          :name="accuracy >= 70 ? 'emoji_events' : 'school'"
          :color="accuracy >= 70 ? 'warning' : 'primary'"
          size="64px"
        />
      </div>

      <div class="text-h5 q-mb-sm">Session Complete!</div>
      <div class="text-subtitle1 text-grey q-mb-lg">
        {{ encouragementMessage }}
      </div>

      <!-- Main Stats Grid -->
      <div class="stats-grid q-mb-lg">
        <div class="stat-item">
          <div class="stat-value text-primary">{{ stats.cardsReviewed }}</div>
          <div class="stat-label">Cards Reviewed</div>
        </div>

        <div class="stat-item">
          <div class="stat-value" :class="accuracyColorClass">{{ accuracy }}%</div>
          <div class="stat-label">Accuracy</div>
        </div>

        <div class="stat-item">
          <div class="stat-value text-purple">{{ formattedDuration }}</div>
          <div class="stat-label">Time Spent</div>
        </div>
      </div>

      <!-- Detailed Breakdown -->
      <div class="breakdown-section q-mb-lg">
        <div class="text-subtitle2 q-mb-sm">Rating Breakdown</div>
        <div class="breakdown-bars">
          <div class="breakdown-row">
            <span class="breakdown-label">Again</span>
            <q-linear-progress
              :value="getRatio(stats.againCount)"
              color="negative"
              class="breakdown-bar"
            />
            <span class="breakdown-count">{{ stats.againCount }}</span>
          </div>
          <div class="breakdown-row">
            <span class="breakdown-label">Hard</span>
            <q-linear-progress
              :value="getRatio(stats.hardCount)"
              color="warning"
              class="breakdown-bar"
            />
            <span class="breakdown-count">{{ stats.hardCount }}</span>
          </div>
          <div class="breakdown-row">
            <span class="breakdown-label">Good</span>
            <q-linear-progress
              :value="getRatio(stats.goodCount)"
              color="primary"
              class="breakdown-bar"
            />
            <span class="breakdown-count">{{ stats.goodCount }}</span>
          </div>
          <div class="breakdown-row">
            <span class="breakdown-label">Easy</span>
            <q-linear-progress
              :value="getRatio(stats.easyCount)"
              color="positive"
              class="breakdown-bar"
            />
            <span class="breakdown-count">{{ stats.easyCount }}</span>
          </div>
        </div>
      </div>

      <!-- Correct/Incorrect Summary -->
      <div class="correctness-summary q-mb-lg">
        <div class="correctness-item correct">
          <q-icon name="check_circle" color="positive" size="24px" />
          <span class="text-positive text-weight-medium">{{ stats.correctCount }} Correct</span>
        </div>
        <div class="correctness-item incorrect">
          <q-icon name="cancel" color="negative" size="24px" />
          <span class="text-negative text-weight-medium">{{ stats.incorrectCount }} Incorrect</span>
        </div>
      </div>
    </q-card-section>

    <q-separator />

    <q-card-actions align="center" class="q-pa-md">
      <q-btn
        @click="$emit('restart')"
        label="Study Again"
        color="primary"
        outline
        class="q-mr-sm"
        data-testid="btn-study-again"
      />
      <q-btn
        @click="$emit('setup')"
        label="Change Settings"
        color="secondary"
        outline
        data-testid="btn-change-settings"
      />
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SessionStats } from 'src/stores/flashcards';

const props = defineProps<{
  stats: SessionStats;
  accuracy: number;
  duration: number;
}>();

defineEmits<{
  (_e: 'restart'): void;
  (_e: 'setup'): void;
}>();

const formattedDuration = computed(() => {
  const minutes = Math.floor(props.duration / 60);
  const seconds = props.duration % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
});

const accuracyColorClass = computed(() => {
  if (props.accuracy >= 80) return 'text-positive';
  if (props.accuracy >= 60) return 'text-warning';
  return 'text-negative';
});

const encouragementMessage = computed(() => {
  if (props.accuracy >= 90) return 'Excellent work! Keep it up!';
  if (props.accuracy >= 70) return "Great job! You're making progress!";
  if (props.accuracy >= 50) return 'Good effort! Practice makes perfect!';
  return 'Keep practicing! Every review helps!';
});

/**
 * Calculate a safe ratio for progress bars
 * Returns 0 if cardsReviewed is 0 or if result is not finite
 */
function getRatio(count: number): number {
  if (props.stats.cardsReviewed === 0) return 0;
  const ratio = count / props.stats.cardsReviewed;
  return Number.isFinite(ratio) ? ratio : 0;
}
</script>

<style scoped>
.summary-card {
  width: 100%;
  max-width: 450px;
  border-radius: var(--border-radius-lg);
}

.summary-icon {
  display: flex;
  justify-content: center;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.stat-item {
  text-align: center;
  padding: 16px 8px;
  background: var(--bg-page);
  border-radius: var(--border-radius-md);
}

.stat-value {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.2;
}

.stat-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 4px;
}

.text-purple {
  color: var(--color-purple);
}

.breakdown-section {
  text-align: left;
}

.breakdown-bars {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.breakdown-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.breakdown-label {
  width: 50px;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.breakdown-bar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
}

.breakdown-count {
  width: 24px;
  text-align: right;
  font-size: 0.85rem;
  font-weight: 600;
}

.correctness-summary {
  display: flex;
  justify-content: center;
  gap: 32px;
}

.correctness-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Dark mode */
body.body--dark .stat-item {
  background: rgba(255, 255, 255, 0.05);
}
</style>
