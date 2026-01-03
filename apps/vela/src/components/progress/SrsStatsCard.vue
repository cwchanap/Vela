<template>
  <q-card class="srs-stats-card">
    <q-card-section>
      <div class="text-h6 q-mb-md text-dark">
        <q-icon name="psychology" class="q-mr-sm" />
        Spaced Repetition
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="text-center q-py-lg">
        <q-spinner color="primary" size="40px" />
        <div class="q-mt-sm text-grey">Loading SRS stats...</div>
      </div>

      <!-- Not Authenticated -->
      <div v-else-if="!isAuthenticated" class="text-center q-py-md text-grey-7">
        <q-icon name="lock" size="48px" class="q-mb-sm" />
        <div>Sign in to track your spaced repetition progress</div>
      </div>

      <!-- Stats Display -->
      <div v-else>
        <!-- Due Items Alert -->
        <div v-if="stats.due_today > 0" class="due-alert q-mb-md">
          <q-banner class="bg-primary text-white" rounded>
            <template #avatar>
              <q-icon name="schedule" />
            </template>
            <span class="text-weight-medium">{{ stats.due_today }} words due for review</span>
            <template #action>
              <q-btn
                flat
                label="Review Now"
                :to="{ path: '/games/vocabulary', query: { srsMode: 'true' } }"
              />
            </template>
          </q-banner>
        </div>

        <!-- Stats Grid -->
        <div v-if="stats.total_items > 0" class="stats-grid">
          <div class="stat-item">
            <div class="stat-value text-primary">{{ stats.total_items }}</div>
            <div class="stat-label">Total Words</div>
          </div>
          <div class="stat-item">
            <div class="stat-value text-positive">{{ stats.mastery_breakdown.mastered }}</div>
            <div class="stat-label">Mastered</div>
          </div>
          <div class="stat-item">
            <div class="stat-value text-warning">{{ stats.mastery_breakdown.learning }}</div>
            <div class="stat-label">Learning</div>
          </div>
          <div class="stat-item">
            <div class="stat-value text-info">{{ stats.mastery_breakdown.new }}</div>
            <div class="stat-label">New</div>
          </div>
        </div>

        <!-- Mastery Progress -->
        <div v-if="stats.total_items > 0" class="q-mt-md">
          <div class="flex justify-between q-mb-xs">
            <span class="text-caption text-dark">Mastery Progress</span>
            <span class="text-caption text-dark">{{ masteryPercentage }}%</span>
          </div>
          <q-linear-progress
            :value="masteryPercentage / 100"
            color="positive"
            track-color="grey-3"
            size="8px"
            rounded
          />
        </div>

        <!-- Average Ease Factor -->
        <div v-if="stats.average_ease_factor" class="q-mt-md text-caption text-grey-7">
          <q-icon name="trending_up" size="xs" class="q-mr-xs" />
          Average ease factor: {{ stats.average_ease_factor.toFixed(2) }}
        </div>

        <!-- Empty State -->
        <div v-else class="text-center q-py-md text-grey-7">
          <q-icon name="school" size="48px" class="q-mb-sm" />
          <div>Start learning vocabulary to build your SRS progress!</div>
          <q-btn
            flat
            color="primary"
            label="Start Learning"
            to="/games/vocabulary"
            class="q-mt-sm"
          />
        </div>
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { fetchAuthSession } from 'aws-amplify/auth';
import { useAuthStore } from 'src/stores/auth';
import { srsService, type SRSStats } from 'src/services/srsService';

const authStore = useAuthStore();

const loading = ref(false);
const stats = ref<SRSStats>({
  total_items: 0,
  due_today: 0,
  mastery_breakdown: {
    new: 0,
    learning: 0,
    reviewing: 0,
    mastered: 0,
  },
  average_ease_factor: 0,
  total_reviews: 0,
  accuracy_rate: 0,
});

const isAuthenticated = computed(() => authStore.isAuthenticated);

const masteryPercentage = computed(() => {
  if (stats.value.total_items === 0) return 0;
  return Math.round((stats.value.mastery_breakdown.mastered / stats.value.total_items) * 100);
});

async function getAccessToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.accessToken?.toString() ?? null;
  } catch {
    return null;
  }
}

async function fetchStats() {
  const token = await getAccessToken();
  if (!token) return;

  loading.value = true;
  try {
    stats.value = await srsService.getStats(token);
  } catch (error) {
    console.error('Failed to fetch SRS stats:', error);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (isAuthenticated.value) {
    fetchStats();
  }
});

watch(isAuthenticated, (newValue) => {
  if (newValue) {
    fetchStats();
  }
});

// Expose for testing
defineExpose({ fetchStats, stats, loading });
</script>

<style scoped lang="scss">
.srs-stats-card {
  height: 100%;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  text-align: center;
}

.stat-item {
  padding: 12px 8px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 8px;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.2;
}

.stat-label {
  font-size: 0.75rem;
  color: #666;
  margin-top: 4px;
}

@media (max-width: 600px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
